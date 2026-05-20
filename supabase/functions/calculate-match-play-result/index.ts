import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';

/**
 * Apply a completed gross scorecard to match play pairings.
 * W/L/H and standings update when both players have submitted.
 */

type HoleGrossRow = {
  hole_number: number;
  gross_score: number | null;
  result: string | null;
};

type LeagueRoundRow = {
  id: string;
  league_id: string;
  user_id: string;
  hole_entry_status: string;
};

type LeagueRow = {
  id: string;
  format: string;
};

type ApplyRpcResult = {
  pairing_id?: string;
  status?: string;
  winner_entry_id?: string | null;
  holes_won_p1?: number;
  holes_won_p2?: number;
  holes_halved?: number;
  awaiting_opponent?: boolean;
  complete_rounds?: number;
  points_awarded?: boolean;
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

    if (!supabaseUrl || !supabaseAnonKey) {
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
      .select('id, league_id, user_id, hole_entry_status')
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
      .select('id, format')
      .eq('id', leagueRound.league_id)
      .maybeSingle();

    if (leagueErr || !league) {
      return jsonResponse({ error: 'League not found' }, 404);
    }

    const leagueRow = league as LeagueRow;
    if (leagueRow.format !== 'match_play') {
      return jsonResponse(
        { error: 'Match play calculation only applies to match play tournaments' },
        400
      );
    }

    const { data: holes, error: holesErr } = await userClient
      .from('tournament_hole_scores')
      .select('hole_number, gross_score, result')
      .eq('league_round_id', leagueRoundId)
      .order('hole_number');

    if (holesErr) {
      return jsonResponse({ error: holesErr.message }, 500);
    }

    const rows = (holes ?? []) as HoleGrossRow[];
    const grossCount = rows.filter((h) => h.gross_score != null).length;
    const readyForStandings =
      grossCount >= 18 && leagueRound.hole_entry_status === 'complete';

    let pairingApply: ApplyRpcResult | null = null;
    let pairingError: string | null = null;

    if (readyForStandings) {
      const { data: applied, error: applyErr } = await userClient.rpc(
        'apply_match_play_league_round',
        { p_league_round_id: leagueRoundId }
      );
      if (applyErr) {
        pairingError = applyErr.message;
      } else {
        pairingApply = (applied ?? null) as ApplyRpcResult | null;
      }
    }

    let wins = 0;
    let losses = 0;
    let halved = 0;
    for (const h of rows) {
      const r = h.result?.toUpperCase();
      if (r === 'W') wins += 1;
      else if (r === 'L') losses += 1;
      else if (r === 'H') halved += 1;
    }

    return jsonResponse({
      ok: true,
      league_round_id: leagueRoundId,
      holes_recorded: grossCount,
      hole_entry_status: leagueRound.hole_entry_status,
      round_summary: {
        wins,
        losses,
        halved,
        net_holes: wins - losses,
      },
      ready_for_standings: readyForStandings,
      pairing_standings_updated:
        !!pairingApply && !pairingError && pairingApply.awaiting_opponent === false,
      pairing: pairingApply,
      pairing_error: pairingError,
      note:
        pairingApply?.awaiting_opponent === true
          ? 'Waiting for your opponent to submit their scorecard.'
          : undefined,
    });
  } catch (e) {
    console.error('[calculate-match-play-result]', e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : 'Calculation failed' },
      500
    );
  }
});
