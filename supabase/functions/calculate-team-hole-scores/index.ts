import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';

/**
 * Scramble / Best Ball team hole aggregation.
 * When leagues.use_handicap is true:
 * - Scramble: team index = scramble_handicap_override OR 15% low + 85% high of member
 *   effective indexes → WHS course handicap from the scorer's tee → strokes by SI →
 *   team_net = team_gross − strokes on that hole.
 * - Best Ball: each player's effective index → course HC from their round's tee →
 *   per-hole net → team_score = min gross, team_net_score = min net.
 * When use_handicap is false (or indexes unresolved): team_net_score = team_score.
 */

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
  scramble_handicap_override: number | null;
};

type RoundRow = {
  played_at: string;
  course_rating: number;
  slope: number;
};

/** Default stroke index (1 = hardest) per hole — mirrors src/lib/netHandicap.ts. */
const DEFAULT_STROKE_INDEX_BY_HOLE: number[] = [
  9, 11, 7, 15, 3, 13, 1, 17, 5, 10, 12, 8, 16, 4, 14, 2, 18, 6,
];

const DEFAULT_COURSE_PAR = 72;
const SIMCAP_INDEX_MIN_ROUNDS = 3;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Same formula as src/lib/handicap.ts handicapIndexFromDifferentials. */
function handicapIndexFromDifferentials(adjusted: number[]): number | null {
  if (adjusted.length === 0) return null;
  const window = adjusted.slice(-20);
  const sorted = [...window].sort((a, b) => a - b);
  const k = Math.min(8, sorted.length);
  const best = sorted.slice(0, k);
  const avg = best.reduce((s, x) => s + x, 0) / best.length;
  return round1(avg * 0.96);
}

/** PRD §3.3 — 15% lowest + 85% highest index. */
function computeScrambleTeamIndex(memberIndexes: number[]): number | null {
  const sorted = memberIndexes.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const low = sorted[0]!;
  const high = sorted[sorted.length - 1]!;
  return Math.round((low * 0.15 + high * 0.85) * 10) / 10;
}

function whsCourseHandicapFromIndex(
  handicapIndex: number,
  courseRating: number,
  slope: number,
  coursePar: number
): number {
  const base = handicapIndex * (slope / 113) + (courseRating - coursePar);
  return Math.round(base);
}

/** Hole numbers (1–18) where strokes are applied, hardest SI first (laps if >18). */
function holesForStrokes(strokeCount: number, strokeIndexByHole: number[]): number[] {
  if (strokeCount <= 0) return [];
  const pairs = strokeIndexByHole.map((si, i) => ({ hole: i + 1, si }));
  pairs.sort((a, b) => a.si - b.si);
  const out: number[] = [];
  let left = strokeCount;
  let lap = 0;
  while (left > 0 && lap < 3) {
    for (const p of pairs) {
      if (left <= 0) break;
      out.push(p.hole);
      left--;
    }
    lap++;
  }
  return out;
}

/** Strokes to subtract from gross on this hole (negative for plus handicaps). */
function strokesReceivedOnHole(
  holeNumber: number,
  courseHandicap: number,
  strokeIndexByHole: number[] = DEFAULT_STROKE_INDEX_BY_HOLE
): number {
  if (!Number.isFinite(courseHandicap) || courseHandicap === 0) return 0;
  if (courseHandicap > 0) {
    return holesForStrokes(courseHandicap, strokeIndexByHole).filter((h) => h === holeNumber)
      .length;
  }
  return -holesForStrokes(-courseHandicap, strokeIndexByHole).filter((h) => h === holeNumber)
    .length;
}

function holeNet(gross: number, holeNumber: number, courseHandicap: number): number {
  return gross - strokesReceivedOnHole(holeNumber, courseHandicap);
}

type AdminClient = ReturnType<typeof createClient>;

/** SimCap index when 3+ rounds, else GHIN — mirrors resolveEffectiveHandicap. */
async function resolveMemberIndexes(
  admin: AdminClient,
  userIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, ghin_index')
    .in('id', userIds);

  const ghinByUser = new Map<string, number>();
  for (const p of (profiles ?? []) as { id: string; ghin_index: number | string | null }[]) {
    if (p.ghin_index != null && Number.isFinite(Number(p.ghin_index))) {
      const n = Number(p.ghin_index);
      if (n >= 0) ghinByUser.set(p.id, n);
    }
  }

  const { data: rounds } = await admin
    .from('rounds')
    .select('user_id, differential, played_at')
    .in('user_id', userIds)
    .eq('is_active', true)
    .order('played_at', { ascending: true });

  const diffsByUser = new Map<string, number[]>();
  for (const r of (rounds ?? []) as {
    user_id: string;
    differential: number | null;
    played_at: string;
  }[]) {
    if (r.differential == null || !Number.isFinite(Number(r.differential))) continue;
    const list = diffsByUser.get(r.user_id) ?? [];
    list.push(Number(r.differential));
    diffsByUser.set(r.user_id, list);
  }

  for (const uid of userIds) {
    const diffs = diffsByUser.get(uid) ?? [];
    if (diffs.length >= SIMCAP_INDEX_MIN_ROUNDS) {
      const idx = handicapIndexFromDifferentials(diffs);
      if (idx != null) {
        out.set(uid, idx);
        continue;
      }
    }
    const ghin = ghinByUser.get(uid);
    if (ghin != null) out.set(uid, ghin);
  }

  return out;
}

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
      .select('id, format, use_handicap, scramble_handicap_override')
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
      .select('played_at, course_rating, slope')
      .eq('id', leagueRound.round_id)
      .maybeSingle();

    if (roundErr || !roundRow) {
      return jsonResponse({ error: 'Round not found' }, 404);
    }

    const scorerRound = roundRow as RoundRow;
    const roundDate = scorerRound.played_at.slice(0, 10);
    const useHandicap = leagueRow.use_handicap === true;

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

      let courseHandicap: number | null = null;
      if (useHandicap) {
        const override =
          leagueRow.scramble_handicap_override != null &&
          Number.isFinite(Number(leagueRow.scramble_handicap_override))
            ? Number(leagueRow.scramble_handicap_override)
            : null;

        let teamIndex = override;
        if (teamIndex == null) {
          const { data: entries } = await admin
            .from('league_entries')
            .select('user_id')
            .eq('league_id', leagueRow.id)
            .eq('league_team_id', leagueRound.league_team_id);
          const memberIds = (entries ?? []).map((m: { user_id: string }) => m.user_id);
          const indexes = await resolveMemberIndexes(admin, memberIds);
          teamIndex = computeScrambleTeamIndex([...indexes.values()]);
        }

        if (teamIndex != null && Number.isFinite(teamIndex)) {
          courseHandicap = whsCourseHandicapFromIndex(
            teamIndex,
            Number(scorerRound.course_rating),
            Number(scorerRound.slope),
            DEFAULT_COURSE_PAR
          );
        }
      }

      const upserts = rows.map((h) => {
        const gross = h.gross_score;
        const net =
          gross == null
            ? null
            : courseHandicap == null
              ? gross
              : holeNet(gross, h.hole_number, courseHandicap);
        return {
          league_id: leagueRow.id,
          league_team_id: leagueRound.league_team_id,
          round_date: roundDate,
          hole_number: h.hole_number,
          team_score: gross,
          team_net_score: net,
          is_partial: false,
          source_league_round_id: leagueRoundId,
          updated_at: new Date().toISOString(),
        };
      });

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
        use_handicap: useHandicap,
        team_course_handicap: courseHandicap,
      });
    }

    // Best ball: min gross / min net per hole across teammates who played on round_date
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
      .select('id, user_id, hole_entry_status, round_id, rounds!inner(played_at, course_rating, slope)')
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
      round_id: string;
      rounds: { played_at: string; course_rating: number; slope: number };
    };

    const includedRounds: TeamRoundJoined[] = [];
    const submittedMembers = new Set<string>();

    for (const tr of (teamRounds ?? []) as TeamRoundJoined[]) {
      const played = tr.rounds?.played_at?.slice(0, 10);
      if (played !== roundDate) continue;
      const include = tr.hole_entry_status === 'complete' || tr.id === leagueRoundId;
      if (!include) continue;
      includedRounds.push(tr);
      submittedMembers.add(tr.user_id);
    }

    if (!includedRounds.some((r) => r.id === leagueRoundId)) {
      includedRounds.push({
        id: leagueRoundId,
        user_id: user.id,
        hole_entry_status: 'complete',
        round_id: leagueRound.round_id,
        rounds: {
          played_at: scorerRound.played_at,
          course_rating: scorerRound.course_rating,
          slope: scorerRound.slope,
        },
      });
      submittedMembers.add(user.id);
    }

    const memberIndexes = useHandicap
      ? await resolveMemberIndexes(admin, [...submittedMembers])
      : new Map<string, number>();

    type PlayerHole = { gross: number; courseHandicap: number | null };
    const holesByNumber = new Map<number, PlayerHole[]>();

    for (const tr of includedRounds) {
      const { data: holeRows } = await admin
        .from('tournament_hole_scores')
        .select('hole_number, gross_score')
        .eq('league_round_id', tr.id);

      let courseHandicap: number | null = null;
      if (useHandicap) {
        const idx = memberIndexes.get(tr.user_id);
        if (idx != null) {
          courseHandicap = whsCourseHandicapFromIndex(
            idx,
            Number(tr.rounds.course_rating),
            Number(tr.rounds.slope),
            DEFAULT_COURSE_PAR
          );
        }
      }

      for (const h of (holeRows ?? []) as { hole_number: number; gross_score: number | null }[]) {
        if (h.gross_score == null) continue;
        const list = holesByNumber.get(h.hole_number) ?? [];
        list.push({ gross: h.gross_score, courseHandicap });
        holesByNumber.set(h.hole_number, list);
      }
    }

    const expectedMembers = memberIds.length;
    const isPartial = submittedMembers.size < expectedMembers;

    const upserts: Record<string, unknown>[] = [];
    for (let hole = 1; hole <= 18; hole++) {
      const scores = holesByNumber.get(hole);
      if (!scores?.length) continue;
      const teamScore = Math.min(...scores.map((s) => s.gross));
      const nets = scores.map((s) =>
        s.courseHandicap == null ? s.gross : holeNet(s.gross, hole, s.courseHandicap)
      );
      const teamNet = Math.min(...nets);
      upserts.push({
        league_id: leagueRow.id,
        league_team_id: leagueRound.league_team_id,
        round_date: roundDate,
        hole_number: hole,
        team_score: teamScore,
        team_net_score: teamNet,
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
      use_handicap: useHandicap,
    });
  } catch (e) {
    console.error('[calculate-team-hole-scores]', e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : 'Calculation failed' },
      500
    );
  }
});
