/**
 * 9-hole course rating / slope resolution for SimCap differentials.
 *
 * Catalog tees only store 18-hole CR/slope today. Until real Front/Back 9
 * numbers exist per tee, we derive: rating = 18-hole CR ÷ 2 (1 decimal),
 * slope unchanged. Callers must go through this resolver — never inline
 * `rating / 2`. Real per-nine fields on a tee flip `nineHoleSource` to
 * `'real'` with no differential-math changes elsewhere.
 *
 * This is SimCap's approximation, not WHS-official 9-hole scoring.
 */

import { round1 } from './handicap';

/** How many holes the logged round covers (matches Social Match Play labels). */
export type HolesPlayed = '18' | 'front' | 'back';

export type NineHoleSource = 'derived' | 'real';

/** Tee shape accepted by the resolver (curated, community, or custom). */
export type NineHoleTeeInput = {
  rating: number;
  slope: number;
  /** Optional real Front 9 values when sourced later. */
  front9Rating?: number | null;
  front9Slope?: number | null;
  back9Rating?: number | null;
  back9Slope?: number | null;
};

export type NineHoleRatingSlope = {
  rating: number;
  slope: number;
  nineHoleSource: NineHoleSource;
};

export const GROSS_SCORE_MIN_18 = 55;
export const GROSS_SCORE_MAX_18 = 120;
/** Roughly half the 18-hole band, with a little headroom for high scores. */
export const GROSS_SCORE_MIN_9 = 27;
export const GROSS_SCORE_MAX_9 = 65;

export function isNineHolePlayed(holes: HolesPlayed | null | undefined): boolean {
  return holes === 'front' || holes === 'back';
}

/**
 * Decision 2: Front/Back 9 unlocked once Home would show a non-null SimCap index
 * (`currentIndexFromRounds` ≠ null). Editing an already-saved 9-hole round stays allowed.
 */
export function nineHoleLoggingUnlocked(
  simIndex: number | null,
  editingExistingNineHole = false
): boolean {
  return simIndex != null || editingExistingNineHole;
}

/**
 * Decision 3: 9-hole rounds must not be associated with any tournament format
 * (Stroke / Scramble / Best Ball all insert `league_rounds`).
 */
export function shouldBlockTournamentApplyForHoles(
  holesPlayed: HolesPlayed | null | undefined
): boolean {
  return isNineHolePlayed(holesPlayed);
}

export function holesPlayedLabel(holes: HolesPlayed | null | undefined): string | null {
  if (holes === 'front') return 'Front 9';
  if (holes === 'back') return 'Back 9';
  return null;
}

export function grossScoreBounds(holes: HolesPlayed | null | undefined): {
  min: number;
  max: number;
} {
  if (isNineHolePlayed(holes)) {
    return { min: GROSS_SCORE_MIN_9, max: GROSS_SCORE_MAX_9 };
  }
  return { min: GROSS_SCORE_MIN_18, max: GROSS_SCORE_MAX_18 };
}

export function clampGrossScore(gross: number, holes: HolesPlayed | null | undefined): number {
  const { min, max } = grossScoreBounds(holes);
  return Math.min(max, Math.max(min, Math.round(gross)));
}

/**
 * Resolve rating/slope for a Front 9 or Back 9 score.
 * Prefer real per-nine fields when both rating and slope are present; else derive.
 */
export function getNineHoleRatingSlope(
  tee: NineHoleTeeInput,
  half: 'front' | 'back'
): NineHoleRatingSlope {
  if (half === 'front') {
    const r = tee.front9Rating;
    const s = tee.front9Slope;
    if (
      typeof r === 'number' &&
      Number.isFinite(r) &&
      r > 0 &&
      typeof s === 'number' &&
      Number.isFinite(s) &&
      s > 0
    ) {
      return { rating: round1(r), slope: Math.round(s), nineHoleSource: 'real' };
    }
  } else {
    const r = tee.back9Rating;
    const s = tee.back9Slope;
    if (
      typeof r === 'number' &&
      Number.isFinite(r) &&
      r > 0 &&
      typeof s === 'number' &&
      Number.isFinite(s) &&
      s > 0
    ) {
      return { rating: round1(r), slope: Math.round(s), nineHoleSource: 'real' };
    }
  }

  return {
    rating: round1(tee.rating / 2),
    slope: Math.round(tee.slope),
    nineHoleSource: 'derived',
  };
}

/** Rating/slope to use for differential math for any holes selection. */
export function ratingSlopeForHolesPlayed(
  tee: NineHoleTeeInput,
  holes: HolesPlayed
): { rating: number; slope: number; nineHoleSource: NineHoleSource | null } {
  if (holes === '18') {
    return {
      rating: round1(tee.rating),
      slope: Math.round(tee.slope),
      nineHoleSource: null,
    };
  }
  const nine = getNineHoleRatingSlope(tee, holes);
  return { rating: nine.rating, slope: nine.slope, nineHoleSource: nine.nineHoleSource };
}
