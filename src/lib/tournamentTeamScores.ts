/**
 * Team hole score aggregation (Scramble / Best Ball) via edge function + reads.
 */

import { supabase } from './supabase';
import { invokeTournamentEdgeFunction, restSelect } from './tournamentApi';
import type { DbTournamentTeamHoleScoreRow } from './tournamentTypes';

export type CalculateTeamHoleScoresResult = {
  ok: boolean;
  format?: 'scramble' | 'best_ball';
  round_date?: string;
  holes_written?: number;
  is_partial?: boolean;
  partial?: boolean;
  teammates_submitted?: number;
  teammates_expected?: number;
  message?: string;
  error?: string;
};

export async function invokeCalculateTeamHoleScores(
  leagueRoundId: string,
  accessToken?: string
): Promise<{ data: CalculateTeamHoleScoresResult | null; error: string | null }> {
  const { data, error } = await invokeTournamentEdgeFunction<CalculateTeamHoleScoresResult>(
    'calculate-team-hole-scores',
    { league_round_id: leagueRoundId },
    accessToken
  );
  if (error) return { data: null, error };
  if (data && data.error) return { data: null, error: data.error };
  return { data, error: null };
}

export async function fetchTeamHoleScoresForRoundDate(params: {
  leagueTeamId: string;
  roundDate: string;
  accessToken?: string;
}): Promise<{ data: DbTournamentTeamHoleScoreRow[] | null; error: string | null }> {
  const path =
    `tournament_team_hole_scores?league_team_id=eq.${encodeURIComponent(params.leagueTeamId)}` +
    `&round_date=eq.${encodeURIComponent(params.roundDate)}` +
    '&order=hole_number.asc';

  if (params.accessToken) {
    return restSelect<DbTournamentTeamHoleScoreRow>(path, params.accessToken);
  }

  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('tournament_team_hole_scores')
    .select('*')
    .eq('league_team_id', params.leagueTeamId)
    .eq('round_date', params.roundDate)
    .order('hole_number', { ascending: true });

  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as DbTournamentTeamHoleScoreRow[], error: null };
}

export function sumTeamHoleGross(rows: DbTournamentTeamHoleScoreRow[]): number | null {
  if (rows.length === 0) return null;
  return rows.reduce((s, r) => s + r.team_score, 0);
}

export async function fetchTeamHoleScoresForLeague(
  leagueId: string,
  accessToken?: string
): Promise<{ data: DbTournamentTeamHoleScoreRow[] | null; error: string | null }> {
  const path =
    `tournament_team_hole_scores?league_id=eq.${encodeURIComponent(leagueId)}` +
    '&order=round_date.desc,hole_number.asc';
  return restSelect<DbTournamentTeamHoleScoreRow>(path, accessToken);
}
