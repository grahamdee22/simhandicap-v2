import { round1 } from './handicap';

/** Benchmark adjusted differential implied by sim index (inverse of index = avgBestDiffs × 0.96). */
export function expectedDifferentialFromIndex(index: number, modifier: number): number {
  if (modifier <= 0 || !Number.isFinite(index)) return NaN;
  return round1((index / 0.96) / modifier);
}

/**
 * Maximum gross (inclusive) that keeps adjusted differential at or better than the index benchmark
 * for this course/slope/modifier. Lower gross than this improves the differential further.
 */
export function targetGrossToImprove(index: number, rating: number, slope: number, modifier: number): number {
  if (modifier <= 0 || slope <= 0 || !Number.isFinite(index)) return NaN;
  const rawEquiv = (index / 0.96) / modifier;
  const ags = rating + (rawEquiv * slope) / 113;
  return Math.floor(ags + 1e-9);
}

export function difficultyConditionsLabel(modifier: number): string {
  if (modifier >= 0.92) return 'Tournament conditions';
  if (modifier >= 0.75) return 'Standard conditions';
  return 'Casual conditions';
}
