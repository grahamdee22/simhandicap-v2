/**
 * Stroke-play net scoring for Match Play: hole list, stroke allocation, per-hole net from gross.
 */

import type { DbMatchHoleRow, DbMatchRow } from './matchPlay';
import type { CourseSeed } from './courses';
import { COURSE_SEEDS } from './courses';
import {
  holesForStrokes,
  strokeGiftBetweenPlayers,
  strokeIndexForCourse,
  whsCourseHandicapFromIndex,
} from './netHandicap';

export function courseSeedForMatchName(courseName: string): CourseSeed | undefined {
  return COURSE_SEEDS.find((c) => c.name === courseName);
}

export function resolvedCourseForMatch(match: DbMatchRow): CourseSeed {
  return courseSeedForMatchName(match.course_name) ?? COURSE_SEEDS[0];
}

/** Real hole numbers (1–18) played in this match, in order. */
export function matchHoleNumbers(match: DbMatchRow): number[] {
  if (match.holes === 18) return Array.from({ length: 18 }, (_, i) => i + 1);
  if (match.nine_selection === 'front') return Array.from({ length: 9 }, (_, i) => i + 1);
  return Array.from({ length: 9 }, (_, i) => i + 10);
}

export function matchCourseParPlayed(course: CourseSeed, holeNumbers: number[]): number {
  return holeNumbers.reduce((s, h) => s + (course.pars[h - 1] ?? 4), 0);
}

/** Strokes the receiver gets on this hole (0, 1, 2, …). */
export function receivedStrokesOnHole(
  holeNumber: number,
  strokeGiftTotal: number,
  receiverIsPlayer1: boolean,
  viewingAsPlayer1: boolean,
  strokeIndexByHole: number[]
): number {
  if (strokeGiftTotal <= 0) return 0;
  const iReceive =
    (viewingAsPlayer1 && receiverIsPlayer1) || (!viewingAsPlayer1 && !receiverIsPlayer1);
  if (!iReceive) return 0;
  const holes = holesForStrokes(strokeGiftTotal, strokeIndexByHole);
  return holes.filter((h) => h === holeNumber).length;
}

export type MatchStrokeContext = {
  strokeGiftTotal: number;
  receiverIsPlayer1: boolean;
  strokeIndexByHole: number[];
};

export function buildMatchStrokeContext(
  match: DbMatchRow,
  course: CourseSeed,
  handicapIndexP1: number,
  handicapIndexP2: number,
  displayNameP1: string,
  displayNameP2: string
): MatchStrokeContext {
  const holeNums = matchHoleNumbers(match);
  const parPlayed = matchCourseParPlayed(course, holeNums);

  const ph1 = whsCourseHandicapFromIndex(
    handicapIndexP1,
    match.player_1_course_rating,
    match.player_1_course_slope,
    parPlayed
  );
  const ph2 = whsCourseHandicapFromIndex(
    handicapIndexP2,
    match.player_2_course_rating ?? match.player_1_course_rating,
    match.player_2_course_slope ?? match.player_1_course_slope,
    parPlayed
  );

  const gift = strokeGiftBetweenPlayers(displayNameP1.trim(), ph1, displayNameP2.trim(), ph2);
  const strokeGiftTotal = gift?.strokes ?? 0;
  const receiverIsPlayer1 = gift?.receiverIsPlayer1 ?? false;
  const strokeIndexByHole = strokeIndexForCourse(course);

  return { strokeGiftTotal, receiverIsPlayer1, strokeIndexByHole };
}

export function holeNetScore(
  gross: number,
  holeNumber: number,
  ctx: MatchStrokeContext,
  viewingAsPlayer1: boolean
): number {
  const rec = receivedStrokesOnHole(
    holeNumber,
    ctx.strokeGiftTotal,
    ctx.receiverIsPlayer1,
    viewingAsPlayer1,
    ctx.strokeIndexByHole
  );
  return gross - rec;
}

export function grossMapsForPlayers(
  rows: DbMatchHoleRow[],
  player1Id: string,
  player2Id: string
): { p1: Map<number, number>; p2: Map<number, number> } {
  const p1 = new Map<number, number>();
  const p2 = new Map<number, number>();
  for (const r of rows) {
    if (r.player_id === player1Id) p1.set(r.hole_number, r.gross_score);
    else if (r.player_id === player2Id) p2.set(r.hole_number, r.gross_score);
  }
  return { p1, p2 };
}

/** Null if either player is missing any hole gross for this match. */
export function computeTotalsIfComplete(
  match: DbMatchRow,
  course: CourseSeed,
  rows: DbMatchHoleRow[],
  ctx: MatchStrokeContext,
  player2Id: string
): { totalNet1: number; totalNet2: number } | null {
  const holeNums = matchHoleNumbers(match);
  const { p1, p2 } = grossMapsForPlayers(rows, match.player_1_id, player2Id);
  for (const h of holeNums) {
    if (!p1.has(h) || !p2.has(h)) return null;
  }
  let totalNet1 = 0;
  let totalNet2 = 0;
  for (const h of holeNums) {
    totalNet1 += holeNetScore(p1.get(h)!, h, ctx, true);
    totalNet2 += holeNetScore(p2.get(h)!, h, ctx, false);
  }
  return { totalNet1, totalNet2 };
}

export function opponentAhead(holeCountMine: number, holeCountOpponent: number): boolean {
  return holeCountOpponent > holeCountMine;
}
