/**
 * League / tournament data access (group-scoped).
 */

import Constants from 'expo-constants';
import { supabase } from './supabase';
import { currentIndexFromRounds } from '../store/useAppStore';
import type { GroupMember } from '../store/useAppStore';
import type { SimRound } from '../store/useAppStore';

export const LEAGUE_FORMATS = ['stroke', 'match_play', 'scramble', 'best_ball'] as const;
export type LeagueFormat = (typeof LEAGUE_FORMATS)[number];
export type LeagueStatus = 'active' | 'completed' | 'archived';

export type DbLeagueRow = {
  id: string;
  group_id: string;
  name: string;
  format: LeagueFormat;
  scoring_method: string;
  start_date: string;
  end_date: string;
  rounds_that_count: number;
  use_handicap: boolean;
  created_by: string;
  status: LeagueStatus;
  created_at: string;
  updated_at: string;
};

export type DbLeagueTeamRow = {
  id: string;
  league_id: string;
  name: string;
  created_at: string;
};

export type DbLeagueEntryRow = {
  id: string;
  league_id: string;
  user_id: string;
  league_team_id: string | null;
  rounds_played: number;
  points: number;
  net_score: number | null;
  position: number | null;
};

export type DbLeagueRoundRow = {
  id: string;
  league_id: string;
  user_id: string;
  league_team_id: string | null;
  round_id: string;
  gross_score: number;
  net_score: number;
  counted: boolean;
  player_opted_in: boolean;
  created_at: string;
};

export type ActiveTournamentOption = {
  leagueId: string;
  leagueName: string;
  groupId: string;
  groupName: string;
  format: LeagueFormat;
};

export function isTeamLeagueFormat(format: LeagueFormat): boolean {
  return format === 'scramble' || format === 'best_ball';
}

export type LeagueBundle = {
  league: DbLeagueRow;
  teams: DbLeagueTeamRow[];
  entries: DbLeagueEntryRow[];
  rounds: DbLeagueRoundRow[];
};

function getSupabaseRestConfig(): { supabaseUrl: string; supabaseAnonKey: string } {
  const extra = Constants.expoConfig?.extra as
    | { supabaseUrl?: string; supabaseAnonKey?: string; supabasePublishableKey?: string }
    | undefined;
  return {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra?.supabaseUrl ?? '',
    supabaseAnonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_KEY ??
      extra?.supabaseAnonKey ??
      extra?.supabasePublishableKey ??
      '',
  };
}

async function restSelect<T>(
  path: string,
  accessToken?: string
): Promise<{ data: T[] | null; error: string | null }> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured' };
  const headers: Record<string, string> = { apikey: supabaseAnonKey };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { data: null, error: body || res.statusText };
  }
  const parsed = (await res.json()) as T[];
  return { data: Array.isArray(parsed) ? parsed : [], error: null };
}

export async function fetchLeaguesForGroup(
  groupId: string,
  accessToken?: string
): Promise<{ data: DbLeagueRow[] | null; error: string | null }> {
  if (accessToken) {
    return restSelect<DbLeagueRow>(
      `leagues?group_id=eq.${encodeURIComponent(groupId)}&order=created_at.desc`,
      accessToken
    );
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('leagues')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as DbLeagueRow[], error: null };
}

export async function fetchLeagueBundle(
  leagueId: string,
  accessToken?: string
): Promise<{ data: LeagueBundle | null; error: string | null }> {
  const leaguePath = `leagues?id=eq.${encodeURIComponent(leagueId)}&select=*`;
  const teamsPath = `league_teams?league_id=eq.${encodeURIComponent(leagueId)}&select=*`;
  const entriesPath = `league_entries?league_id=eq.${encodeURIComponent(leagueId)}&select=*`;
  const roundsPath = `league_rounds?league_id=eq.${encodeURIComponent(leagueId)}&select=*`;

  if (accessToken) {
    const [lRes, tRes, eRes, rRes] = await Promise.all([
      restSelect<DbLeagueRow>(leaguePath, accessToken),
      restSelect<DbLeagueTeamRow>(teamsPath, accessToken),
      restSelect<DbLeagueEntryRow>(entriesPath, accessToken),
      restSelect<DbLeagueRoundRow>(roundsPath, accessToken),
    ]);
    if (lRes.error || !lRes.data?.length) return { data: null, error: lRes.error ?? 'League not found' };
    return {
      data: {
        league: lRes.data[0],
        teams: tRes.data ?? [],
        entries: eRes.data ?? [],
        rounds: rRes.data ?? [],
      },
      error: null,
    };
  }

  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const [lRes, tRes, eRes, rRes] = await Promise.all([
    supabase.from('leagues').select('*').eq('id', leagueId).maybeSingle(),
    supabase.from('league_teams').select('*').eq('league_id', leagueId),
    supabase.from('league_entries').select('*').eq('league_id', leagueId),
    supabase.from('league_rounds').select('*').eq('league_id', leagueId),
  ]);
  if (lRes.error || !lRes.data) return { data: null, error: lRes.error?.message ?? 'League not found' };
  return {
    data: {
      league: lRes.data as DbLeagueRow,
      teams: (tRes.data ?? []) as DbLeagueTeamRow[],
      entries: (eRes.data ?? []) as DbLeagueEntryRow[],
      rounds: (rRes.data ?? []) as DbLeagueRoundRow[],
    },
    error: null,
  };
}

export async function syncLeagueStatuses(
  leagues: DbLeagueRow[],
  accessToken?: string
): Promise<DbLeagueRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const out = [...leagues];
  for (let i = 0; i < out.length; i++) {
    const l = out[i];
    if (l.status === 'active' && l.end_date < today) {
      await updateLeague(l.id, { status: 'completed' }, accessToken);
      out[i] = { ...l, status: 'completed' };
    }
  }
  return out;
}

export async function updateLeague(
  leagueId: string,
  patch: Partial<{
    name: string;
    end_date: string;
    status: LeagueStatus;
  }>,
  accessToken?: string
): Promise<{ error: string | null }> {
  const body = { ...patch, updated_at: new Date().toISOString() };
  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    const res = await fetch(`${supabaseUrl}/rest/v1/leagues?id=eq.${encodeURIComponent(leagueId)}`, {
      method: 'PATCH',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { error: await res.text().catch(() => res.statusText) };
    return { error: null };
  }
  if (!supabase) return { error: 'Supabase is not configured' };
  const { error } = await supabase.from('leagues').update(body).eq('id', leagueId);
  return { error: error?.message ?? null };
}

export async function deleteLeague(leagueId: string, accessToken?: string): Promise<{ error: string | null }> {
  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    const res = await fetch(`${supabaseUrl}/rest/v1/leagues?id=eq.${encodeURIComponent(leagueId)}`, {
      method: 'DELETE',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { error: await res.text().catch(() => res.statusText) };
    return { error: null };
  }
  if (!supabase) return { error: 'Supabase is not configured' };
  const { error } = await supabase.from('leagues').delete().eq('id', leagueId);
  return { error: error?.message ?? null };
}

export type CreateLeagueInput = {
  groupId: string;
  name: string;
  format: LeagueFormat;
  startDate: string;
  endDate: string;
  roundsThatCount: number;
  useHandicap: boolean;
  createdBy: string;
  members: GroupMember[];
  teams?: { name: string; memberUserIds: string[] }[];
};

export async function createLeague(
  input: CreateLeagueInput,
  accessToken?: string
): Promise<{ data: DbLeagueRow | null; error: string | null }> {
  const payload = {
    group_id: input.groupId,
    name: input.name.trim(),
    format: input.format,
    scoring_method: input.format,
    start_date: input.startDate,
    end_date: input.endDate,
    rounds_that_count: input.roundsThatCount,
    use_handicap: input.useHandicap !== false,
    created_by: input.createdBy,
    status: 'active' as const,
  };

  let league: DbLeagueRow | null = null;

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    const res = await fetch(`${supabaseUrl}/rest/v1/leagues`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify([payload]),
    });
    if (!res.ok) return { data: null, error: await res.text().catch(() => res.statusText) };
    const rows = (await res.json()) as DbLeagueRow[];
    league = rows[0] ?? null;
  } else {
    if (!supabase) return { data: null, error: 'Supabase is not configured' };
    const { data, error } = await supabase.from('leagues').insert(payload).select('*').single();
    if (error) return { data: null, error: error.message };
    league = data as DbLeagueRow;
  }

  if (!league) return { data: null, error: 'Could not create league' };

  const teamIdByUser = new Map<string, string>();

  if (input.teams?.length) {
    for (const team of input.teams) {
      let teamRow: DbLeagueTeamRow | null = null;
      if (accessToken) {
        const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
        const res = await fetch(`${supabaseUrl}/rest/v1/league_teams`, {
          method: 'POST',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify([{ league_id: league.id, name: team.name }]),
        });
        if (!res.ok) return { data: null, error: await res.text().catch(() => res.statusText) };
        const rows = (await res.json()) as DbLeagueTeamRow[];
        teamRow = rows[0] ?? null;
      } else if (supabase) {
        const { data, error } = await supabase
          .from('league_teams')
          .insert({ league_id: league.id, name: team.name })
          .select('*')
          .single();
        if (error) return { data: null, error: error.message };
        teamRow = data as DbLeagueTeamRow;
      }
      if (!teamRow) continue;
      for (const uid of team.memberUserIds) {
        teamIdByUser.set(uid, teamRow.id);
        const ins = { league_team_id: teamRow.id, user_id: uid };
        if (accessToken) {
          const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
          await fetch(`${supabaseUrl}/rest/v1/league_team_members`, {
            method: 'POST',
            headers: {
              apikey: supabaseAnonKey,
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify([ins]),
          });
        } else if (supabase) {
          await supabase.from('league_team_members').insert(ins);
        }
      }
    }
  }

  const entryRows = input.members
    .filter((m) => m.userId)
    .map((m) => ({
      league_id: league!.id,
      user_id: m.userId,
      league_team_id: teamIdByUser.get(m.userId) ?? null,
    }));

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    const res = await fetch(`${supabaseUrl}/rest/v1/league_entries`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(entryRows),
    });
    if (!res.ok) return { data: null, error: await res.text().catch(() => res.statusText) };
  } else if (supabase) {
    const { error } = await supabase.from('league_entries').insert(entryRows);
    if (error) return { data: null, error: error.message };
  }

  return { data: league, error: null };
}

export function netScoreForLeagueRound(gross: number, useHandicap: boolean, simIndex: number | null): number {
  if (!useHandicap || simIndex == null || !Number.isFinite(simIndex)) return gross;
  const strokes = Math.round(simIndex);
  return Math.max(1, gross - strokes);
}

/** Rounds that count in standings (player opted in at log time). */
export function leagueRoundsForStandings(rounds: DbLeagueRoundRow[]): DbLeagueRoundRow[] {
  return rounds.filter((r) => r.player_opted_in === true);
}

/** Active tournaments the user can apply a round to (by group membership + league entry). */
export async function fetchActiveTournamentsForUser(params: {
  userId: string;
  groups: { id: string; name: string }[];
  playedAt: string;
  accessToken?: string;
}): Promise<ActiveTournamentOption[]> {
  const playedYmd = params.playedAt.slice(0, 10);
  const out: ActiveTournamentOption[] = [];
  const seen = new Set<string>();

  for (const group of params.groups) {
    const { data: leagues } = await fetchLeaguesForGroup(group.id, params.accessToken);
    if (!leagues?.length) continue;
    const synced = await syncLeagueStatuses(leagues, params.accessToken);
    for (const league of synced) {
      if (league.status !== 'active') continue;
      if (league.format === 'match_play') continue;
      if (playedYmd < league.start_date || playedYmd > league.end_date) continue;
      if (seen.has(league.id)) continue;
      const bundleRes = await fetchLeagueBundle(league.id, params.accessToken);
      if (!bundleRes.data) continue;
      if (!bundleRes.data.entries.some((e) => e.user_id === params.userId)) continue;
      seen.add(league.id);
      out.push({
        leagueId: league.id,
        leagueName: league.name,
        groupId: group.id,
        groupName: group.name,
        format: league.format,
      });
    }
  }

  out.sort((a, b) => a.leagueName.localeCompare(b.leagueName));
  return out;
}

export type LeagueRoundRecordResult = {
  leagueName: string;
  leagueId: string;
  position: number;
  teamName: string | null;
  format: LeagueFormat;
};

/** Record league_round rows only for tournaments the player opted into at log time. */
export async function recordOptedInLeagueRounds(params: {
  userId: string;
  roundId: string;
  grossScore: number;
  playedAt: string;
  simIndex: number | null;
  selections: { leagueId: string; apply: boolean }[];
  displayNames?: Record<string, string>;
  accessToken?: string;
}): Promise<LeagueRoundRecordResult[]> {
  const results: LeagueRoundRecordResult[] = [];
  const applyIds = new Set(
    params.selections.filter((s) => s.apply).map((s) => s.leagueId)
  );
  if (applyIds.size === 0) return results;

  for (const leagueId of applyIds) {
    const bundleRes = await fetchLeagueBundle(leagueId, params.accessToken);
    if (!bundleRes.data) continue;
    const { league } = bundleRes.data;
    if (league.format === 'match_play') continue;

    const entry = bundleRes.data.entries.find((e) => e.user_id === params.userId);
    if (!entry) continue;

    const net = netScoreForLeagueRound(params.grossScore, league.use_handicap, params.simIndex);
    const row = {
      league_id: league.id,
      user_id: params.userId,
      league_team_id: entry.league_team_id,
      round_id: params.roundId,
      gross_score: params.grossScore,
      net_score: net,
      counted: true,
      player_opted_in: true,
    };

    if (params.accessToken) {
      const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
      await fetch(`${supabaseUrl}/rest/v1/league_rounds`, {
        method: 'POST',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify([row]),
      });
    } else if (supabase) {
      await supabase.from('league_rounds').insert(row);
    }

    const refreshed = await fetchLeagueBundle(league.id, params.accessToken);
    if (!refreshed.data) continue;
    const { computeLeagueStandings } = await import('./leagueStandings');
    const names: Record<string, string> = { ...(params.displayNames ?? {}) };
    for (const e of refreshed.data.entries) {
      if (!names[e.user_id]) names[e.user_id] = e.user_id;
    }
    const standings = computeLeagueStandings({
      league: refreshed.data.league,
      entries: refreshed.data.entries,
      rounds: refreshed.data.rounds,
      teams: refreshed.data.teams,
      displayNames: names,
    });
    const mine = standings.find((s) => s.userId === params.userId);
    let teamName: string | null = null;
    if (entry.league_team_id) {
      teamName = refreshed.data.teams.find((t) => t.id === entry.league_team_id)?.name ?? null;
    }
    results.push({
      leagueName: league.name,
      leagueId: league.id,
      position: mine?.rank ?? standings.length,
      teamName,
      format: league.format,
    });
  }

  return results;
}

export async function fetchMatchWinsForLeague(
  league: DbLeagueRow,
  memberUserIds: string[],
  accessToken?: string
): Promise<Record<string, number>> {
  const wins: Record<string, number> = {};
  for (const id of memberUserIds) wins[id] = 0;
  if (!memberUserIds.length) return wins;
  const idSet = new Set(memberUserIds);
  if (!supabase && !accessToken) return wins;

  let matches: { player_1_id: string; player_2_id: string | null; winner_id: string | null; status: string; created_at: string }[] = [];

  if (accessToken) {
    const or = memberUserIds.map((id) => `player_1_id.eq.${id},player_2_id.eq.${id}`).join(',');
    const res = await restSelect<typeof matches[0]>(
      `matches?or=(${or})&status=eq.complete&select=player_1_id,player_2_id,winner_id,status,created_at`,
      accessToken
    );
    matches = res.data ?? [];
  } else if (supabase) {
    const { data } = await supabase
      .from('matches')
      .select('player_1_id, player_2_id, winner_id, status, created_at')
      .eq('status', 'complete');
    matches = data ?? [];
  }

  for (const m of matches) {
    if (!m.player_2_id || !m.winner_id) continue;
    if (!idSet.has(m.player_1_id) || !idSet.has(m.player_2_id)) continue;
    const d = m.created_at.slice(0, 10);
    if (d < league.start_date || d > league.end_date) continue;
    if (idSet.has(m.winner_id)) wins[m.winner_id] = (wins[m.winner_id] ?? 0) + 1;
  }
  return wins;
}

export function simIndexForLeagueRecording(rounds: SimRound[]): number | null {
  return currentIndexFromRounds(rounds);
}
