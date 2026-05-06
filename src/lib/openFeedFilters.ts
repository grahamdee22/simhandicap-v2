import type { PlatformId } from './constants';
import { canonicalPlatformId } from './constants';
import type { DbMatchRow } from './matchPlay';

/** Multi-select handicap buckets for the open feed (poster `player_1_ghin_index_at_post`). */
export type OpenFeedHandicapRangeId =
  | 'scratch'
  | '1_5'
  | '5_9'
  | '10_15'
  | '15_20'
  | '20_plus';

export const OPEN_FEED_HANDICAP_RANGE_ORDER: readonly OpenFeedHandicapRangeId[] = [
  'scratch',
  '1_5',
  '5_9',
  '10_15',
  '15_20',
  '20_plus',
] as const;

const RANGE_LABELS: Record<OpenFeedHandicapRangeId, string> = {
  scratch: 'Scratch (0 and below)',
  '1_5': '1–5',
  '5_9': '5–9',
  '10_15': '10–15',
  '15_20': '15–20',
  '20_plus': '20+',
};

export function openFeedHandicapRangeLabel(id: OpenFeedHandicapRangeId): string {
  return RANGE_LABELS[id];
}

/**
 * True if poster handicap index `n` falls in the bucket `id`.
 * Buckets overlap at boundaries so multi-select OR semantics match user expectations.
 */
export function posterHandicapIndexMatchesRange(n: number, id: OpenFeedHandicapRangeId): boolean {
  switch (id) {
    case 'scratch':
      return n <= 0;
    case '1_5':
      return n > 0 && n <= 5;
    case '5_9':
      return n >= 5 && n <= 9;
    case '10_15':
      return n >= 10 && n <= 15;
    case '15_20':
      return n >= 15 && n <= 20;
    case '20_plus':
      return n >= 20;
  }
}

export type OpenFeedFilterState = {
  /** Empty = all poster handicaps; OR across selected ranges vs `player_1_ghin_index_at_post`. */
  handicapRanges: OpenFeedHandicapRangeId[];
  /** Exact course name from feed, or null for all courses. */
  courseName: string | null;
  /** Empty = all platforms; otherwise poster must match one of these. */
  platforms: PlatformId[];
};

export const DEFAULT_OPEN_FEED_FILTERS: OpenFeedFilterState = {
  handicapRanges: [],
  courseName: null,
  platforms: [],
};

export function openFeedFiltersActive(f: OpenFeedFilterState): boolean {
  return f.handicapRanges.length > 0 || f.courseName != null || f.platforms.length > 0;
}

/**
 * Client-side filter + sort (newest first) for the open challenge feed only.
 */
export function filterAndSortOpenFeedRows(rows: DbMatchRow[], f: OpenFeedFilterState): DbMatchRow[] {
  let out = [...rows].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (f.handicapRanges.length > 0) {
    out = out.filter((m) => {
      const raw = m.player_1_ghin_index_at_post;
      if (raw == null || !Number.isFinite(Number(raw))) return false;
      const n = Number(raw);
      return f.handicapRanges.some((id) => posterHandicapIndexMatchesRange(n, id));
    });
  }

  if (f.courseName != null && f.courseName.trim() !== '') {
    out = out.filter((m) => m.course_name === f.courseName);
  }

  if (f.platforms.length > 0) {
    const set = new Set(f.platforms);
    out = out.filter((m) => {
      const plat = canonicalPlatformId(m.player_1_platform);
      if (plat == null) return false;
      return set.has(plat);
    });
  }

  return out;
}

export function uniqueCourseNamesFromOpenFeed(rows: DbMatchRow[]): string[] {
  const s = new Set<string>();
  for (const m of rows) {
    const n = m.course_name?.trim();
    if (n) s.add(n);
  }
  return [...s].sort((a, b) => a.localeCompare(b));
}
