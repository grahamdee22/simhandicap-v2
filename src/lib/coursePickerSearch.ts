import type { CourseAlias } from './courseAliasMatch';
import {
  aliasMatchesQuery,
  curatedNameMatchesAliasReal,
  curatedVerifiedSubtitle,
  recreationSubtitle,
} from './courseAliasMatch';
import { COURSE_SEEDS, courseMatchesSearch } from './courses';
import {
  courseNameFuzzyMatch,
  courseNameMatchRank,
  coursePickerCollapseKey,
} from './courseNameNormalize';

export type PickerCourseSource = 'curated' | 'community' | 'custom';

export type PickerCourseItem = {
  id: string;
  name: string;
  location?: string;
  source: PickerCourseSource;
  confident: boolean;
  enrichmentTier?: number | null;
  enrichmentSource?: string | null;
  /** Secondary line under the name (alias findability labels). */
  subtitle?: string;
  /** When set, this community row is a known GSPro recreation of `recreationOf`. */
  recreationOf?: string;
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

/**
 * Curated picker that also surfaces curated seeds when the query matches a
 * disguised GSPro name that aliases to that real course (tournament-lock path).
 */
export function curatedPickerCoursesWithAliases(
  query: string,
  aliases: CourseAlias[] = []
): PickerCourseItem[] {
  const q = query.trim();
  const base = curatedPickerCourses(q);
  if (!q || aliases.length === 0) return base;

  const byId = new Map(base.map((c) => [c.id, { ...c }]));
  for (const seed of COURSE_SEEDS) {
    if (byId.has(seed.id)) {
      const existing = byId.get(seed.id)!;
      const paired = aliases.some(
        (a) =>
          curatedNameMatchesAliasReal(seed.name, a) &&
          courseNameFuzzyMatch(a.communityCourseName, q)
      );
      if (paired) {
        byId.set(seed.id, { ...existing, subtitle: curatedVerifiedSubtitle() });
      }
      continue;
    }
    const hit = aliases.some(
      (a) =>
        courseNameFuzzyMatch(a.communityCourseName, q) &&
        curatedNameMatchesAliasReal(seed.name, a)
    );
    if (!hit) continue;
    byId.set(seed.id, {
      id: seed.id,
      name: seed.name,
      location: seed.location,
      source: 'curated',
      confident: seed.confident !== false,
      subtitle: curatedVerifiedSubtitle(),
    });
  }

  return [...byId.values()].sort((a, b) => {
    const ra = courseNameMatchRank(a.name, q);
    const rb = courseNameMatchRank(b.name, q);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
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
 * Prefer curated over community over custom when near-duplicate names collide
 * (`coursePickerCollapseKey`); rank by fuzzy match quality.
 *
 * Alias pairs stay distinct (never collapsed together) and match in both directions.
 */
export function mergePickerCourses(
  curated: PickerCourseItem[],
  community: PickerDbCourse[],
  query: string,
  custom: PickerDbCourse[] = [],
  aliases: CourseAlias[] = []
): PickerCourseItem[] {
  const aliasByCourseId = new Map(aliases.map((a) => [a.courseId, a]));

  const curatedItems: PickerCourseItem[] = [];
  const curatedSeen = new Set<string>();

  const considerCurated = (
    id: string,
    name: string,
    location: string | undefined,
    confident: boolean,
    viaDisguisedQuery: boolean
  ) => {
    if (curatedSeen.has(id)) return;
    curatedSeen.add(id);
    curatedItems.push({
      id,
      name,
      location,
      source: 'curated',
      confident,
      subtitle: viaDisguisedQuery ? curatedVerifiedSubtitle() : undefined,
    });
  };

  for (const c of curated) {
    const direct =
      courseNameFuzzyMatch(c.name, query) ||
      (c.location ? courseNameFuzzyMatch(c.location, query) : false);
    const viaDisguised = aliases.some(
      (a) =>
        curatedNameMatchesAliasReal(c.name, a) && courseNameFuzzyMatch(a.communityCourseName, query)
    );
    const viaRealAlias = aliases.some(
      (a) => curatedNameMatchesAliasReal(c.name, a) && aliasMatchesQuery(a, query)
    );
    if (!direct && !viaDisguised && !viaRealAlias) continue;
    considerCurated(
      c.id,
      c.name,
      c.location,
      c.confident,
      viaDisguised || (viaRealAlias && !direct)
    );
  }

  for (const seed of COURSE_SEEDS) {
    if (curatedSeen.has(seed.id)) continue;
    const viaDisguised = aliases.some(
      (a) =>
        curatedNameMatchesAliasReal(seed.name, a) &&
        courseNameFuzzyMatch(a.communityCourseName, query)
    );
    if (!viaDisguised) continue;
    considerCurated(
      seed.id,
      seed.name,
      seed.location,
      seed.confident !== false,
      true
    );
  }

  const communityItems: PickerCourseItem[] = community
    .filter((c) => {
      if (dbCourseMatchesSearch(c, query)) return true;
      const alias = aliasByCourseId.get(c.id);
      return alias ? aliasMatchesQuery(alias, query) : false;
    })
    .map((c) => {
      const alias = aliasByCourseId.get(c.id);
      return {
        id: c.id,
        name: c.name,
        location: c.location ?? undefined,
        source: 'community' as const,
        confident: false,
        enrichmentTier: c.enrichment_tier,
        enrichmentSource: c.enrichment_source,
        recreationOf: alias?.realCourseName,
        subtitle: alias ? recreationSubtitle(alias.realCourseName) : undefined,
      };
    });

  const customItems = custom
    .filter((c) => dbCourseMatchesSearch(c, query))
    .map((c) => ({
      id: c.id,
      name: c.name,
      location: c.location ?? undefined,
      source: 'custom' as const,
      confident: false,
    }));

  // Near-dupe collapse for ordinary listings; never collapse alias recreations or
  // curated rows that are only present as the verified pair for an alias.
  const aliasedCommunityIds = new Set(
    communityItems.filter((c) => c.recreationOf).map((c) => c.id)
  );
  const curatedPairedIds = new Set(
    curatedItems
      .filter((c) =>
        aliases.some(
          (a) =>
            aliasedCommunityIds.has(a.courseId) && curatedNameMatchesAliasReal(c.name, a)
        )
      )
      .map((c) => c.id)
  );

  const byCollapse = new Map<string, PickerCourseItem>();
  for (const item of [...curatedItems, ...communityItems, ...customItems]) {
    const keepDistinct =
      !!item.recreationOf ||
      (item.source === 'curated' && curatedPairedIds.has(item.id));
    const key = keepDistinct
      ? `${item.source}:${item.id}`
      : coursePickerCollapseKey(item.name);
    if (!key) continue;
    const prev = byCollapse.get(key);
    if (!prev || SOURCE_RANK[item.source] < SOURCE_RANK[prev.source]) {
      byCollapse.set(key, item);
    }
  }

  return [...byCollapse.values()].sort((a, b) => {
    const ra = courseNameMatchRank(a.name, query);
    const rb = courseNameMatchRank(b.name, query);
    if (ra !== rb) return ra - rb;
    const sa = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
    if (sa !== 0) return sa;
    return a.name.localeCompare(b.name);
  });
}
