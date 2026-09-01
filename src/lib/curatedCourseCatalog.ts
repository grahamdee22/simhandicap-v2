/**
 * Curated course catalog helpers with no React Native / Expo dependencies.
 * Safe for Node scripts (`npm run import:gspro`, `npm run enrich:gspro`).
 */
import {
  COURSE_SEEDS,
  getCourseTees,
  type CourseSeed,
} from './courses';
import { normalizeCourseName } from './courseNameNormalize';

export { normalizeCourseName };

/** Normalized names already covered by in-app COURSE_SEEDS (import dedupe). */
export function curatedNormalizedNameSet(): Set<string> {
  const set = new Set<string>();
  for (const s of COURSE_SEEDS) {
    set.add(normalizeCourseName(s.name));
  }
  return set;
}

/** First curated seed per normalized name (Tier 1 enrichment lookup). */
export function curatedSeedByNormalizedName(): Map<string, CourseSeed> {
  const map = new Map<string, CourseSeed>();
  for (const s of COURSE_SEEDS) {
    const norm = normalizeCourseName(s.name);
    if (!map.has(norm)) map.set(norm, s);
  }
  return map;
}

export type EnrichmentTeeRow = {
  name: string;
  rating: number;
  slope: number;
  yards: number | null;
};

/** Copy GSPro tees from a curated seed for Tier 1 `course_tees` rows. */
export function gsProTeesFromSeed(seed: CourseSeed): EnrichmentTeeRow[] {
  return getCourseTees(seed, 'GSPro').map((t) => ({
    name: t.name,
    rating: t.rating,
    slope: t.slope,
    yards: t.yards ?? null,
  }));
}
