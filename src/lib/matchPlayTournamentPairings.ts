/**
 * Match play tournament pairings (not Social `matches`).
 */

import { restRpcPost, restSelect } from './tournamentApi';
import { resolveTournamentAccessToken } from './tournamentApi';

export type LeagueMatchPairingStatus = 'scheduled' | 'in_progress' | 'complete' | 'halved';

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
};

export type GeneratePairingsResult = {
  league_id: string;
  pairings_created: number;
  players_unpaired: number;
};

export type ApplyMatchPlayRoundResult = {
  pairing_id: string;
  status: LeagueMatchPairingStatus;
  winner_entry_id: string | null;
  holes_won_p1: number;
  holes_won_p2: number;
  holes_halved: number;
  submitter_net_holes: number;
};

export async function fetchLeagueMatchPairings(
  leagueId: string,
  accessToken?: string
): Promise<{ data: DbLeagueMatchPairingRow[] | null; error: string | null }> {
  const path = `league_match_pairings?league_id=eq.${encodeURIComponent(leagueId)}&order=created_at.asc`;
  return restSelect<DbLeagueMatchPairingRow>(path, accessToken);
}

export async function generateMatchPlayPairings(
  leagueId: string,
  accessToken?: string
): Promise<{ data: GeneratePairingsResult | null; error: string | null }> {
  const token = await resolveTournamentAccessToken(accessToken);
  if (!token) return { data: null, error: 'Not signed in' };
  return restRpcPost<GeneratePairingsResult>(token, 'generate_match_play_pairings', {
    p_league_id: leagueId,
  });
}

export async function applyMatchPlayLeagueRound(
  leagueRoundId: string,
  accessToken?: string
): Promise<{ data: ApplyMatchPlayRoundResult | null; error: string | null }> {
  const token = await resolveTournamentAccessToken(accessToken);
  if (!token) return { data: null, error: 'Not signed in' };
  return restRpcPost<ApplyMatchPlayRoundResult>(token, 'apply_match_play_league_round', {
    p_league_round_id: leagueRoundId,
  });
}

export function opponentEntryIdForPairing(
  pairing: DbLeagueMatchPairingRow,
  myEntryId: string
): string | null {
  if (pairing.player_1_entry_id === myEntryId) return pairing.player_2_entry_id;
  if (pairing.player_2_entry_id === myEntryId) return pairing.player_1_entry_id;
  return null;
}

export function myHolesWonInPairing(
  pairing: DbLeagueMatchPairingRow,
  myEntryId: string
): number {
  if (pairing.player_1_entry_id === myEntryId) return pairing.holes_won_p1;
  if (pairing.player_2_entry_id === myEntryId) return pairing.holes_won_p2;
  return 0;
}

export function formatPairingStatusLabel(status: LeagueMatchPairingStatus): string {
  switch (status) {
    case 'scheduled':
      return 'Scheduled';
    case 'in_progress':
      return 'In progress';
    case 'complete':
      return 'Complete';
    case 'halved':
      return 'Halved';
    default:
      return status;
  }
}

export function formatPairingResultLine(
  pairing: DbLeagueMatchPairingRow,
  myEntryId: string,
  opponentName: string
): string {
  if (pairing.status === 'scheduled') {
    return `vs ${opponentName} · not started`;
  }
  if (pairing.status === 'in_progress') {
    const mine = myHolesWonInPairing(pairing, myEntryId);
    const theirs =
      pairing.player_1_entry_id === myEntryId ? pairing.holes_won_p2 : pairing.holes_won_p1;
    return `vs ${opponentName} · ${mine}–${theirs} (${pairing.holes_halved} halved)`;
  }
  if (pairing.status === 'halved') {
    return `vs ${opponentName} · match halved`;
  }
  const won = pairing.winner_entry_id === myEntryId;
  return won ? `Beat ${opponentName}` : `Lost to ${opponentName}`;
}
