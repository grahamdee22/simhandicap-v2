/**
 * Shared types and format helpers for tournament hole-by-hole scoring.
 */

import type { LeagueFormat } from './leagues';

export const TOURNAMENT_HOLE_COUNT = 18 as const;

export type HoleEntryStatus = 'complete' | 'pending_holes';

export type MatchPlayPairingMethod = 'random' | 'admin';

export type MatchPlayHoleResult = 'W' | 'L' | 'H';

export type DbTournamentHoleScoreRow = {
  id: string;
  league_entry_id: string;
  league_round_id: string;
  user_id: string;
  hole_number: number;
  gross_score: number | null;
  result: MatchPlayHoleResult | null;
  is_team_score: boolean;
  created_at: string;
  updated_at: string;
};

export type DbTournamentTeamHoleScoreRow = {
  id: string;
  league_id: string;
  league_team_id: string;
  round_date: string;
  hole_number: number;
  team_score: number;
  team_net_score: number | null;
  is_partial: boolean;
  source_league_round_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PendingTournamentHoleRound = {
  league_round_id: string;
  league_id: string;
  league_name: string;
  round_id: string;
  created_at: string;
};

/** Formats that require the post–log-round hole-by-hole screen (PRD §1.2). */
export function isHoleByHoleLeagueFormat(format: LeagueFormat): boolean {
  return format === 'match_play' || format === 'scramble' || format === 'best_ball';
}

/** Team formats require 18 holes when opting in at log time (PRD §6.5). */
export function teamFormatRequires18Holes(format: LeagueFormat): boolean {
  return format === 'scramble' || format === 'best_ball';
}

export function isMatchPlayHoleResult(value: string): value is MatchPlayHoleResult {
  return value === 'W' || value === 'L' || value === 'H';
}
