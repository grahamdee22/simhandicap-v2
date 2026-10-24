import Constants from 'expo-constants';
import { COURSE_SEEDS } from './courses';
import { normalizeCourseName, stripGolfCourseSuffixes } from './courseNameNormalize';
import { friendlyCourseWriteError } from './courseWriteErrors';
import { googleOAuthAccessToken } from './googleOAuthAccessToken';
import { isRatingSource, resolveTeeRatingFromInput, type RatingSource } from './ratingSource';
import { supabase } from './supabase';

export { friendlyCourseWriteError } from './courseWriteErrors';

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

async function resolveCourseWriteAuth(): Promise<
  { accessToken: string; userId: string } | { error: string }
> {
  if (!supabase) return { error: 'Not signed in.' };
  const accessToken =
    googleOAuthAccessToken ??
    (await supabase.auth.getSession()).data.session?.access_token ??
    null;
  if (!accessToken) {
    return { error: 'Sign in again to add a course.' };
  }

  let userId =
    (await supabase.auth.getSession()).data.session?.user?.id?.trim() || null;
  if (!userId) {
    const { data } = await supabase.auth.getUser(accessToken);
    userId = data.user?.id?.trim() || null;
  }
  if (!userId) {
    return { error: 'Sign in again to add a course.' };
  }
  return { accessToken, userId };
}

async function restSelectSingle(
  accessToken: string,
  path: string
): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { row: null, error: 'Supabase is not configured.' };
  }
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.pgrst.object+json',
    },
  });
  if (res.status === 406 || res.status === 404) return { row: null, error: null };
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let msg = text || res.statusText;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j?.message) msg = j.message;
    } catch {
      /* keep */
    }
    return { row: null, error: msg };
  }
  if (!text) return { row: null, error: null };
  try {
    return { row: JSON.parse(text) as Record<string, unknown>, error: null };
  } catch {
    return { row: null, error: 'Invalid response' };
  }
}

async function restInsertRows(
  accessToken: string,
  table: string,
  rows: Record<string, unknown>[],
  select?: string
): Promise<{ rows: Record<string, unknown>[]; error: string | null; code?: string }> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { rows: [], error: 'Supabase is not configured.' };
  }
  const qs = select ? `?select=${encodeURIComponent(select)}` : '';
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}${qs}`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(rows),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let msg = text || res.statusText;
    let code: string | undefined;
    try {
      const j = JSON.parse(text) as { message?: string; code?: string };
      if (j?.message) msg = j.message;
      if (j?.code) code = j.code;
    } catch {
      /* keep */
    }
    return { rows: [], error: msg, code };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return { rows: Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [], error: null };
  } catch {
    return { rows: [], error: 'Invalid response' };
  }
}

async function fetchCustomCourseByNormalizedName(
  nameNormalized: string,
  accessToken?: string
): Promise<CustomCourseRow | null> {
  if (accessToken) {
    const { row, error } = await restSelectSingle(
      accessToken,
      `courses?source=eq.custom&name_normalized=eq.${encodeURIComponent(nameNormalized)}&select=${encodeURIComponent(CUSTOM_SELECT)}`
    );
    if (error || !row) return null;
    return asCustomCourseRow(row);
  }
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
  nameNormalized: string,
  accessToken?: string
): Promise<{ id: string; source: string; name: string } | null> {
  if (accessToken) {
    const { row, error } = await restSelectSingle(
      accessToken,
      `courses?name_normalized=eq.${encodeURIComponent(nameNormalized)}&select=id,source,name`
    );
    if (error || !row) return null;
    return {
      id: String(row.id ?? ''),
      source: String(row.source ?? ''),
      name: String(row.name ?? ''),
    };
  }
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
 *
 * Auth: uses the live JWT (`googleOAuthAccessToken` or supabase session). `opts.userId` is only a
 * fallback hint — `created_by` must match `auth.uid()` for RLS.
 */
export async function createCustomCourse(opts: {
  name: string;
  tees: CustomTeeInput[];
  userId: string;
}): Promise<{ course: CustomCourseRow } | { error: string }> {
  const auth = await resolveCourseWriteAuth();
  if ('error' in auth) return { error: auth.error };
  const { accessToken, userId: createdBy } = auth;
  void opts.userId; // UI still passes user.id; JWT subject is authoritative for RLS.

  const name = opts.name.trim();
  if (!name) return { error: 'Enter a course name.' };
  if (!opts.tees.length) return { error: 'Add at least one tee.' };

  try {
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

    const existingAny = await fetchAnyDbCourseByNormalizedName(nameNormalized, accessToken);
    if (existingAny) {
      if (existingAny.source === 'custom') {
        const full = await fetchCustomCourseByNormalizedName(nameNormalized, accessToken);
        if (full) {
          for (const tee of opts.tees) {
            const hit = full.course_tees.find(
              (t) => normalizeCourseName(t.name) === normalizeCourseName(tee.name)
            );
            if (!hit) {
              const add = await addTeeToCustomCourse({ courseId: full.id, tee });
              if ('course' in add) return add;
              if ('error' in add) return { error: friendlyCourseWriteError(add.error) };
            }
          }
          const refreshed = await fetchCustomCourseByNormalizedName(nameNormalized, accessToken);
          return refreshed ? { course: refreshed } : { course: full };
        }
      }
      return {
        error: `“${existingAny.name}” is already in the library. Search for it instead of creating a duplicate.`,
      };
    }

    const teeRows: Exclude<ReturnType<typeof buildTeeInsert>, { error: string }>[] = [];
    for (const tee of opts.tees) {
      const built = buildTeeInsert('pending', tee);
      if ('error' in built) return { error: built.error };
      teeRows.push(built);
    }

    const inserted = await restInsertRows(
      accessToken,
      'courses',
      [
        {
          name,
          name_normalized: nameNormalized,
          source: 'custom',
          confident: false,
          created_by: createdBy,
        },
      ],
      'id,name,name_normalized,location,source,confident,created_by'
    );

    if (inserted.error || !inserted.rows[0]) {
      if (inserted.code === '23505') {
        const raced = await fetchCustomCourseByNormalizedName(nameNormalized, accessToken);
        if (raced) return { course: raced };
      }
      return { error: friendlyCourseWriteError(inserted.error ?? 'Could not create course.') };
    }

    const courseData = inserted.rows[0];
    const courseId = String(courseData.id ?? '');
    if (!courseId) {
      return { error: friendlyCourseWriteError('Could not create course.') };
    }

    const teeInsert = await restInsertRows(
      accessToken,
      'course_tees',
      teeRows.map((t) => ({ ...t, course_id: courseId }))
    );
    if (teeInsert.error) {
      // Best-effort cleanup; ignore delete failures (may lack DELETE RLS).
      const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
      if (supabaseUrl && supabaseAnonKey) {
        await fetch(`${supabaseUrl}/rest/v1/courses?id=eq.${encodeURIComponent(courseId)}`, {
          method: 'DELETE',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${accessToken}`,
          },
        }).catch(() => undefined);
      }
      return { error: friendlyCourseWriteError(teeInsert.error) };
    }

    const full = await fetchCustomCourseByNormalizedName(nameNormalized, accessToken);
    if (!full) {
      return {
        course: {
          id: courseId,
          name: String(courseData.name ?? name),
          name_normalized: String(courseData.name_normalized ?? nameNormalized),
          location: typeof courseData.location === 'string' ? courseData.location : null,
          source: 'custom',
          confident: courseData.confident === true,
          created_by: typeof courseData.created_by === 'string' ? courseData.created_by : createdBy,
          course_tees: [],
        },
      };
    }
    return { course: full };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { error: friendlyCourseWriteError(raw) };
  }
}

/** Add a tee to an existing custom course (any authenticated user). */
export async function addTeeToCustomCourse(opts: {
  courseId: string;
  tee: CustomTeeInput;
}): Promise<{ course: CustomCourseRow } | { error: string }> {
  const auth = await resolveCourseWriteAuth();
  if ('error' in auth) return { error: auth.error };
  const { accessToken } = auth;

  const built = buildTeeInsert(opts.courseId, opts.tee);
  if ('error' in built) return { error: built.error };

  const teeInsert = await restInsertRows(accessToken, 'course_tees', [built]);
  if (teeInsert.error && teeInsert.code !== '23505') {
    return { error: friendlyCourseWriteError(teeInsert.error) };
  }

  const { row, error: fetchErr } = await restSelectSingle(
    accessToken,
    `courses?id=eq.${encodeURIComponent(opts.courseId)}&source=eq.custom&select=${encodeURIComponent(CUSTOM_SELECT)}`
  );
  if (fetchErr || !row) {
    return { error: friendlyCourseWriteError(fetchErr ?? 'Course not found.') };
  }
  const course = asCustomCourseRow(row);
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
