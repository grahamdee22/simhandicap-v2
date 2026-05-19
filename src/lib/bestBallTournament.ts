/**
 * Best Ball tournament helpers (PRD §4, §6.3).
 */

import type { DbTournamentTeamHoleScoreRow } from './tournamentTypes';

export type BestBallTeamRoundAggregate = {
  roundDate: string;
  grossTotal: number;
  netTotal: number;
  isPartial: boolean;
  holesRecorded: number;
};

export function validateBestBallTeamSizes(
  teams: { name: string; memberIds: string[] }[]
): string | null {
  for (const t of teams) {
    if (t.memberIds.length < 2) {
      return `${t.name} needs at least 2 players for Best Ball.`;
    }
  }
  return null;
}

/** Group team hole rows by round_date and compute 18-hole totals. */
export function aggregateBestBallTeamRounds(
  rows: DbTournamentTeamHoleScoreRow[],
  leagueTeamId: string,
  useNet: boolean
): BestBallTeamRoundAggregate[] {
  const byDate = new Map<string, DbTournamentTeamHoleScoreRow[]>();
  for (const row of rows) {
    if (row.league_team_id !== leagueTeamId) continue;
    const list = byDate.get(row.round_date) ?? [];
    list.push(row);
    byDate.set(row.round_date, list);
  }

  const out: BestBallTeamRoundAggregate[] = [];
  for (const [roundDate, holes] of byDate) {
    const sorted = [...holes].sort((a, b) => a.hole_number - b.hole_number);
    const isPartial = sorted.some((h) => h.is_partial) || sorted.length < 18;
    const grossTotal = sorted.reduce((s, h) => s + h.team_score, 0);
    const netTotal = sorted.reduce(
      (s, h) => s + Number(h.team_net_score ?? h.team_score),
      0
    );
    out.push({
      roundDate,
      grossTotal,
      netTotal,
      isPartial,
      holesRecorded: sorted.length,
    });
  }
  out.sort((a, b) => b.roundDate.localeCompare(a.roundDate));
  return out;
}

/** Scores that count toward best-ball standings (complete team cards only). */
export function bestBallStandingsScores(
  aggregates: BestBallTeamRoundAggregate[],
  useHandicap: boolean
): { scores: number[]; hasPartialPending: boolean } {
  const scores: number[] = [];
  let hasPartialPending = false;
  for (const a of aggregates) {
    if (a.isPartial) {
      if (a.holesRecorded > 0) hasPartialPending = true;
      continue;
    }
    if (a.holesRecorded < 18) continue;
    scores.push(useHandicap ? a.netTotal : a.grossTotal);
  }
  return { scores, hasPartialPending };
}

export function formatBestBallPartialNote(
  submitted: number,
  expected: number
): string {
  const waiting = Math.max(0, expected - submitted);
  if (waiting <= 0) return 'Team scorecard complete for this round.';
  return `Partial team score — waiting on ${waiting} teammate${waiting === 1 ? '' : 's'}.`;
}
