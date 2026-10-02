/**
 * Season rows and the standings board (points are computed on read).
 */

import type { DbLeagueRow, LeagueBundle } from './leagues';
import { fetchLeagueBundle } from './leagues';
import { fetchLeagueMatchPairings } from './matchPlayTournamentPairings';
import { computeLeagueStandings } from './computeLeagueStandings';
import {
  computeSeasonStandings,
  playerPointsFromTournament,
  type SeasonEventResult,
  type SeasonStandingRow,
} from './seasonPoints';
import { supabase } from './supabase';
import { fetchTeamHoleScoresForLeague } from './tournamentTeamScores';
import { getSupabaseRestConfig, restSelect } from './tournamentApi';

export type SeasonStatus = 'active' | 'completed' | 'archived';

export type DbLeagueSeasonRow = {
  id: string;
  group_id: string;
  name: string;
  start_date: string;
  end_date: string | null;
  events_that_count: number | null;
  status: SeasonStatus;
  created_by: string;
  created_at: string;
};

export type CreateSeasonInput = {
  groupId: string;
  name: string;
  startDate: string;
  endDate: string | null;
  eventsThatCount: number | null;
  createdBy: string;
};

export type SeasonBoard = {
  season: DbLeagueSeasonRow;
  leagues: DbLeagueRow[];
  standings: SeasonStandingRow[];
};

function finished(status: string): boolean {
  return status === 'completed' || status === 'archived';
}

async function restWrite<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  accessToken: string
): Promise<{ data: T[] | null; error: string | null }> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured' };
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { data: null, error: text || res.statusText };
  }
  const parsed = (await res.json()) as T[];
  return { data: Array.isArray(parsed) ? parsed : [], error: null };
}

export async function fetchSeasonsForGroup(
  groupId: string,
  accessToken?: string
): Promise<{ data: DbLeagueSeasonRow[] | null; error: string | null }> {
  const path = `league_seasons?group_id=eq.${encodeURIComponent(groupId)}&order=created_at.desc`;
  if (accessToken) return restSelect<DbLeagueSeasonRow>(path, accessToken);
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('league_seasons')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as DbLeagueSeasonRow[], error: null };
}

export async function fetchActiveSeasonForGroup(
  groupId: string,
  accessToken?: string
): Promise<{ data: DbLeagueSeasonRow | null; error: string | null }> {
  const res = await fetchSeasonsForGroup(groupId, accessToken);
  if (res.error) return { data: null, error: res.error };
  return { data: (res.data ?? []).find((s) => s.status === 'active') ?? null, error: null };
}

export async function fetchSeasonById(
  seasonId: string,
  accessToken?: string
): Promise<{ data: DbLeagueSeasonRow | null; error: string | null }> {
  const path = `league_seasons?id=eq.${encodeURIComponent(seasonId)}&limit=1`;
  if (accessToken) {
    const res = await restSelect<DbLeagueSeasonRow>(path, accessToken);
    return { data: res.data?.[0] ?? null, error: res.error };
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('league_seasons')
    .select('*')
    .eq('id', seasonId)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: (data as DbLeagueSeasonRow | null) ?? null, error: null };
}

export async function createSeason(
  input: CreateSeasonInput,
  accessToken?: string
): Promise<{ data: DbLeagueSeasonRow | null; error: string | null }> {
  const payload = {
    group_id: input.groupId,
    name: input.name.trim(),
    start_date: input.startDate,
    end_date: input.endDate,
    events_that_count: input.eventsThatCount,
    status: 'active' as const,
    created_by: input.createdBy,
  };
  if (accessToken) {
    const res = await restWrite<DbLeagueSeasonRow>('POST', 'league_seasons', [payload], accessToken);
    if (res.error) return { data: null, error: res.error };
    return { data: res.data?.[0] ?? null, error: null };
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase.from('league_seasons').insert(payload).select('*').single();
  if (error) return { data: null, error: error.message };
  return { data: data as DbLeagueSeasonRow, error: null };
}

export async function updateSeasonStatus(
  seasonId: string,
  status: SeasonStatus,
  accessToken?: string
): Promise<{ error: string | null }> {
  if (accessToken) {
    const res = await restWrite<DbLeagueSeasonRow>(
      'PATCH',
      `league_seasons?id=eq.${encodeURIComponent(seasonId)}`,
      { status },
      accessToken
    );
    return { error: res.error };
  }
  if (!supabase) return { error: 'Supabase is not configured' };
  const { error } = await supabase.from('league_seasons').update({ status }).eq('id', seasonId);
  return { error: error?.message ?? null };
}

async function fetchLeaguesForSeason(
  seasonId: string,
  accessToken?: string
): Promise<{ data: DbLeagueRow[] | null; error: string | null }> {
  const path = `leagues?season_id=eq.${encodeURIComponent(seasonId)}&order=start_date.asc,created_at.asc`;
  if (accessToken) return restSelect<DbLeagueRow>(path, accessToken);
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('leagues')
    .select('*')
    .eq('season_id', seasonId)
    .order('start_date', { ascending: true });
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as DbLeagueRow[], error: null };
}

async function pointsForFinishedLeague(
  league: DbLeagueRow,
  accessToken: string | undefined,
  displayNames: Record<string, string>
): Promise<SeasonEventResult[]> {
  const bundleRes = await fetchLeagueBundle(league.id, accessToken);
  const bundle: LeagueBundle | null = bundleRes.data;
  if (!bundle) return [];

  let teamHoleScores = undefined;
  if (league.format === 'best_ball' || league.format === 'scramble') {
    const th = await fetchTeamHoleScoresForLeague(league.id, accessToken);
    teamHoleScores = th.data ?? undefined;
  }
  const standings = computeLeagueStandings({
    league: bundle.league,
    entries: bundle.entries,
    rounds: bundle.rounds,
    teams: bundle.teams,
    displayNames,
    teamHoleScores,
  });

  let pairings = undefined;
  if (league.format === 'match_play') {
    const pr = await fetchLeagueMatchPairings(league.id, accessToken);
    pairings = pr.data ?? [];
  }

  return playerPointsFromTournament({
    format: league.format,
    pairingMethod: league.match_play_pairing_method,
    standings,
    entries: bundle.entries,
    pairings,
  });
}

export async function fetchSeasonBoard(
  seasonId: string,
  accessToken: string | undefined,
  displayNames: Record<string, string>
): Promise<{ data: SeasonBoard | null; error: string | null }> {
  const seasonRes = await fetchSeasonById(seasonId, accessToken);
  if (seasonRes.error) return { data: null, error: seasonRes.error };
  if (!seasonRes.data) return { data: null, error: 'Season not found' };

  const leaguesRes = await fetchLeaguesForSeason(seasonId, accessToken);
  if (leaguesRes.error) return { data: null, error: leaguesRes.error };
  const leagues = leaguesRes.data ?? [];

  const results: SeasonEventResult[] = [];
  for (const league of leagues) {
    if (!finished(league.status)) continue;
    try {
      const points = await pointsForFinishedLeague(league, accessToken, displayNames);
      results.push(...points);
    } catch {
      // One tournament's bundle failing leaves the rest of the board intact.
    }
  }

  return {
    data: {
      season: seasonRes.data,
      leagues,
      standings: computeSeasonStandings(
        results,
        seasonRes.data.events_that_count,
        displayNames
      ),
    },
    error: null,
  };
}
