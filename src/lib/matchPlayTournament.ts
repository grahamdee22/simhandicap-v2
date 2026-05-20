/**
 * Match Play tournament helpers (gross hole entry — not Social `matches` hub).
 */

import {
  compareMatchPlayGrossHoles,
  countComparedMatchPlayHoles,
  formatMatchPlayStatus,
  type MatchPlayRoundSummary,
} from './matchPlayGrossCompare';
import { invokeTournamentEdgeFunction } from './tournamentApi';
import type { TournamentHoleInput } from './tournamentHoleScores';
import type { MatchPlayHoleResult } from './tournamentTypes';

export type { MatchPlayRoundSummary } from './matchPlayGrossCompare';
export { compareMatchPlayGrossHoles, countComparedMatchPlayHoles, formatMatchPlayStatus };

export type CalculateMatchPlayResultResponse = {
  ok: boolean;
  league_round_id: string;
  holes_recorded: number;
  hole_entry_status: string;
  round_summary: MatchPlayRoundSummary;
  ready_for_standings: boolean;
  pairing_standings_updated: boolean;
  pairing?: {
    pairing_id?: string;
    status?: string;
    winner_entry_id?: string | null;
    awaiting_opponent?: boolean;
    holes_won_p1?: number;
    holes_won_p2?: number;
    holes_halved?: number;
  } | null;
  pairing_error?: string | null;
  note?: string;
  error?: string;
};

/** Running match score from W/L/H (e.g. after server computed results). */
export function computeMatchPlayRunningScore(holes: TournamentHoleInput[]): MatchPlayRoundSummary {
  let wins = 0;
  let losses = 0;
  let halved = 0;

  for (const h of holes) {
    const r = h.result;
    if (r === 'W') wins += 1;
    else if (r === 'L') losses += 1;
    else if (r === 'H') halved += 1;
  }

  return {
    wins,
    losses,
    halved,
    net_holes: wins - losses,
  };
}

export async function invokeCalculateMatchPlayResult(
  leagueRoundId: string,
  accessToken?: string
): Promise<{ data: CalculateMatchPlayResultResponse | null; error: string | null }> {
  const { data, error } = await invokeTournamentEdgeFunction<CalculateMatchPlayResultResponse>(
    'calculate-match-play-result',
    { league_round_id: leagueRoundId },
    accessToken
  );
  if (error) return { data: null, error };
  if (data && data.error) return { data: null, error: data.error };
  return { data, error: null };
}

/** Tournament match-play points (PRD §2.3). */
export function matchPlayPointsFromResult(result: 'win' | 'loss' | 'halve'): number {
  if (result === 'win') return 2;
  if (result === 'halve') return 1;
  return 0;
}
