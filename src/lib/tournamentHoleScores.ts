/**
 * Tournament hole-by-hole score entry, validation, and persistence.
 */

import { supabase } from './supabase';
import type { LeagueFormat } from './leagues';
import { restRpcPost, restSelect, resolveTournamentAccessToken } from './tournamentApi';
import {
  isHoleByHoleLeagueFormat,
  TOURNAMENT_HOLE_COUNT,
  type DbTournamentHoleScoreRow,
  type MatchPlayHoleResult,
  type PendingTournamentHoleRound,
} from './tournamentTypes';

export type TournamentHoleInput = {
  hole_number: number;
  gross_score?: number | null;
  result?: MatchPlayHoleResult | null;
  is_team_score?: boolean;
};

export type UpsertTournamentHolesResult = {
  league_round_id: string;
  holes_saved: number;
  hole_entry_status: 'complete' | 'pending_holes';
};

export type { GrossReconciliation } from './tournamentReconciliation';
export { reconcileGrossWithHoles, sumGrossFromHoles } from './tournamentReconciliation';

/** Empty 18-hole draft for scorecard UI. */
export function emptyTournamentHoleDraft(): TournamentHoleInput[] {
  return Array.from({ length: TOURNAMENT_HOLE_COUNT }, (_, i) => ({
    hole_number: i + 1,
    gross_score: null,
    result: null,
    is_team_score: false,
  }));
}

export function rowsToHoleDraft(rows: DbTournamentHoleScoreRow[]): TournamentHoleInput[] {
  const draft = emptyTournamentHoleDraft();
  for (const r of rows) {
    const idx = r.hole_number - 1;
    if (idx < 0 || idx >= TOURNAMENT_HOLE_COUNT) continue;
    draft[idx] = {
      hole_number: r.hole_number,
      gross_score: r.gross_score,
      result: r.result,
      is_team_score: r.is_team_score,
    };
  }
  return draft;
}

export function countFilledHoles(
  holes: TournamentHoleInput[],
  format: LeagueFormat
): number {
  return holes.filter((h) => isHoleComplete(h, format)).length;
}

export function isHoleComplete(hole: TournamentHoleInput, format: LeagueFormat): boolean {
  if (format === 'match_play') {
    return hole.gross_score != null && Number.isFinite(hole.gross_score);
  }
  return hole.gross_score != null && Number.isFinite(hole.gross_score);
}

type PendingHolesListener = () => void;
const pendingHolesListeners = new Set<PendingHolesListener>();

/** Notify tab banners to refresh after a scorecard is submitted. */
export function subscribePendingTournamentHoles(listener: PendingHolesListener): () => void {
  pendingHolesListeners.add(listener);
  return () => pendingHolesListeners.delete(listener);
}

export function notifyPendingTournamentHolesUpdated(): void {
  for (const listener of pendingHolesListeners) {
    listener();
  }
}

export function isScorecardComplete(holes: TournamentHoleInput[], format: LeagueFormat): boolean {
  return countFilledHoles(holes, format) >= TOURNAMENT_HOLE_COUNT;
}

export async function fetchTournamentHoleScores(
  leagueRoundId: string,
  accessToken?: string
): Promise<{ data: DbTournamentHoleScoreRow[] | null; error: string | null }> {
  const path = `tournament_hole_scores?league_round_id=eq.${encodeURIComponent(leagueRoundId)}&order=hole_number.asc`;

  if (accessToken) {
    return restSelect<DbTournamentHoleScoreRow>(path, accessToken);
  }

  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('tournament_hole_scores')
    .select('*')
    .eq('league_round_id', leagueRoundId)
    .order('hole_number', { ascending: true });

  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as DbTournamentHoleScoreRow[], error: null };
}

export async function upsertTournamentHoleScores(
  leagueRoundId: string,
  holes: TournamentHoleInput[],
  accessToken?: string
): Promise<{ data: UpsertTournamentHolesResult | null; error: string | null }> {
  const token = await resolveTournamentAccessToken(accessToken);
  if (!token) return { data: null, error: 'Not signed in' };

  const payload = holes
    .filter((h) => h.gross_score != null || h.result != null)
    .map((h) => ({
      hole_number: h.hole_number,
      gross_score: h.gross_score ?? null,
      result: h.result ?? null,
      is_team_score: h.is_team_score ?? false,
    }));

  const { data, error } = await restRpcPost<UpsertTournamentHolesResult>(
    token,
    'upsert_tournament_hole_scores',
    {
      p_league_round_id: leagueRoundId,
      p_holes: payload,
    }
  );

  if (error) return { data: null, error };
  if (!data) return { data: null, error: 'Empty response from server' };
  if (data.hole_entry_status === 'complete') {
    notifyPendingTournamentHolesUpdated();
  }
  return { data, error: null };
}

/** Global pending-holes banner (PRD §5.2). */
export async function listPendingTournamentHoleRounds(
  accessToken?: string
): Promise<{ data: PendingTournamentHoleRound[] | null; error: string | null }> {
  const token = await resolveTournamentAccessToken(accessToken);
  if (!token) return { data: null, error: 'Not signed in' };

  const { data, error } = await restRpcPost<PendingTournamentHoleRound[]>(
    token,
    'list_pending_tournament_hole_rounds',
    {}
  );

  if (error) return { data: null, error };
  return { data: data ?? [], error: null };
}

export function formatRequiresHoleEntryAfterLog(format: LeagueFormat): boolean {
  return isHoleByHoleLeagueFormat(format);
}
