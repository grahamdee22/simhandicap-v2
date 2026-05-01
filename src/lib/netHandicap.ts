import { difficultyProduct, type Mulligans, type PinDay, type PuttingMode, type Wind } from './handicap';
import type { CourseSeed } from './courses';

/** Default stroke index (1 = hardest) per hole when course has no `strokeIndex`. */
export const DEFAULT_STROKE_INDEX_BY_HOLE: number[] = [
  9, 11, 7, 15, 3, 13, 1, 17, 5, 10, 12, 8, 16, 4, 14, 2, 18, 6,
];

export function courseParFromSeed(course: CourseSeed): number {
  return course.pars.reduce((s, p) => s + p, 0);
}

export function strokeIndexForCourse(course: CourseSeed): number[] {
  if (course.strokeIndex && course.strokeIndex.length === 18) {
    return [...course.strokeIndex];
  }
  return [...DEFAULT_STROKE_INDEX_BY_HOLE];
}

/**
 * Plain WHS-style course handicap (no sim difficulty modifier).
 * Match Play uses this for stroke allocation — each player's SimCap index already reflects
 * their sim conditions from logged rounds; `difficultyProduct` applies only when logging rounds / differentials.
 */
export function whsCourseHandicapFromIndex(
  handicapIndex: number,
  courseRating: number,
  slope: number,
  coursePar: number
): number {
  const base = handicapIndex * (slope / 113) + (courseRating - coursePar);
  return Math.round(base);
}

/**
 * Playing handicap for this sim round: WHS-style course handicap from index,
 * scaled by the same difficulty product used for differentials.
 */
export function simPlayingHandicap(
  handicapIndex: number,
  courseRating: number,
  slope: number,
  coursePar: number,
  putting: PuttingMode,
  pin: PinDay,
  wind: Wind,
  mulligans: Mulligans
): number {
  const modifier = difficultyProduct(putting, pin, wind, mulligans);
  const base = handicapIndex * (slope / 113) + (courseRating - coursePar);
  return Math.round(base * modifier);
}

export type StrokeGift = {
  strokes: number;
  giverName: string;
  receiverName: string;
  receiverIsPlayer1: boolean;
};

export function strokeGiftBetweenPlayers(
  name1: string,
  ph1: number,
  name2: string,
  ph2: number
): StrokeGift | null {
  if (ph1 === ph2) {
    return { strokes: 0, giverName: name1, receiverName: name2, receiverIsPlayer1: false };
  }
  if (ph1 < ph2) {
    return {
      strokes: ph2 - ph1,
      giverName: name1.trim(),
      receiverName: name2.trim(),
      receiverIsPlayer1: false,
    };
  }
  return {
    strokes: ph1 - ph2,
    giverName: name2.trim(),
    receiverName: name1.trim(),
    receiverIsPlayer1: true,
  };
}

/** Hole numbers (1–18) where the receiver gets a stroke, in stroke-index order (hardest first). */
export function holesForStrokes(strokeCount: number, strokeIndexByHole: number[]): number[] {
  if (strokeCount <= 0) return [];
  const pairs = strokeIndexByHole.map((si, i) => ({ hole: i + 1, si }));
  pairs.sort((a, b) => a.si - b.si);
  const out: number[] = [];
  let left = strokeCount;
  let lap = 0;
  while (left > 0 && lap < 3) {
    for (const p of pairs) {
      if (left <= 0) break;
      out.push(p.hole);
      left--;
    }
    lap++;
  }
  return out;
}

/** Dedupe consecutive laps for display: "3, 5, 12 (2nd: 3, 5)" — keep simple sorted unique first pass + count */
export function formatHolesStrokeSummary(strokeCount: number, strokeIndexByHole: number[]): string {
  const holes = holesForStrokes(strokeCount, strokeIndexByHole);
  if (holes.length === 0) return '';
  if (strokeCount <= 18) {
    return `Strokes on holes ${holes.join(', ')} (hardest by stroke index first).`;
  }
  const first = holesForStrokes(Math.min(strokeCount, 18), strokeIndexByHole);
  return `Strokes on holes ${first.join(', ')} (and additional strokes on hardest holes again per match rules).`;
}
