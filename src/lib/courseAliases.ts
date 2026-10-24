import Constants from 'expo-constants';
import {
  type CourseAlias,
  type CourseAliasSource,
} from './courseAliasMatch';
import { normalizeCourseName } from './courseNameNormalize';
import { supabase } from './supabase';

export type { CourseAlias, CourseAliasSource };
export {
  aliasMatchesQuery,
  curatedNameMatchesAliasReal,
  curatedVerifiedSubtitle,
  recreationSubtitle,
} from './courseAliasMatch';

function getSupabaseRestConfig(): { supabaseUrl: string; supabaseAnonKey: string } {
  const extra = Constants.expoConfig?.extra as
    | { supabaseUrl?: string; supabaseAnonKey?: string; supabasePublishableKey?: string }
    | undefined;
  return {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra?.supabaseUrl ?? '',
    supabaseAnonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_KEY ??
      extra?.supabaseAnonKey ??
      extra?.supabasePublishableKey ??
      '',
  };
}

function asAlias(row: Record<string, unknown>): CourseAlias | null {
  const id = typeof row.id === 'string' ? row.id : '';
  const courseId = typeof row.course_id === 'string' ? row.course_id : '';
  const realCourseName = typeof row.real_course_name === 'string' ? row.real_course_name : '';
  if (!id || !courseId || !realCourseName) return null;
  const courses = row.courses as { name?: string } | { name?: string }[] | null | undefined;
  const communityName = Array.isArray(courses)
    ? courses[0]?.name
    : courses && typeof courses === 'object'
      ? courses.name
      : undefined;
  const source: CourseAliasSource =
    row.source === 'location_match' ? 'location_match' : 'manual_cross_reference';
  const confidence = row.confidence === 'suspected' ? 'suspected' : 'verified';
  return {
    id,
    courseId,
    communityCourseName: typeof communityName === 'string' ? communityName : '',
    realCourseName,
    realCourseNameNormalized:
      typeof row.real_course_name_normalized === 'string'
        ? row.real_course_name_normalized
        : normalizeCourseName(realCourseName),
    source,
    confidence,
  };
}

const ALIAS_SELECT =
  'id,course_id,real_course_name,real_course_name_normalized,source,confidence,courses(name)';

/** Load all manual GSPro→real aliases (small table). */
export async function fetchCourseAliases(accessToken?: string): Promise<CourseAlias[]> {
  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return [];
    const res = await fetch(
      `${supabaseUrl}/rest/v1/course_aliases?select=${encodeURIComponent(ALIAS_SELECT)}&order=real_course_name.asc`,
      {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (!res.ok) {
      console.warn('[courseAliases] fetch', res.status, await res.text().catch(() => ''));
      return [];
    }
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r) => asAlias(r as Record<string, unknown>))
      .filter((a): a is CourseAlias => a != null);
  }

  if (!supabase) return [];
  const { data, error } = await supabase
    .from('course_aliases')
    .select(ALIAS_SELECT)
    .order('real_course_name', { ascending: true });
  if (error) {
    console.warn('[courseAliases] fetch', error.message);
    return [];
  }
  return (data ?? [])
    .map((r) => asAlias(r as Record<string, unknown>))
    .filter((a): a is CourseAlias => a != null);
}
