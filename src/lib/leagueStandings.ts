import type { DbLeagueRow, DbLeagueEntryRow, DbLeagueRoundRow, DbLeagueTeamRow, LeagueFormat } from './leagues';
import { leagueRoundsForStandings } from './leagues';

export type LeagueStandingRow = {
  rank: number;
  entryId: string;
  userId: string | null;
  displayName: string;
  teamId: string | null;
  teamName: string | null;
  memberNames: string[];
  roundsPlayed: number;
  bestNet: number | null;
  avgNet: number | null;
  points: number;
  isTeam: boolean;
};

function bestNAverage(scores: number[], roundsThatCount: number): { best: number | null; avg: number | null } {
  if (scores.length === 0) return { best: null, avg: null };
  const sorted = [...scores].sort((a, b) => a - b);
  const k = Math.min(roundsThatCount, sorted.length);
  const bestSlice = sorted.slice(0, k);
  const sum = bestSlice.reduce((s, x) => s + x, 0);
  const avg = sum / bestSlice.length;
  return { best: sorted[0] ?? null, avg: Math.round(avg * 10) / 10 };
}

export function computeLeagueStandings(params: {
  league: DbLeagueRow;
  entries: DbLeagueEntryRow[];
  rounds: DbLeagueRoundRow[];
  teams: DbLeagueTeamRow[];
  displayNames: Record<string, string>;
  matchWinsByUser?: Record<string, number>;
}): LeagueStandingRow[] {
  const { league, entries, teams, displayNames, matchWinsByUser } = params;
  const rounds = leagueRoundsForStandings(params.rounds);
  const isTeamFormat = league.format === 'scramble' || league.format === 'best_ball';

  if (league.format === 'match_play') {
    const rows: LeagueStandingRow[] = entries.map((e) => {
      const wins = matchWinsByUser?.[e.user_id] ?? Number(e.points) ?? 0;
      return {
        rank: 0,
        entryId: e.id,
        userId: e.user_id,
        displayName: displayNames[e.user_id] ?? 'Golfer',
        teamId: e.league_team_id,
        teamName: null,
        memberNames: [],
        roundsPlayed: wins,
        bestNet: null,
        avgNet: null,
        points: wins,
        isTeam: false,
      };
    });
    rows.sort((a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName));
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  if (isTeamFormat) {
    const teamById = new Map(teams.map((t) => [t.id, t]));
    const membersByTeam = new Map<string, string[]>();
    for (const e of entries) {
      if (!e.league_team_id) continue;
      const list = membersByTeam.get(e.league_team_id) ?? [];
      list.push(displayNames[e.user_id] ?? 'Golfer');
      membersByTeam.set(e.league_team_id, list);
    }
    const scoresByTeam = new Map<string, number[]>();
    for (const r of rounds) {
      if (!r.league_team_id) continue;
      const list = scoresByTeam.get(r.league_team_id) ?? [];
      list.push(Number(r.net_score));
      scoresByTeam.set(r.league_team_id, list);
    }
    const rows: LeagueStandingRow[] = teams.map((t) => {
      const scores = scoresByTeam.get(t.id) ?? [];
      const { best, avg } = bestNAverage(scores, league.rounds_that_count);
      return {
        rank: 0,
        entryId: t.id,
        userId: null,
        displayName: t.name,
        teamId: t.id,
        teamName: t.name,
        memberNames: membersByTeam.get(t.id) ?? [],
        roundsPlayed: scores.length,
        bestNet: best,
        avgNet: avg,
        points: 0,
        isTeam: true,
      };
    });
    rows.sort((a, b) => {
      const av = a.avgNet ?? 999;
      const bv = b.avgNet ?? 999;
      if (av !== bv) return av - bv;
      return a.displayName.localeCompare(b.displayName);
    });
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  const teamMap = teamById(teams);
  const scoresByUser = new Map<string, number[]>();
  for (const r of rounds) {
    const list = scoresByUser.get(r.user_id) ?? [];
    list.push(Number(r.net_score));
    scoresByUser.set(r.user_id, list);
  }
  const rows: LeagueStandingRow[] = entries.map((e) => {
    const scores = scoresByUser.get(e.user_id) ?? [];
    const { best, avg } = bestNAverage(scores, league.rounds_that_count);
    return {
      rank: 0,
      entryId: e.id,
      userId: e.user_id,
      displayName: displayNames[e.user_id] ?? 'Golfer',
      teamId: e.league_team_id,
      teamName: e.league_team_id ? teamMap.get(e.league_team_id)?.name ?? null : null,
      memberNames: [],
      roundsPlayed: scores.length,
      bestNet: best,
      avgNet: avg,
      points: 0,
      isTeam: false,
    };
  });
  rows.sort((a, b) => {
    const av = a.avgNet ?? 999;
    const bv = b.avgNet ?? 999;
    if (av !== bv) return av - bv;
    return a.displayName.localeCompare(b.displayName);
  });
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

function teamById(teams: DbLeagueTeamRow[]): Map<string, DbLeagueTeamRow> {
  return new Map(teams.map((t) => [t.id, t]));
}

export function formatLeagueFormatLabel(format: LeagueFormat): string {
  switch (format) {
    case 'stroke':
      return 'Stroke Play';
    case 'match_play':
      return 'Match Play';
    case 'scramble':
      return 'Scramble';
    case 'best_ball':
      return 'Best Ball';
    default:
      return format;
  }
}

export function leagueDaysRemaining(league: DbLeagueRow): number {
  const end = new Date(`${league.end_date}T23:59:59`);
  const now = Date.now();
  const ms = end.getTime() - now;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export function isLeagueActive(league: DbLeagueRow): boolean {
  if (league.status !== 'active') return false;
  const today = new Date().toISOString().slice(0, 10);
  return today >= league.start_date && today <= league.end_date;
}
