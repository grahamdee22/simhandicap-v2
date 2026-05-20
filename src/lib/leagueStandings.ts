import {
  aggregateBestBallTeamRounds,
  bestBallStandingsScores,
} from './bestBallTournament';
import { designatedScorerLabel } from './scrambleTournament';
import type { DbTournamentTeamHoleScoreRow } from './tournamentTypes';
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
  /** Best N average net (displayed as "Low Net"). */
  lowNet: number | null;
  /** Team formats: best gross among counting rounds. */
  bestGross: number | null;
  points: number;
  isTeam: boolean;
  /** Scramble: who logs team rounds */
  designatedScorerName?: string | null;
  /** Best ball: waiting on teammate hole cards */
  hasPartialPending?: boolean;
  mpWins?: number;
  mpLosses?: number;
  mpHalved?: number;
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
  teamHoleScores?: DbTournamentTeamHoleScoreRow[];
}): LeagueStandingRow[] {
  const { league, entries, teams, displayNames } = params;
  const rounds = leagueRoundsForStandings(params.rounds);
  const isTeamFormat = league.format === 'scramble' || league.format === 'best_ball';

  if (league.format === 'match_play') {
    const rows: LeagueStandingRow[] = entries.map((e) => {
      const mpWins = e.mp_wins ?? 0;
      const mpLosses = e.mp_losses ?? 0;
      const mpHalved = e.mp_halved ?? 0;
      const matchesPlayed = mpWins + mpLosses + mpHalved;
      return {
        rank: 0,
        entryId: e.id,
        userId: e.user_id,
        displayName: displayNames[e.user_id] ?? 'Golfer',
        teamId: e.league_team_id,
        teamName: null,
        memberNames: [],
        roundsPlayed: matchesPlayed,
        bestNet: null,
        lowNet: null,
        bestGross: null,
        points: Number(e.points) ?? 0,
        isTeam: false,
        mpWins,
        mpLosses,
        mpHalved,
      };
    });
    rows.sort(
      (a, b) =>
        b.points - a.points ||
        (b.mpWins ?? 0) - (a.mpWins ?? 0) ||
        a.displayName.localeCompare(b.displayName)
    );
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
    const netByTeam = new Map<string, number[]>();
    const grossByTeam = new Map<string, number[]>();
    const partialByTeam = new Map<string, boolean>();

    if (league.format === 'best_ball' && params.teamHoleScores?.length) {
      for (const t of teams) {
        const aggregates = aggregateBestBallTeamRounds(
          params.teamHoleScores,
          t.id,
          league.use_handicap
        );
        const { netScores, grossScores, hasPartialPending } = bestBallStandingsScores(
          aggregates,
          league.use_handicap
        );
        netByTeam.set(t.id, netScores);
        grossByTeam.set(t.id, grossScores);
        partialByTeam.set(t.id, hasPartialPending);
      }
    } else {
      for (const r of rounds) {
        if (!r.league_team_id) continue;
        const nets = netByTeam.get(r.league_team_id) ?? [];
        nets.push(Number(r.net_score));
        netByTeam.set(r.league_team_id, nets);
        const grosses = grossByTeam.get(r.league_team_id) ?? [];
        grosses.push(Number(r.gross_score));
        grossByTeam.set(r.league_team_id, grosses);
      }
    }

    const rows: LeagueStandingRow[] = teams.map((t) => {
      const netScores = netByTeam.get(t.id) ?? [];
      const grossScores = grossByTeam.get(t.id) ?? [];
      const { best: bestNet, avg: lowNet } = bestNAverage(netScores, league.rounds_that_count);
      const { best: bestGross } = bestNAverage(grossScores, league.rounds_that_count);
      const scorerName =
        league.format === 'scramble' ? designatedScorerLabel(t, displayNames) : null;
      return {
        rank: 0,
        entryId: t.id,
        userId: null,
        displayName: t.name,
        teamId: t.id,
        teamName: t.name,
        memberNames: membersByTeam.get(t.id) ?? [],
        roundsPlayed: netScores.length,
        bestNet,
        lowNet,
        bestGross,
        points: 0,
        isTeam: true,
        designatedScorerName: scorerName,
        hasPartialPending: partialByTeam.get(t.id) ?? false,
      };
    });
    rows.sort((a, b) => {
      const av = a.lowNet ?? 999;
      const bv = b.lowNet ?? 999;
      if (av !== bv) return av - bv;
      return a.displayName.localeCompare(b.displayName);
    });
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  const teamMap = teamById(teams);
  const netByUser = new Map<string, number[]>();
  const grossByUser = new Map<string, number[]>();
  for (const r of rounds) {
    const nets = netByUser.get(r.user_id) ?? [];
    nets.push(Number(r.net_score));
    netByUser.set(r.user_id, nets);
    const grosses = grossByUser.get(r.user_id) ?? [];
    grosses.push(Number(r.gross_score));
    grossByUser.set(r.user_id, grosses);
  }
  const rows: LeagueStandingRow[] = entries.map((e) => {
    const netScores = netByUser.get(e.user_id) ?? [];
    const grossScores = grossByUser.get(e.user_id) ?? [];
    const { best: bestNet, avg: lowNet } = bestNAverage(netScores, league.rounds_that_count);
    const { best: bestGross } = bestNAverage(grossScores, league.rounds_that_count);
    return {
      rank: 0,
      entryId: e.id,
      userId: e.user_id,
      displayName: displayNames[e.user_id] ?? 'Golfer',
      teamId: e.league_team_id,
      teamName: e.league_team_id ? teamMap.get(e.league_team_id)?.name ?? null : null,
      memberNames: [],
      roundsPlayed: netScores.length,
      bestNet,
      lowNet,
      bestGross,
      points: 0,
      isTeam: false,
    };
  });
  rows.sort((a, b) => {
    const av = a.lowNet ?? 999;
    const bv = b.lowNet ?? 999;
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

/** e.g. May 18 – Jun 15, 2026 */
export function formatLeagueDateRange(startYmd: string, endYmd: string): string {
  const start = new Date(`${startYmd}T12:00:00`);
  const end = new Date(`${endYmd}T12:00:00`);
  const monthDay: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startPart = start.toLocaleDateString('en-US', monthDay);
  const endPart = end.toLocaleDateString('en-US', monthDay);
  const year = end.getFullYear();
  if (start.getFullYear() === year) {
    return `${startPart} – ${endPart}, ${year}`;
  }
  return `${start.toLocaleDateString('en-US', { ...monthDay, year: 'numeric' })} – ${end.toLocaleDateString('en-US', { ...monthDay, year: 'numeric' })}`;
}
