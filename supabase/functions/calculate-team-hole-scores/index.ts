import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';

type HoleRow = {
  hole_number: number;
  gross_score: number | null;
  is_team_score: boolean;
};

type LeagueRoundRow = {
  id: string;
  league_id: string;
  user_id: string;
  league_team_id: string | null;
  round_id: string;
};

type LeagueRow = {
  id: string;
  format: string;
  use_handicap: boolean;
};

type RoundRow = {
  played_at: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return jsonResponse({ error: 'Server configuration error' }, 500);
    }

    const body = (await req.json()) as { league_round_id?: string };
    const leagueRoundId = body.league_round_id?.trim();
    if (!leagueRoundId) {
      return jsonResponse({ error: 'league_round_id is required' }, 400);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { data: lr, error: lrErr } = await userClient
      .from('league_rounds')
      .select('id, league_id, user_id, league_team_id, round_id')
      .eq('id', leagueRoundId)
      .maybeSingle();

    if (lrErr || !lr) {
      return jsonResponse({ error: 'League round not found' }, 404);
    }

    const leagueRound = lr as LeagueRoundRow;
    if (leagueRound.user_id !== user.id) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    const { data: league, error: leagueErr } = await userClient
      .from('leagues')
      .select('id, format, use_handicap')
      .eq('id', leagueRound.league_id)
      .maybeSingle();

    if (leagueErr || !league) {
      return jsonResponse({ error: 'League not found' }, 404);
    }

    const leagueRow = league as LeagueRow;
    if (leagueRow.format !== 'scramble' && leagueRow.format !== 'best_ball') {
      return jsonResponse(
        { error: 'Team hole calculation only applies to scramble and best ball tournaments' },
        400
      );
    }

    if (!leagueRound.league_team_id) {
      return jsonResponse({ error: 'Player is not on a team for this tournament' }, 400);
    }

    const { data: roundRow, error: roundErr } = await userClient
      .from('rounds')
      .select('played_at')
      .eq('id', leagueRound.round_id)
      .maybeSingle();

    if (roundErr || !roundRow) {
      return jsonResponse({ error: 'Round not found' }, 404);
    }

    const roundDate = (roundRow as RoundRow).played_at.slice(0, 10);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (leagueRow.format === 'scramble') {
      const { data: team, error: teamErr } = await admin
        .from('league_teams')
        .select('designated_scorer_id')
        .eq('id', leagueRound.league_team_id)
        .maybeSingle();

      if (teamErr || !team) {
        return jsonResponse({ error: 'Team not found' }, 404);
      }

      if (team.designated_scorer_id && team.designated_scorer_id !== user.id) {
        return jsonResponse({ error: 'Only the designated scorer can submit team hole scores' }, 403);
      }

      const { data: holes, error: holesErr } = await admin
        .from('tournament_hole_scores')
        .select('hole_number, gross_score, is_team_score')
        .eq('league_round_id', leagueRoundId)
        .order('hole_number');

      if (holesErr) {
        return jsonResponse({ error: holesErr.message }, 500);
      }

      const rows = (holes ?? []) as HoleRow[];
      if (rows.length < 18) {
        return jsonResponse({
          ok: true,
          partial: true,
          message: 'Fewer than 18 holes submitted; team scores not finalized',
          holes_count: rows.length,
        });
      }

      const upserts = rows.map((h) => ({
        league_id: leagueRow.id,
        league_team_id: leagueRound.league_team_id,
        round_date: roundDate,
        hole_number: h.hole_number,
        team_score: h.gross_score,
        team_net_score: h.gross_score,
        is_partial: false,
        source_league_round_id: leagueRoundId,
        updated_at: new Date().toISOString(),
      }));

      const { error: upsertErr } = await admin
        .from('tournament_team_hole_scores')
        .upsert(upserts, { onConflict: 'league_team_id,round_date,hole_number' });

      if (upsertErr) {
        return jsonResponse({ error: upsertErr.message }, 500);
      }

      return jsonResponse({
        ok: true,
        format: 'scramble',
        round_date: roundDate,
        holes_written: upserts.length,
        is_partial: false,
      });
    }

    // Best ball: min gross per hole across teammates who played on round_date
    const { data: entries, error: memErr } = await admin
      .from('league_entries')
      .select('user_id')
      .eq('league_id', leagueRow.id)
      .eq('league_team_id', leagueRound.league_team_id);

    if (memErr) {
      return jsonResponse({ error: memErr.message }, 500);
    }

    const memberIds = (entries ?? []).map((m: { user_id: string }) => m.user_id);
    if (memberIds.length === 0) {
      return jsonResponse({ error: 'Team has no members' }, 400);
    }

    const { data: teamRounds, error: trErr } = await admin
      .from('league_rounds')
      .select('id, user_id, hole_entry_status, rounds!inner(played_at)')
      .eq('league_id', leagueRow.id)
      .eq('league_team_id', leagueRound.league_team_id)
      .in('user_id', memberIds);

    if (trErr) {
      return jsonResponse({ error: trErr.message }, 500);
    }

    type TeamRoundJoined = {
      id: string;
      user_id: string;
      hole_entry_status: string;
      rounds: { played_at: string };
    };

    const roundIdsOnDate: string[] = [];
    const submittedMembers = new Set<string>();

    for (const tr of (teamRounds ?? []) as TeamRoundJoined[]) {
      const played = tr.rounds?.played_at?.slice(0, 10);
      if (played !== roundDate) continue;
      const include =
        tr.hole_entry_status === 'complete' || tr.id === leagueRoundId;
      if (!include) continue;
      roundIdsOnDate.push(tr.id);
      submittedMembers.add(tr.user_id);
    }

    if (!roundIdsOnDate.includes(leagueRoundId)) {
      roundIdsOnDate.push(leagueRoundId);
      submittedMembers.add(user.id);
    }

    const holesByNumber = new Map<number, number[]>();

    for (const lrid of roundIdsOnDate) {
      const { data: holeRows } = await admin
        .from('tournament_hole_scores')
        .select('hole_number, gross_score')
        .eq('league_round_id', lrid);

      for (const h of (holeRows ?? []) as { hole_number: number; gross_score: number | null }[]) {
        if (h.gross_score == null) continue;
        const list = holesByNumber.get(h.hole_number) ?? [];
        list.push(h.gross_score);
        holesByNumber.set(h.hole_number, list);
      }
    }

    const expectedMembers = memberIds.length;
    const isPartial = submittedMembers.size < expectedMembers;

    const upserts: Record<string, unknown>[] = [];
    for (let hole = 1; hole <= 18; hole++) {
      const scores = holesByNumber.get(hole);
      if (!scores?.length) continue;
      const teamScore = Math.min(...scores);
      upserts.push({
        league_id: leagueRow.id,
        league_team_id: leagueRound.league_team_id,
        round_date: roundDate,
        hole_number: hole,
        team_score: teamScore,
        team_net_score: teamScore,
        is_partial: isPartial,
        source_league_round_id: leagueRoundId,
        updated_at: new Date().toISOString(),
      });
    }

    if (upserts.length === 0) {
      return jsonResponse({
        ok: true,
        partial: true,
        message: 'No hole scores available for team calculation yet',
        holes_written: 0,
      });
    }

    const { error: upsertErr } = await admin
      .from('tournament_team_hole_scores')
      .upsert(upserts, { onConflict: 'league_team_id,round_date,hole_number' });

    if (upsertErr) {
      return jsonResponse({ error: upsertErr.message }, 500);
    }

    return jsonResponse({
      ok: true,
      format: 'best_ball',
      round_date: roundDate,
      holes_written: upserts.length,
      is_partial: isPartial,
      teammates_submitted: submittedMembers.size,
      teammates_expected: expectedMembers,
    });
  } catch (e) {
    console.error('[calculate-team-hole-scores]', e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : 'Calculation failed' },
      500
    );
  }
});
