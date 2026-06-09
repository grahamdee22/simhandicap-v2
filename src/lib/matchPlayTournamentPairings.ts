/**
 * Match play tournament pairings (not Social `matches`).
 */

import { supabase } from './supabase';
import {
  formatPairingResultLine,
  formatPairingStatusLabel,
  myHolesWonInPairing,
  opponentEntryIdForPairing,
  pairingPlayerNames,
} from './matchPlayPairingDisplay';
import type {
  BracketRound,
  DbLeagueMatchPairingRow,
  LeagueMatchPairingStatus,
} from './matchPlayPairingTypes';
import { restRpcPost, restSelect, resolveTournamentAccessToken } from './tournamentApi';

export type { BracketRound, DbLeagueMatchPairingRow, LeagueMatchPairingStatus } from './matchPlayPairingTypes';
export {
  formatPairingResultLine,
  formatPairingStatusLabel,
  myHolesWonInPairing,
  opponentEntryIdForPairing,
  pairingPlayerNames,
} from './matchPlayPairingDisplay';

export type GeneratePairingsResult = {
  league_id: string;
  pairings_created: number;
  players_unpaired: number;
};

export type SaveAdminPairingsResult = {
  league_id: string;
  pairings_created: number;
};

export type GenerateBracketResult = {
  league_id: string;
  player_count: number;
  pairings_created: number;
  current_bracket_round: BracketRound;
};

export type AdminMatchPlayPairingInput = {
  player_1_user_id: string;
  player_2_user_id: string;
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
  const token = await resolveTournamentAccessToken(accessToken);
  if (token) {
    const path = `league_match_pairings?league_id=eq.${encodeURIComponent(leagueId)}&order=bracket_round.asc,bracket_slot.asc,created_at.asc`;
    return restSelect<DbLeagueMatchPairingRow>(path, token);
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('league_match_pairings')
    .select('*')
    .eq('league_id', leagueId)
    .order('bracket_round', { ascending: true })
    .order('bracket_slot', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as DbLeagueMatchPairingRow[], error: null };
}

export type LeagueMatchPairingRoundLink = {
  pairing_id: string;
  league_round_id: string;
  submitted_by_entry_id: string;
};

/** Load one tournament pairing by id (league_match_pairings — not Social matches). */
export async function fetchLeagueMatchPairingById(
  pairingId: string,
  accessToken?: string,
  leagueId?: string
): Promise<{ data: DbLeagueMatchPairingRow | null; error: string | null }> {
  const id = pairingId.trim();
  if (!id) return { data: null, error: 'Missing pairing id' };

  const token = await resolveTournamentAccessToken(accessToken);
  if (token) {
    const path = `league_match_pairings?id=eq.${encodeURIComponent(id)}&limit=1`;
    const res = await restSelect<DbLeagueMatchPairingRow>(path, token);
    if (res.data?.[0]) return { data: res.data[0], error: null };
    if (leagueId) {
      const leagueRes = await fetchLeagueMatchPairings(leagueId, token);
      const hit = leagueRes.data?.find((p) => p.id === id) ?? null;
      if (hit) return { data: hit, error: null };
    }
    if (res.error) return { data: null, error: res.error };
  }

  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('league_match_pairings')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  if (data) return { data: data as DbLeagueMatchPairingRow, error: null };
  if (leagueId) {
    const leagueRes = await fetchLeagueMatchPairings(leagueId, accessToken);
    const hit = leagueRes.data?.find((p) => p.id === id) ?? null;
    return hit ? { data: hit, error: null } : { data: null, error: 'Tournament match not found' };
  }
  return { data: null, error: 'Tournament match not found' };
}

export async function fetchLeagueMatchPairingRoundLinks(
  pairingId: string,
  accessToken?: string
): Promise<{ data: LeagueMatchPairingRoundLink[] | null; error: string | null }> {
  const id = pairingId.trim();
  if (!id) return { data: [], error: null };

  const token = await resolveTournamentAccessToken(accessToken);
  const path = `league_match_pairing_rounds?pairing_id=eq.${encodeURIComponent(id)}&select=pairing_id,league_round_id,submitted_by_entry_id`;
  if (token) {
    return restSelect<LeagueMatchPairingRoundLink>(path, token);
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('league_match_pairing_rounds')
    .select('pairing_id, league_round_id, submitted_by_entry_id')
    .eq('pairing_id', id);
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as LeagueMatchPairingRoundLink[], error: null };
}

export async function generateMatchPlayBracket(
  leagueId: string,
  seededUserIds: string[],
  accessToken?: string
): Promise<{ data: GenerateBracketResult | null; error: string | null }> {
  const token = await resolveTournamentAccessToken(accessToken);
  if (!token) return { data: null, error: 'Not signed in' };
  return restRpcPost<GenerateBracketResult>(token, 'generate_match_play_bracket', {
    p_league_id: leagueId,
    p_seeded_user_ids: seededUserIds,
  });
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

export async function saveAdminMatchPlayPairings(
  leagueId: string,
  pairings: AdminMatchPlayPairingInput[],
  accessToken?: string
): Promise<{ data: SaveAdminPairingsResult | null; error: string | null }> {
  const token = await resolveTournamentAccessToken(accessToken);
  if (!token) return { data: null, error: 'Not signed in' };
  return restRpcPost<SaveAdminPairingsResult>(token, 'save_admin_match_play_pairings', {
    p_league_id: leagueId,
    p_pairings: pairings,
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

