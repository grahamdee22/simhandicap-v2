/**
 * Map a scanned scorecard course name onto curated / community catalog entries.
 * Reuses the same normalize + exact/contains approach as findCourseSeedIdByCourseName,
 * extended to optional community rows already loaded for the picker.
 */

import type { PlatformId } from './constants';
import type { CommunityCourseRow } from './communityCourses';
import { normalizeCourseName } from './courseNameNormalize';
import {
  COURSE_SEEDS,
  getCourseById,
  getCourseTees,
  type CourseSeed,
} from './courses';

export type ScannedCourseMatch = {
  courseId: string;
  courseName: string;
  source: 'curated' | 'community';
  confidence: 'exact' | 'fuzzy';
};

/** Longer overlap wins so short false positives ("Bay") lose to full names. */
function containsScore(haystack: string, needle: string): number {
  if (!haystack || !needle) return 0;
  if (haystack === needle) return 10_000;
  if (haystack.includes(needle) || needle.includes(haystack)) {
    return Math.min(haystack.length, needle.length);
  }
  return 0;
}

export function matchCourseFromScannedName(
  rawName: string | null | undefined,
  communityCourses: CommunityCourseRow[] = []
): ScannedCourseMatch | null {
  const needle = normalizeCourseName(rawName ?? '');
  if (needle.length < 2) return null;

  for (const c of COURSE_SEEDS) {
    if (c.confident === false) continue;
    if (normalizeCourseName(c.name) === needle) {
      return {
        courseId: c.id,
        courseName: c.name,
        source: 'curated',
        confidence: 'exact',
      };
    }
  }

  for (const c of communityCourses) {
    const norm = (c.name_normalized ?? '').trim() || normalizeCourseName(c.name);
    if (norm === needle || normalizeCourseName(c.name) === needle) {
      return {
        courseId: c.id,
        courseName: c.name,
        source: 'community',
        confidence: 'exact',
      };
    }
  }

  let bestCurated: CourseSeed | null = null;
  let bestScore = 0;
  for (const c of COURSE_SEEDS) {
    if (c.confident === false) continue;
    const s = containsScore(normalizeCourseName(c.name), needle);
    if (s > bestScore) {
      bestScore = s;
      bestCurated = c;
    }
  }
  if (bestCurated && bestScore > 0) {
    return {
      courseId: bestCurated.id,
      courseName: bestCurated.name,
      source: 'curated',
      confidence: 'fuzzy',
    };
  }

  let bestComm: CommunityCourseRow | null = null;
  bestScore = 0;
  for (const c of communityCourses) {
    const s = containsScore(normalizeCourseName(c.name), needle);
    if (s > bestScore) {
      bestScore = s;
      bestComm = c;
    }
  }
  if (bestComm && bestScore > 0) {
    return {
      courseId: bestComm.id,
      courseName: bestComm.name,
      source: 'community',
      confidence: 'fuzzy',
    };
  }

  return null;
}

/** Tee names for matching parsed `tees` after a course switch (sync, no React state). */
export function teeNamesForScannedCourseMatch(
  match: ScannedCourseMatch,
  platform: PlatformId,
  communityCourses: CommunityCourseRow[] = []
): string[] {
  if (match.source === 'curated') {
    const seed = getCourseById(match.courseId);
    if (!seed) return [];
    return getCourseTees(seed, platform).map((t) => t.name);
  }
  const row = communityCourses.find((c) => c.id === match.courseId);
  return (row?.course_tees ?? []).map((t) => t.name);
}
