/**
 * Tournament standings helpers (format-specific logic expands in Phases 4–6).
 */

import type { DbLeagueRoundRow } from './leagues';

/** Why a league round is omitted from the leaderboard (PRD §5.2). */
export function standingExclusionReason(round: DbLeagueRoundRow): string | null {
  if (!round.player_opted_in) return 'Round was not applied to this tournament';
  if (round.hole_entry_status === 'pending_holes') {
    return 'Hole-by-hole scorecard not completed';
  }
  return null;
}

export function isRoundEligibleForStandings(round: DbLeagueRoundRow): boolean {
  return standingExclusionReason(round) === null;
}
