/**
 * Match play pairing types (no runtime deps — safe for unit tests).
 */

export type LeagueMatchPairingStatus = 'scheduled' | 'in_progress' | 'complete' | 'halved';

export type BracketRound =
  | 'r1'
  | 'r2'
  | 'r3'
  | 'r4'
  | 'r5'
  | 'semifinal'
  | 'final';

export type DbLeagueMatchPairingRow = {
  id: string;
  league_id: string;
  player_1_entry_id: string;
  player_2_entry_id: string;
  status: LeagueMatchPairingStatus;
  winner_entry_id: string | null;
  holes_won_p1: number;
  holes_won_p2: number;
  holes_halved: number;
  scheduled_at: string | null;
  completed_at: string | null;
  created_at: string;
  bracket_round?: BracketRound | null;
  bracket_slot?: number;
  feeder_pairing_1_id?: string | null;
  feeder_pairing_2_id?: string | null;
};
