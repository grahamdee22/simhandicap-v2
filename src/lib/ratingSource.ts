/** Where a tee's Course Rating / Slope came from. */
export type RatingSource = 'curated' | 'community' | 'user_reported' | 'default_unrated';

export const RATING_SOURCES: readonly RatingSource[] = [
  'curated',
  'community',
  'user_reported',
  'default_unrated',
] as const;

export function isRatingSource(v: unknown): v is RatingSource {
  return typeof v === 'string' && (RATING_SOURCES as readonly string[]).includes(v);
}

/** Informational badge only — WHS still uses the tee CR/Slope for differentials. */
export function isUnratedTee(source: RatingSource | null | undefined): boolean {
  return source === 'user_reported' || source === 'default_unrated';
}

export const DEFAULT_UNRATED_SLOPE = 113;

/** Validate optional official CR/Slope; returns error message or null. */
export function validateOfficialRatingSlope(
  ratingRaw: string,
  slopeRaw: string,
  par: number
): { rating: number; slope: number } | { error: string } | null {
  const rTrim = ratingRaw.replace(/,/g, '.').trim();
  const sTrim = slopeRaw.replace(/,/g, '.').trim();
  if (!rTrim && !sTrim) return null;
  if (!rTrim || !sTrim) {
    return { error: 'Enter both Course Rating and Slope, or leave both blank.' };
  }
  const rating = Math.round(parseFloat(rTrim) * 10) / 10;
  const slope = Math.round(parseFloat(sTrim));
  if (!Number.isFinite(rating) || !Number.isFinite(slope)) {
    return { error: 'Course Rating and Slope must be numbers.' };
  }
  if (slope < 55 || slope > 155) {
    return { error: 'Slope must be between 55 and 155.' };
  }
  if (rating < 55 || rating > 85) {
    return { error: 'Course Rating must be between 55 and 85 for an 18-hole tee.' };
  }
  if (Number.isFinite(par) && par >= 27 && par <= 90) {
    if (rating < par - 10 || rating > par + 10) {
      return {
        error: `Course Rating looks off for par ${par} (expected roughly ${par - 10}–${par + 10}).`,
      };
    }
  }
  return { rating, slope };
}

export function resolveTeeRatingFromInput(opts: {
  par: number;
  ratingRaw?: string;
  slopeRaw?: string;
}):
  | { rating: number; slope: number; ratingSource: RatingSource; error?: undefined }
  | { error: string; rating?: undefined; slope?: undefined; ratingSource?: undefined } {
  const official = validateOfficialRatingSlope(
    opts.ratingRaw ?? '',
    opts.slopeRaw ?? '',
    opts.par
  );
  if (official && 'error' in official) return { error: official.error };
  if (official && 'rating' in official) {
    return {
      rating: official.rating,
      slope: official.slope,
      ratingSource: 'user_reported',
    };
  }
  return {
    rating: opts.par,
    slope: DEFAULT_UNRATED_SLOPE,
    ratingSource: 'default_unrated',
  };
}
