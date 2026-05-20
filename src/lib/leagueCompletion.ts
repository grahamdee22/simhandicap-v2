/**
 * When a tournament has met its "rounds that count" threshold (independent of end date).
 */

import {
  aggregateBestBallTeamRounds,
  bestBallStandingsScores,
} from './bestBallTournament';
import type { BracketRound, DbLeagueMatchPairingRow } from './matchPlayPairingTypes';
import type {
  DbLeagueEntryRow,
  DbLeagueRoundRow,
  DbLeagueRow,
  DbLeagueTeamRow,
  LeagueFormat,
} from './leagues';
import type { DbTournamentTeamHoleScoreRow } from './tournamentTypes';

export type LeagueCompletionInput = {
  league: DbLeagueRow;
  teams: DbLeagueTeamRow[];
  entries: DbLeagueEntryRow[];
  rounds: DbLeagueRoundRow[];
  pairings?: DbLeagueMatchPairingRow[];
  teamHoleScores?: DbTournamentTeamHoleScoreRow[];
};

function standingsRounds(rounds: DbLeagueRoundRow[]): DbLeagueRoundRow[] {
  return rounds.filter(
    (r) =>
      r.player_opted_in === true &&
      (r.hole_entry_status === 'complete' || r.hole_entry_status == null)
  );
}

function teamRoundCounts(
  rounds: DbLeagueRoundRow[],
  teamIds: string[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of teamIds) counts.set(id, 0);
  for (const r of standingsRounds(rounds)) {
    if (!r.league_team_id) continue;
    counts.set(r.league_team_id, (counts.get(r.league_team_id) ?? 0) + 1);
  }
  return counts;
}

function entryRoundCounts(rounds: DbLeagueRoundRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of standingsRounds(rounds)) {
    counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1);
  }
  return counts;
}

function allTeamsMetRoundThreshold(
  teams: DbLeagueTeamRow[],
  rounds: DbLeagueRoundRow[],
  roundsThatCount: number
): boolean {
  if (teams.length === 0) return false;
  const counts = teamRoundCounts(rounds, teams.map((t) => t.id));
  return teams.every((t) => (counts.get(t.id) ?? 0) >= roundsThatCount);
}

function allEntriesMetRoundThreshold(
  entries: DbLeagueEntryRow[],
  rounds: DbLeagueRoundRow[],
  roundsThatCount: number
): boolean {
  if (entries.length === 0) return false;
  const counts = entryRoundCounts(rounds);
  return entries.every((e) => (counts.get(e.user_id) ?? 0) >= roundsThatCount);
}

function allBestBallTeamsMetThreshold(
  league: DbLeagueRow,
  teams: DbLeagueTeamRow[],
  teamHoleScores: DbTournamentTeamHoleScoreRow[],
  roundsThatCount: number
): boolean {
  if (teams.length === 0) return false;
  return teams.every((t) => {
    const aggregates = aggregateBestBallTeamRounds(
      teamHoleScores,
      t.id,
      league.use_handicap
    );
    const { netScores } = bestBallStandingsScores(aggregates, league.use_handicap);
    return netScores.length >= roundsThatCount;
  });
}

function allPairingsResolved(pairings: DbLeagueMatchPairingRow[]): boolean {
  if (pairings.length === 0) return false;
  return pairings.every((p) => p.status === 'complete' || p.status === 'halved');
}

function bracketFinalResolved(pairings: DbLeagueMatchPairingRow[]): boolean {
  const final = pairings.find((p) => p.bracket_round === 'final' as BracketRound);
  if (!final) return false;
  return (
    (final.status === 'complete' || final.status === 'halved') && final.winner_entry_id != null
  );
}

/** True when every player/team/pairing has satisfied the tournament's counting threshold. */
export function isLeagueReadyToAutoComplete(input: LeagueCompletionInput): boolean {
  const { league, teams, entries, rounds } = input;
  const k = Math.max(1, league.rounds_that_count);

  switch (league.format as LeagueFormat) {
    case 'match_play':
      if (league.match_play_pairing_method === 'bracket') {
        return bracketFinalResolved(input.pairings ?? []);
      }
      return allPairingsResolved(input.pairings ?? []);
    case 'scramble':
      return allTeamsMetRoundThreshold(teams, rounds, k);
    case 'best_ball':
      return allBestBallTeamsMetThreshold(
        league,
        teams,
        input.teamHoleScores ?? [],
        k
      );
    case 'stroke':
      return allEntriesMetRoundThreshold(entries, rounds, k);
    default:
      return false;
  }
}
