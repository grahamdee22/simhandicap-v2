/**
 * Pure league standings ranking / averaging (no store or React Native deps).
 * Shared by the app and Node verification harness.
 */

import {
  aggregateBestBallTeamRounds,
  bestBallStandingsScores,
} from './bestBallTournament';
import type { DbTournamentTeamHoleScoreRow } from './tournamentTypes';

export type LeagueFormat = 'stroke' | 'match_play' | 'scramble' | 'best_ball';

/** Minimal league shape needed for standings math. */
export type StandingsLeague = {
  format: LeagueFormat | string;
  use_handicap: boolean;
  rounds_that_count: number;
};

export type StandingsEntry = {
  id: string;
  user_id: string;
  league_team_id: string | null;
  points: number;
  mp_wins?: number;
  mp_losses?: number;
  mp_halved?: number;
};

export type StandingsRound = {
  user_id: string;
  league_team_id: string | null;
  gross_score: number;
  net_score: number;
  player_opted_in: boolean;
  hole_entry_status: string | null;
};

export type StandingsTeam = {
  id: string;
  name: string;
  designated_scorer_id?: string | null;
};

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

/** Rounds that count in standings (opted in + hole scorecard complete). */
export function leagueRoundsForStandings(rounds: StandingsRound[]): StandingsRound[] {
  return rounds.filter(
    (r) =>
      r.player_opted_in === true &&
      (r.hole_entry_status === 'complete' || r.hole_entry_status == null)
  );
}

function designatedScorerLabel(
  team: Pick<StandingsTeam, 'designated_scorer_id'> | null | undefined,
  displayNames: Record<string, string>
): string | null {
  if (!team?.designated_scorer_id) return null;
  return displayNames[team.designated_scorer_id] ?? 'Designated scorer';
}

function bestNAverage(
  scores: number[],
  roundsThatCount: number
): { best: number | null; avg: number | null } {
  if (scores.length === 0) return { best: null, avg: null };
  const sorted = [...scores].sort((a, b) => a - b);
  const k = Math.min(roundsThatCount, sorted.length);
  const bestSlice = sorted.slice(0, k);
  const sum = bestSlice.reduce((s, x) => s + x, 0);
  const avg = sum / bestSlice.length;
  return { best: sorted[0] ?? null, avg: Math.round(avg * 10) / 10 };
}

export function computeLeagueStandings(params: {
  league: StandingsLeague;
  entries: StandingsEntry[];
  rounds: StandingsRound[];
  teams: StandingsTeam[];
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

  const teamMap = new Map(teams.map((t) => [t.id, t]));
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
