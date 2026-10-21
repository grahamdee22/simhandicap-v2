import { COURSE_SEEDS, courseMatchesSearch, normalizeCourseName } from './courses';
import { courseNameFuzzyMatch, courseNameMatchRank } from './courseNameNormalize';

export type PickerCourseSource = 'curated' | 'community' | 'custom';

export type PickerCourseItem = {
  id: string;
  name: string;
  location?: string;
  source: PickerCourseSource;
  confident: boolean;
  enrichmentTier?: number | null;
  enrichmentSource?: string | null;
};

export type PickerDbCourse = {
  id: string;
  name: string;
  location?: string | null;
  enrichment_tier?: number | null;
  enrichment_source?: string | null;
};

const SOURCE_RANK: Record<PickerCourseSource, number> = {
  curated: 0,
  community: 1,
  custom: 2,
};

export function curatedPickerCourses(query: string): PickerCourseItem[] {
  return COURSE_SEEDS.filter((c) => courseMatchesSearch(c, query))
    .map((c) => ({
      id: c.id,
      name: c.name,
      location: c.location,
      source: 'curated' as const,
      confident: c.confident !== false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function dbCourseMatchesSearch(
  course: { name: string; location?: string | null },
  rawQuery: string
): boolean {
  if (courseNameFuzzyMatch(course.name, rawQuery)) return true;
  if (course.location && courseNameFuzzyMatch(course.location, rawQuery)) return true;
  return false;
}

/**
 * Merge curated + optional community + custom into one typeahead list.
 * Prefer curated over community over custom when names collide; rank by fuzzy match quality.
 */
export function mergePickerCourses(
  curated: PickerCourseItem[],
  community: PickerDbCourse[],
  query: string,
  custom: PickerDbCourse[] = []
): PickerCourseItem[] {
  const communityItems = community
    .filter((c) => dbCourseMatchesSearch(c, query))
    .map((c) => ({
      id: c.id,
      name: c.name,
      location: c.location ?? undefined,
      source: 'community' as const,
      confident: false,
      enrichmentTier: c.enrichment_tier,
      enrichmentSource: c.enrichment_source,
    }));
  const customItems = custom
    .filter((c) => dbCourseMatchesSearch(c, query))
    .map((c) => ({
      id: c.id,
      name: c.name,
      location: c.location ?? undefined,
      source: 'custom' as const,
      confident: false,
    }));

  const byNorm = new Map<string, PickerCourseItem>();
  for (const item of [...curated, ...communityItems, ...customItems]) {
    const key = normalizeCourseName(item.name);
    const prev = byNorm.get(key);
    if (!prev || SOURCE_RANK[item.source] < SOURCE_RANK[prev.source]) {
      byNorm.set(key, item);
    }
  }

  return [...byNorm.values()].sort((a, b) => {
    const ra = courseNameMatchRank(a.name, query);
    const rb = courseNameMatchRank(b.name, query);
    if (ra !== rb) return ra - rb;
    const sa = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (sa !== 0) return sa;
    return a.name.localeCompare(b.name);
  });
}
