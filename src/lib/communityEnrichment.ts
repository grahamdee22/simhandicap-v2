import type { CourseTee } from './courses';

/** GSPro difficulty sample distribution (PakGolf Master List). */
export const GSPRO_DIFF_P5 = 24;
export const GSPRO_DIFF_P95 = 62;
/** Values above this are treated as outliers → Tier 4. */
export const GSPRO_DIFF_MAX_USABLE = 80;

export const TIER4_SLOPE = 113;
export const TIER4_RATING = 72;
export const TIER3_RATING = 72;

export function isUsableGsproDifficulty(value: number | null | undefined): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  return value > 0 && value <= GSPRO_DIFF_MAX_USABLE;
}

export function mapGsproDifficultyToSlope(difficulty: number): number {
  const t = (difficulty - GSPRO_DIFF_P5) / (GSPRO_DIFF_P95 - GSPRO_DIFF_P5);
  const slope = 55 + t * (155 - 55);
  return Math.round(Math.min(155, Math.max(55, slope)));
}

export type SyntheticTee = { name: string; rating: number; slope: number; yards?: number | null };

export function tier3SyntheticTee(difficulty: number): SyntheticTee {
  return {
    name: 'Estimated',
    rating: TIER3_RATING,
    slope: mapGsproDifficultyToSlope(difficulty),
    yards: null,
  };
}

export function tier4SyntheticTee(): SyntheticTee {
  return {
    name: 'Default',
    rating: TIER4_RATING,
    slope: TIER4_SLOPE,
    yards: null,
  };
}

/** Pick the tee row whose yardage is closest to what the player played. */
export function nearestTeeByYards(tees: CourseTee[], yardsPlayed: number): CourseTee | null {
  if (tees.length === 0) return null;
  const withYards = tees.filter((t) => t.yards != null && Number.isFinite(t.yards));
  if (withYards.length === 0) return tees[0];
  let best = withYards[0];
  let bestDist = Math.abs(yardsPlayed - (best.yards as number));
  for (let i = 1; i < withYards.length; i++) {
    const t = withYards[i];
    const d = Math.abs(yardsPlayed - (t.yards as number));
    if (d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}
