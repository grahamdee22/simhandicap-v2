/**
 * Match Play tournament helpers (hole W/L/H — not Social `matches` hub).
 * Pairing standings: Phase 4 — see docs/PHASE4_MATCH_PLAY_PAIRINGS.md
 */

import { invokeTournamentEdgeFunction } from './tournamentApi';
import type { TournamentHoleInput } from './tournamentHoleScores';
import type { MatchPlayHoleResult } from './tournamentTypes';

export type MatchPlayRoundSummary = {
  wins: number;
  losses: number;
  halved: number;
  net_holes: number;
};

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
  } | null;
  pairing_error?: string | null;
  note?: string;
  error?: string;
};

/** Running match score from player's W/L/H perspective (e.g. +3 = "3 UP"). */
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

/** Display string e.g. "3 UP through 12" or "1 DOWN through 9" or "ALL SQUARE through 18". */
export function formatMatchPlayStatus(summary: MatchPlayRoundSummary, throughHole: number): string {
  const { net_holes: net } = summary;
  const through = Math.min(18, Math.max(0, throughHole));
  if (net === 0) {
    return through > 0 ? `ALL SQUARE through ${through}` : 'ALL SQUARE';
  }
  if (net > 0) return `${net} UP through ${through}`;
  return `${Math.abs(net)} DOWN through ${through}`;
}

export function cycleMatchPlayResult(current: MatchPlayHoleResult | null): MatchPlayHoleResult {
  if (current === 'W') return 'L';
  if (current === 'L') return 'H';
  return 'W';
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

/** Tournament match-play points (PRD §2.3) — for Phase 4 standings. */
export function matchPlayPointsFromResult(result: 'win' | 'loss' | 'halve'): number {
  if (result === 'win') return 2;
  if (result === 'halve') return 1;
  return 0;
}
