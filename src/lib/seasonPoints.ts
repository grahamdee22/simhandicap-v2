/**
 * Season points: place-based results from finished tournaments, then best-N.
 *
 * Bracket placement uses finished `league_match_pairings` only. Round 1 pairs
 * every player (even fields only). A later bye is the absence of a pairing for
 * that player that round (`leagues.bracket_byes`), not a loss, so it does not
 * assign a place. The champion is the final's winner; the runner-up is the
 * final's loser; everyone else shares the place of the round they lost.
 * An unfinished final contributes no results.
 *
 * Stroke / scramble / best ball places come from `computeLeagueStandings` rank.
 * A roster player with no qualifying round is still ranked there (low net sorts
 * last). Season points omit those rows — a missed event is absent, not 0.
 */

import type { LeagueStandingRow } from './computeLeagueStandings';
import { bracketRoundSortKey } from './matchPlayBracketLogic';
import type { DbLeagueMatchPairingRow } from './matchPlayPairingTypes';

const PLACE_POINTS = [10, 8, 6, 5, 4, 3, 2, 1] as const;

export function pointsForPlace(place: number): number {
  if (!Number.isInteger(place) || place < 1 || place > PLACE_POINTS.length) return 0;
  return PLACE_POINTS[place - 1]!;
}

function decidedWinner(pairing: DbLeagueMatchPairingRow | undefined): string | null {
  if (!pairing) return null;
  if (pairing.status !== 'complete' && pairing.status !== 'halved') return null;
  return pairing.winner_entry_id;
}

function loserEntryId(pairing: DbLeagueMatchPairingRow | undefined): string | null {
  const winner = decidedWinner(pairing);
  if (!pairing || !winner) return null;
  if (winner === pairing.player_1_entry_id) return pairing.player_2_entry_id;
  if (winner === pairing.player_2_entry_id) return pairing.player_1_entry_id;
  return null;
}

/**
 * Entry id → place for a finished bracket. Null when the final has no winner.
 * Ties share one place (both semifinal losers are 3rd and both get 3rd-place points).
 */
export function placesFromFinishedBracket(
  pairings: DbLeagueMatchPairingRow[]
): Map<string, number> | null {
  const finalPairing = pairings.find((p) => p.bracket_round === 'final');
  const champion = decidedWinner(finalPairing);
  if (!champion) return null;

  const places = new Map<string, number>();
  places.set(champion, 1);
  const runnerUp = loserEntryId(finalPairing);
  if (runnerUp) places.set(runnerUp, 2);

  const firstLossRound = new Map<string, number>();
  for (const pairing of pairings) {
    if (pairing.bracket_round === 'final') continue;
    const loser = loserEntryId(pairing);
    if (!loser || loser === champion) continue;
    const key = bracketRoundSortKey(pairing.bracket_round ?? '');
    const prev = firstLossRound.get(loser);
    if (prev == null || key < prev) firstLossRound.set(loser, key);
  }

  const byRound = new Map<number, string[]>();
  for (const [entryId, key] of firstLossRound) {
    if (places.has(entryId)) continue;
    const list = byRound.get(key) ?? [];
    list.push(entryId);
    byRound.set(key, list);
  }

  let place = 3;
  const rounds = [...byRound.keys()].sort((a, b) => b - a);
  for (const key of rounds) {
    const ids = byRound.get(key) ?? [];
    for (const id of ids) places.set(id, place);
    place += ids.length;
  }
  return places;
}

export type SeasonEventResult = {
  userId: string;
  points: number;
};

export function playerPointsFromTournament(params: {
  format: string;
  pairingMethod?: string | null;
  standings: LeagueStandingRow[];
  entries: { id?: string; user_id: string; league_team_id: string | null }[];
  pairings?: DbLeagueMatchPairingRow[];
}): SeasonEventResult[] {
  if (params.format === 'match_play' && params.pairingMethod === 'bracket') {
    const places = placesFromFinishedBracket(params.pairings ?? []);
    if (!places) return [];
    const out: SeasonEventResult[] = [];
    for (const entry of params.entries) {
      if (!entry.id) continue;
      const place = places.get(entry.id);
      if (place == null) continue;
      out.push({ userId: entry.user_id, points: pointsForPlace(place) });
    }
    return out;
  }

  if (params.format === 'scramble' || params.format === 'best_ball') {
    const out: SeasonEventResult[] = [];
    for (const row of params.standings) {
      if (row.roundsPlayed <= 0 || !row.teamId) continue;
      const points = pointsForPlace(row.rank);
      for (const entry of params.entries) {
        if (entry.league_team_id === row.teamId) {
          out.push({ userId: entry.user_id, points });
        }
      }
    }
    return out;
  }

  return params.standings
    .filter((row) => row.roundsPlayed > 0 && row.userId)
    .map((row) => ({ userId: row.userId as string, points: pointsForPlace(row.rank) }));
}

export function bestNEventPoints(
  points: number[],
  eventsThatCount: number | null
): { total: number; counted: number; played: number } {
  const played = points.length;
  if (played === 0) return { total: 0, counted: 0, played: 0 };
  const sorted = [...points].sort((a, b) => b - a);
  const k =
    eventsThatCount == null || eventsThatCount < 1
      ? sorted.length
      : Math.min(eventsThatCount, sorted.length);
  const slice = sorted.slice(0, k);
  return {
    total: slice.reduce((sum, n) => sum + n, 0),
    counted: slice.length,
    played,
  };
}

export type SeasonStandingRow = {
  userId: string;
  rank: number;
  totalPoints: number;
  eventsCounted: number;
  eventsPlayed: number;
};

export function computeSeasonStandings(
  results: SeasonEventResult[],
  eventsThatCount: number | null,
  displayNames: Record<string, string> = {}
): SeasonStandingRow[] {
  const byUser = new Map<string, number[]>();
  for (const result of results) {
    const list = byUser.get(result.userId) ?? [];
    list.push(result.points);
    byUser.set(result.userId, list);
  }

  const rows: SeasonStandingRow[] = [];
  for (const [userId, pts] of byUser) {
    const agg = bestNEventPoints(pts, eventsThatCount);
    rows.push({
      userId,
      rank: 0,
      totalPoints: agg.total,
      eventsCounted: agg.counted,
      eventsPlayed: agg.played,
    });
  }

  rows.sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    const nameA = displayNames[a.userId] ?? '';
    const nameB = displayNames[b.userId] ?? '';
    return nameA.localeCompare(nameB) || a.userId.localeCompare(b.userId);
  });
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

export function formatSeasonDateRange(startYmd: string, endYmd: string | null): string {
  const start = new Date(`${startYmd}T12:00:00`);
  const monthDay: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (!endYmd) {
    return `From ${start.toLocaleDateString('en-US', { ...monthDay, year: 'numeric' })}`;
  }
  const end = new Date(`${endYmd}T12:00:00`);
  const startPart = start.toLocaleDateString('en-US', monthDay);
  const endPart = end.toLocaleDateString('en-US', monthDay);
  const year = end.getFullYear();
  if (start.getFullYear() === year) return `${startPart} – ${endPart}, ${year}`;
  return `${start.toLocaleDateString('en-US', { ...monthDay, year: 'numeric' })} – ${end.toLocaleDateString('en-US', { ...monthDay, year: 'numeric' })}`;
}
