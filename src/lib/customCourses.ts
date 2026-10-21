import Constants from 'expo-constants';
import { COURSE_SEEDS } from './courses';
import { normalizeCourseName, stripGolfCourseSuffixes } from './courseNameNormalize';
import { isRatingSource, resolveTeeRatingFromInput, type RatingSource } from './ratingSource';
import { supabase } from './supabase';

export type CustomCourseTeeRow = {
  id: string;
  name: string;
  rating: number;
  slope: number;
  yards: number | null;
  par: number | null;
  rating_source: RatingSource;
};

export type CustomCourseRow = {
  id: string;
  name: string;
  name_normalized: string;
  location: string | null;
  source: 'custom';
  confident: boolean;
  created_by: string | null;
  course_tees: CustomCourseTeeRow[];
};

export type CustomTeeInput = {
  name: string;
  /** Total par (18-hole). */
  par: number;
  yards?: number | null;
  /** Optional official CR; leave blank with slope for Par/113 default. */
  ratingRaw?: string;
  slopeRaw?: string;
};

const CUSTOM_SELECT =
  'id,name,name_normalized,location,source,confident,created_by,course_tees(id,name,rating,slope,yards,par,rating_source)';

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

function normalizeTeeRows(raw: unknown): CustomCourseTeeRow[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomCourseTeeRow[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const row = t as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) continue;
    const rating = Number(row.rating);
    const slope = Math.round(Number(row.slope));
    if (!Number.isFinite(rating) || !Number.isFinite(slope)) continue;
    const rs = isRatingSource(row.rating_source) ? row.rating_source : 'default_unrated';
    out.push({
      id: typeof row.id === 'string' ? row.id : '',
      name,
      rating,
      slope,
      yards:
        row.yards != null && Number.isFinite(Number(row.yards)) ? Number(row.yards) : null,
      par: row.par != null && Number.isFinite(Number(row.par)) ? Number(row.par) : null,
      rating_source: rs,
    });
  }
  return out;
}

function asCustomCourseRow(row: Record<string, unknown>): CustomCourseRow | null {
  const id = typeof row.id === 'string' ? row.id : '';
  const name = typeof row.name === 'string' ? row.name : '';
  if (!id || !name) return null;
  return {
    id,
    name,
    name_normalized:
      typeof row.name_normalized === 'string' ? row.name_normalized : normalizeCourseName(name),
    location: typeof row.location === 'string' ? row.location : null,
    source: 'custom',
    confident: row.confident === true,
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    course_tees: normalizeTeeRows(row.course_tees),
  };
}

/** Load all custom/user-submitted courses for the log picker (shared across users). */
export async function fetchCustomCoursesForPicker(
  accessToken?: string
): Promise<CustomCourseRow[]> {
  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return [];
    const path = `courses?source=eq.custom&select=${encodeURIComponent(CUSTOM_SELECT)}&order=name.asc`;
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      console.warn('[customCourses] fetch', res.status, await res.text().catch(() => ''));
      return [];
    }
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows
      .map((r) => asCustomCourseRow(r as Record<string, unknown>))
      .filter((r): r is CustomCourseRow => r != null);
  }

  if (!supabase) return [];
  const { data, error } = await supabase
    .from('courses')
    .select(CUSTOM_SELECT)
    .eq('source', 'custom')
    .order('name', { ascending: true });

  if (error) {
    console.warn('[customCourses] fetch', error.message);
    return [];
  }
  return (data ?? [])
    .map((r) => asCustomCourseRow(r as Record<string, unknown>))
    .filter((r): r is CustomCourseRow => r != null);
}

async function fetchCustomCourseByNormalizedName(
  nameNormalized: string
): Promise<CustomCourseRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('courses')
    .select(CUSTOM_SELECT)
    .eq('source', 'custom')
    .eq('name_normalized', nameNormalized)
    .maybeSingle();
  if (error || !data) return null;
  return asCustomCourseRow(data as Record<string, unknown>);
}

async function fetchAnyDbCourseByNormalizedName(
  nameNormalized: string
): Promise<{ id: string; source: string; name: string } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('courses')
    .select('id,source,name')
    .eq('name_normalized', nameNormalized)
    .maybeSingle();
  if (error || !data) return null;
  return data as { id: string; source: string; name: string };
}

function buildTeeInsert(
  courseId: string,
  tee: CustomTeeInput
):
  | {
      course_id: string;
      name: string;
      rating: number;
      slope: number;
      yards: number | null;
      par: number;
      rating_source: RatingSource;
    }
  | { error: string } {
  const name = tee.name.trim();
  if (!name) return { error: 'Each tee needs a name.' };
  if (!Number.isFinite(tee.par) || tee.par < 27 || tee.par > 90) {
    return { error: 'Tee par must be between 27 and 90.' };
  }
  const resolved = resolveTeeRatingFromInput({
    par: tee.par,
    ratingRaw: tee.ratingRaw,
    slopeRaw: tee.slopeRaw,
  });
  if (resolved.error) return { error: resolved.error };
  const yards =
    tee.yards != null && Number.isFinite(tee.yards) && tee.yards > 0
      ? Math.round(tee.yards)
      : null;
  return {
    course_id: courseId,
    name,
    rating: resolved.rating!,
    slope: resolved.slope!,
    yards,
    par: Math.round(tee.par),
    rating_source: resolved.ratingSource!,
  };
}

/**
 * Create a custom course + tees, or return the existing row when name_normalized already exists
 * (including when another user created it first).
 */
export async function createCustomCourse(opts: {
  name: string;
  tees: CustomTeeInput[];
  userId: string;
}): Promise<{ course: CustomCourseRow } | { error: string }> {
  if (!supabase) return { error: 'Not signed in.' };
  const name = opts.name.trim();
  if (!name) return { error: 'Enter a course name.' };
  if (!opts.tees.length) return { error: 'Add at least one tee.' };

  const nameNormalized = normalizeCourseName(name);
  const nameStem = stripGolfCourseSuffixes(name);
  const curatedHit = COURSE_SEEDS.find((c) => {
    const cn = normalizeCourseName(c.name);
    const cs = stripGolfCourseSuffixes(c.name);
    return cn === nameNormalized || (nameStem.length > 0 && cs === nameStem);
  });
  if (curatedHit) {
    return {
      error: `“${curatedHit.name}” is already in the curated library. Search for it instead of creating a duplicate.`,
    };
  }

  const existingAny = await fetchAnyDbCourseByNormalizedName(nameNormalized);
  if (existingAny) {
    if (existingAny.source === 'custom') {
      const full = await fetchCustomCourseByNormalizedName(nameNormalized);
      if (full) {
        // Add any new tees the creator is submitting that don't exist yet.
        for (const tee of opts.tees) {
          const hit = full.course_tees.find(
            (t) => normalizeCourseName(t.name) === normalizeCourseName(tee.name)
          );
          if (!hit) {
            const add = await addTeeToCustomCourse({ courseId: full.id, tee });
            if ('course' in add) return add;
          }
        }
        const refreshed = await fetchCustomCourseByNormalizedName(nameNormalized);
        return refreshed ? { course: refreshed } : { course: full };
      }
    }
    return {
      error: `“${existingAny.name}” is already in the library. Search for it instead of creating a duplicate.`,
    };
  }

  const teeRows: ReturnType<typeof buildTeeInsert>[] = [];
  for (const tee of opts.tees) {
    const built = buildTeeInsert('pending', tee);
    if ('error' in built) return { error: built.error };
    teeRows.push(built);
  }

  const { data: courseData, error: courseError } = await supabase
    .from('courses')
    .insert({
      name,
      name_normalized: nameNormalized,
      source: 'custom',
      confident: false,
      created_by: opts.userId,
    })
    .select('id,name,name_normalized,location,source,confident,created_by')
    .single();

  if (courseError || !courseData) {
    // Race: another user inserted the same name — reuse theirs.
    if (courseError?.code === '23505') {
      const raced = await fetchCustomCourseByNormalizedName(nameNormalized);
      if (raced) return { course: raced };
    }
    return { error: courseError?.message ?? 'Could not create course.' };
  }

  const courseId = (courseData as { id: string }).id;
  const inserts = teeRows.map((t) => {
    if ('error' in t) throw new Error(t.error);
    return { ...t, course_id: courseId };
  });

  const { error: teeError } = await supabase.from('course_tees').insert(inserts);
  if (teeError) {
    await supabase.from('courses').delete().eq('id', courseId);
    return { error: teeError.message };
  }

  const full = await fetchCustomCourseByNormalizedName(nameNormalized);
  if (!full) {
    return {
      course: {
        ...(courseData as Omit<CustomCourseRow, 'course_tees' | 'source'>),
        source: 'custom',
        course_tees: [],
      },
    };
  }
  return { course: full };
}

/** Add a tee to an existing custom course (any authenticated user). */
export async function addTeeToCustomCourse(opts: {
  courseId: string;
  tee: CustomTeeInput;
}): Promise<{ course: CustomCourseRow } | { error: string }> {
  if (!supabase) return { error: 'Not signed in.' };
  const built = buildTeeInsert(opts.courseId, opts.tee);
  if ('error' in built) return { error: built.error };

  const { error } = await supabase.from('course_tees').insert(built);
  if (error) {
    if (error.code === '23505') {
      // Tee name already exists — treat as success and reload.
    } else {
      return { error: error.message };
    }
  }

  const { data, error: fetchErr } = await supabase
    .from('courses')
    .select(CUSTOM_SELECT)
    .eq('id', opts.courseId)
    .eq('source', 'custom')
    .maybeSingle();
  if (fetchErr || !data) return { error: fetchErr?.message ?? 'Course not found.' };
  const course = asCustomCourseRow(data as Record<string, unknown>);
  if (!course) return { error: 'Course not found.' };
  return { course };
}

export type BackfillCandidate = {
  name_normalized: string;
  sample_name: string;
  course_count: number;
  creator_count: number;
  tee_count: number;
  default_unrated_tees: number;
  user_reported_tees: number;
  first_created_at: string;
  last_created_at: string;
};

export async function fetchCustomCourseBackfillCandidates(): Promise<BackfillCandidate[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('custom_course_backfill_candidates')
    .select('*')
    .order('creator_count', { ascending: false })
    .limit(100);
  if (error) {
    console.warn('[customCourses] backfill', error.message);
    return [];
  }
  return (data ?? []) as BackfillCandidate[];
}

export async function adminUpdateCustomCourseTee(opts: {
  teeId: string;
  rating: number;
  slope: number;
  promoteToCurated?: boolean;
}): Promise<{ ok: true; rating_source: string } | { error: string }> {
  if (!supabase) return { error: 'Not signed in.' };
  const { data, error } = await supabase.rpc('admin_update_custom_course_tee', {
    p_tee_id: opts.teeId,
    p_rating: opts.rating,
    p_slope: opts.slope,
    p_promote_to_curated: opts.promoteToCurated !== false,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; rating_source?: string } | null;
  return { ok: true, rating_source: row?.rating_source ?? 'curated' };
}

export async function adminDeleteCustomCourse(
  courseId: string
): Promise<{ ok: true; name?: string } | { error: string }> {
  if (!supabase) return { error: 'Not signed in.' };
  const { data, error } = await supabase.rpc('admin_delete_custom_course', {
    p_course_id: courseId,
  });
  if (error) return { error: error.message };
  const row = data as { ok?: boolean; name?: string } | null;
  return { ok: true, name: row?.name };
}

export async function fetchCustomCoursesForAdmin(): Promise<CustomCourseRow[]> {
  return fetchCustomCoursesForPicker();
}
