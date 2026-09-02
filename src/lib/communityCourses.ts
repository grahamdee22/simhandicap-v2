import Constants from 'expo-constants';
import type { PlatformId } from './constants';
import {
  COURSE_SEEDS,
  courseMatchesSearch,
  getCourseById,
  getCourseTees,
  normalizeCourseName,
  type CourseSeed,
  type CourseTee,
} from './courses';
import { supabase } from './supabase';
import { communityCourseAttributionLabel } from './communityEnrichment';
import { isCommunityCourseId } from './communityCourseId';
import {
  fetchCommunityCourseEnrichment as fetchCommunityCourseEnrichmentCore,
  type CourseEnrichment,
} from './fetchCommunityCourseEnrichment';

export { communityCourseAttributionLabel, isCommunityCourseId };
export type { CourseEnrichment };

export type HandicapSource = 'verified' | 'unverified';

export type CommunityCourseRow = {
  id: string;
  name: string;
  name_normalized: string;
  location: string | null;
  designer: string | null;
  source: 'community';
  confident: boolean;
  gspro_difficulty: number | null;
  enrichment_tier: number | null;
  enrichment_source: string | null;
  course_tees: {
    name: string;
    rating: number;
    slope: number;
    yards: number | null;
  }[];
};

export type PickerCourseItem = {
  id: string;
  name: string;
  location?: string;
  source: 'curated' | 'community';
  confident: boolean;
  enrichmentTier?: number | null;
  enrichmentSource?: string | null;
};

export type ResolvedLogCourse = {
  id: string;
  name: string;
  location?: string;
  source: 'curated' | 'community';
  confident: boolean;
  handicapSource: HandicapSource;
  enrichmentTier?: number | null;
  enrichmentSource?: string | null;
  /** Present for curated courses only. */
  seed?: CourseSeed;
  tees: CourseTee[];
};

export function curatedPickerCourses(query: string): PickerCourseItem[] {
  return COURSE_SEEDS.filter((c) => c.confident !== false && courseMatchesSearch(c, query))
    .map((c) => ({
      id: c.id,
      name: c.name,
      location: c.location,
      source: 'curated' as const,
      confident: c.confident !== false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function communityMatchesSearch(course: CommunityCourseRow, rawQuery: string): boolean {
  const q = normalizeCourseName(rawQuery);
  if (!q) return true;
  if (normalizeCourseName(course.name).includes(q)) return true;
  if (course.location && normalizeCourseName(course.location).includes(q)) return true;
  return false;
}

export function mergePickerCourses(
  curated: PickerCourseItem[],
  community: CommunityCourseRow[],
  query: string
): PickerCourseItem[] {
  const communityItems = community
    .filter((c) => communityMatchesSearch(c, query))
    .map((c) => ({
      id: c.id,
      name: c.name,
      location: c.location ?? undefined,
      source: 'community' as const,
      confident: false,
      enrichmentTier: c.enrichment_tier,
      enrichmentSource: c.enrichment_source,
    }));
  return [...curated, ...communityItems].sort((a, b) => a.name.localeCompare(b.name));
}

function communityTeesFromRow(row: CommunityCourseRow): CourseTee[] {
  return (row.course_tees ?? []).map((t) => ({
    name: t.name,
    rating: Number(t.rating),
    slope: Math.round(Number(t.slope)),
    ...(t.yards != null && Number.isFinite(Number(t.yards)) ? { yards: Number(t.yards) } : {}),
  }));
}

export function resolveLogCourse(
  courseId: string,
  platform: PlatformId,
  communityCourses: CommunityCourseRow[]
): ResolvedLogCourse | null {
  const seed = getCourseById(courseId);
  if (seed) {
    const confident = seed.confident !== false;
    return {
      id: seed.id,
      name: seed.name,
      location: seed.location,
      source: 'curated',
      confident,
      handicapSource: confident ? 'verified' : 'unverified',
      seed,
      tees: getCourseTees(seed, platform),
    };
  }
  const row = communityCourses.find((c) => c.id === courseId);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    location: row.location ?? undefined,
    source: 'community',
    confident: false,
    handicapSource: 'unverified',
    enrichmentTier: row.enrichment_tier,
    enrichmentSource: row.enrichment_source,
    tees: communityTeesFromRow(row),
  };
}

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

const COMMUNITY_SELECT =
  'id,name,name_normalized,location,designer,source,confident,gspro_difficulty,enrichment_tier,enrichment_source,course_tees(name,rating,slope,yards)';

/** Load enriched community courses for the log picker (requires auth). */
export async function fetchCommunityCoursesForPicker(
  accessToken?: string
): Promise<CommunityCourseRow[]> {
  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return [];
    const path = `courses?source=eq.community&enrichment_tier=not.is.null&select=${encodeURIComponent(COMMUNITY_SELECT)}&order=name.asc`;
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      console.warn('[communityCourses] fetch', res.status, await res.text().catch(() => ''));
      return [];
    }
    const rows = (await res.json()) as CommunityCourseRow[];
    return Array.isArray(rows) ? rows : [];
  }

  if (!supabase) return [];
  const { data, error } = await supabase
    .from('courses')
    .select(COMMUNITY_SELECT)
    .eq('source', 'community')
    .not('enrichment_tier', 'is', null)
    .order('name', { ascending: true });

  if (error) {
    console.warn('[communityCourses] fetch', error.message);
    return [];
  }
  return (data ?? []) as CommunityCourseRow[];
}

/** Live course enrichment for round detail (Option B: no snapshot columns on rounds). */
export async function fetchCommunityCourseEnrichment(
  courseId: string,
  accessToken?: string
): Promise<CourseEnrichment | null> {
  return fetchCommunityCourseEnrichmentCore(courseId, accessToken, {
    getRestConfig: getSupabaseRestConfig,
    querySupabase: async (id) => {
      if (!supabase) return null;
      const { data, error } = await supabase
        .from('courses')
        .select('enrichment_tier,enrichment_source')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as { enrichment_tier: number | null; enrichment_source: string | null };
      return {
        enrichmentTier: row.enrichment_tier ?? null,
        enrichmentSource: row.enrichment_source ?? null,
      };
    },
  });
}
