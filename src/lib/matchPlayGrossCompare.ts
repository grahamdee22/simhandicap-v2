import {
  DEFAULT_STROKE_INDEX_BY_HOLE,
  holesForStrokes,
  strokeGiftBetweenPlayers,
  whsCourseHandicapFromIndex,
} from './netHandicap';
import type { TournamentHoleInput } from './tournamentHoleScores';
import type { MatchPlayHoleResult } from './tournamentTypes';

export type MatchPlayRoundSummary = {
  wins: number;
  losses: number;
  halved: number;
  net_holes: number;
};

/** Snapshot fields from the logged round. Null index or par means this pairing stays scratch. */
export type MatchPlayHandicapSnap = {
  index: number | null;
  courseRating: number | null;
  slope: number | null;
  coursePar: number | null;
  strokeIndexByHole?: number[] | null;
};

/**
 * Live preview inputs. The saved W/L/H still comes from `recalculate_match_play_pairing`.
 * When this is omitted or incomplete, comparison stays gross.
 */
export type MatchPlayCompareHandicap = {
  enabled: boolean;
  nine: 'front' | 'back' | null;
  me: MatchPlayHandicapSnap;
  opponent: MatchPlayHandicapSnap;
};

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(Number(n));
}

function strokeIndexForSnaps(me: MatchPlayHandicapSnap, opponent: MatchPlayHandicapSnap): number[] {
  if (me.strokeIndexByHole?.length === 18) return me.strokeIndexByHole;
  if (opponent.strokeIndexByHole?.length === 18) return opponent.strokeIndexByHole;
  return DEFAULT_STROKE_INDEX_BY_HOLE;
}

/** Scorecard hole 1 is course hole 1, or course hole 10 on the back nine. */
export function courseHoleForScorecard(
  scorecardHole: number,
  holeCount: number,
  nine: 'front' | 'back' | null
): number {
  if (holeCount === 9 && nine === 'back') return scorecardHole + 9;
  return scorecardHole;
}

export function matchPlayStrokeAllocation(handicap: MatchPlayCompareHandicap | null | undefined): {
  myStrokesByCourseHole: number[];
  oppStrokesByCourseHole: number[];
  note: string | null;
} {
  const empty = {
    myStrokesByCourseHole: [] as number[],
    oppStrokesByCourseHole: [] as number[],
    note: null as string | null,
  };
  if (!handicap?.enabled) return empty;
  const { me, opponent } = handicap;
  if (
    !finite(me.index) ||
    !finite(opponent.index) ||
    !finite(me.courseRating) ||
    !finite(opponent.courseRating) ||
    !finite(me.slope) ||
    !finite(opponent.slope) ||
    !finite(me.coursePar) ||
    !finite(opponent.coursePar)
  ) {
    return empty;
  }

  const myCourse = whsCourseHandicapFromIndex(me.index, me.courseRating, me.slope, me.coursePar);
  const oppCourse = whsCourseHandicapFromIndex(
    opponent.index,
    opponent.courseRating,
    opponent.slope,
    opponent.coursePar
  );
  const gift = strokeGiftBetweenPlayers('you', myCourse, 'opponent', oppCourse);
  const strokeCount = gift?.strokes ?? 0;
  if (strokeCount <= 0 || !gift) return empty;

  const index = strokeIndexForSnaps(me, opponent);
  const holes = holesForStrokes(strokeCount, index);
  const mine = gift.receiverIsPlayer1;
  const myStrokesByCourseHole = Array.from({ length: 19 }, () => 0);
  const oppStrokesByCourseHole = Array.from({ length: 19 }, () => 0);
  for (const hole of holes) {
    if (hole < 1 || hole > 18) continue;
    if (mine) myStrokesByCourseHole[hole] = (myStrokesByCourseHole[hole] ?? 0) + 1;
    else oppStrokesByCourseHole[hole] = (oppStrokesByCourseHole[hole] ?? 0) + 1;
  }
  return { myStrokesByCourseHole, oppStrokesByCourseHole, note: mine ? 'you' : 'opponent' };
}

/** Compare hole scores from player one's perspective. Net when a complete handicap snapshot exists. */
export function compareMatchPlayGrossHoles(
  myHoles: TournamentHoleInput[],
  opponentHoles: TournamentHoleInput[],
  holeCount: number = 18,
  handicap?: MatchPlayCompareHandicap | null
): {
  results: (MatchPlayHoleResult | null)[];
  summary: MatchPlayRoundSummary;
  strokesNote: string | null;
} {
  let wins = 0;
  let losses = 0;
  let halved = 0;
  const results: (MatchPlayHoleResult | null)[] = [];
  const allocation = matchPlayStrokeAllocation(handicap);
  const strokeHoles: number[] = [];
  let strokesOnCard = 0;

  for (let i = 0; i < holeCount; i += 1) {
    const g1 = myHoles[i]?.gross_score;
    const g2 = opponentHoles[i]?.gross_score;
    const courseHole = courseHoleForScorecard(i + 1, holeCount, handicap?.nine ?? null);
    const myDots = allocation.myStrokesByCourseHole[courseHole] ?? 0;
    const oppDots = allocation.oppStrokesByCourseHole[courseHole] ?? 0;
    const dots = myDots + oppDots;
    if (dots > 0 && !strokeHoles.includes(courseHole)) {
      strokeHoles.push(courseHole);
      strokesOnCard += dots;
    }
    if (g1 == null || g2 == null || !Number.isFinite(g1) || !Number.isFinite(g2)) {
      results.push(null);
      continue;
    }
    const n1 = g1 - myDots;
    const n2 = g2 - oppDots;
    if (n1 < n2) {
      results.push('W');
      wins += 1;
    } else if (n2 < n1) {
      results.push('L');
      losses += 1;
    } else {
      results.push('H');
      halved += 1;
    }
  }

  const who = allocation.note === 'you' ? 'You get' : 'Opponent gets';
  const strokesNote =
    strokesOnCard > 0
      ? `${who} ${strokesOnCard} stroke${strokesOnCard === 1 ? '' : 's'} on holes ${strokeHoles.sort((a, b) => a - b).join(', ')}`
      : null;

  return {
    results,
    summary: { wins, losses, halved, net_holes: wins - losses },
    strokesNote,
  };
}

export function countComparedMatchPlayHoles(
  myHoles: TournamentHoleInput[],
  opponentHoles: TournamentHoleInput[],
  holeCount: number = 18
): number {
  let n = 0;
  for (let i = 0; i < holeCount; i += 1) {
    const g1 = myHoles[i]?.gross_score;
    const g2 = opponentHoles[i]?.gross_score;
    if (g1 != null && g2 != null && Number.isFinite(g1) && Number.isFinite(g2)) n += 1;
  }
  return n;
}

export function formatMatchPlayStatus(
  summary: MatchPlayRoundSummary,
  throughHole: number,
  holeCount: number = 18
): string {
  const { net_holes: net } = summary;
  const through = Math.min(holeCount, Math.max(0, throughHole));
  if (net === 0) {
    return through > 0 ? `ALL SQUARE through ${through}` : 'ALL SQUARE';
  }
  if (net > 0) return `${net} UP through ${through}`;
  return `${Math.abs(net)} DOWN through ${through}`;
}
