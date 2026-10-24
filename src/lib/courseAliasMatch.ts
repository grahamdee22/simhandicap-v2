import { courseNameFuzzyMatch, normalizeCourseName } from './courseNameNormalize';

export type CourseAliasSource = 'manual_cross_reference' | 'location_match';

export type CourseAlias = {
  id: string;
  courseId: string;
  /** Community / GSPro display name (joined for convenience). */
  communityCourseName: string;
  realCourseName: string;
  realCourseNameNormalized: string;
  source: CourseAliasSource;
  confidence: 'verified' | 'suspected';
};

export function aliasMatchesQuery(alias: CourseAlias, rawQuery: string): boolean {
  if (courseNameFuzzyMatch(alias.realCourseName, rawQuery)) return true;
  if (courseNameFuzzyMatch(alias.realCourseNameNormalized, rawQuery)) return true;
  if (alias.communityCourseName && courseNameFuzzyMatch(alias.communityCourseName, rawQuery)) {
    return true;
  }
  return false;
}

/**
 * Whether a curated course name is the real-world target of an alias
 * (so searching the disguised GSPro name should also surface curated).
 */
export function curatedNameMatchesAliasReal(curatedName: string, alias: CourseAlias): boolean {
  if (courseNameFuzzyMatch(curatedName, alias.realCourseName)) return true;
  if (courseNameFuzzyMatch(alias.realCourseName, curatedName)) return true;
  const a = normalizeCourseName(curatedName).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const b = normalizeCourseName(alias.realCourseName)
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

export function recreationSubtitle(realCourseName: string): string {
  return `GSPro recreation of ${realCourseName}`;
}

export function curatedVerifiedSubtitle(): string {
  return 'Curated, verified rating';
}
