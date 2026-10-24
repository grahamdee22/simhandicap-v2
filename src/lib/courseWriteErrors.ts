/** Never surface raw Postgres / PostgREST / RLS strings in the course-create UI. */
export function friendlyCourseWriteError(raw: string | null | undefined): string {
  const msg = (raw ?? '').trim();
  const lower = msg.toLowerCase();
  if (!msg) {
    return 'Could not save this course. Please try again.';
  }
  if (
    lower.includes('row-level security') ||
    lower.includes('violates row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('jwt') ||
    lower.includes('not authenticated') ||
    /\b42501\b/.test(lower)
  ) {
    return 'Could not save this course. Sign out and back in, then try again.';
  }
  if (lower.includes('duplicate key') || lower.includes('unique constraint') || /\b23505\b/.test(lower)) {
    return 'A course with that name is already in the library. Search for it instead of creating a duplicate.';
  }
  if (
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('timeout') ||
    lower.includes('fetch failed')
  ) {
    return 'Network error — check your connection and try again.';
  }
  // Anything that still looks like a DB/PostgREST dump
  if (
    lower.includes('violates') ||
    lower.includes('postgres') ||
    lower.includes('pgrst') ||
    lower.includes('sqlstate') ||
    /new row for relation/.test(lower) ||
    /column .* does not exist/.test(lower)
  ) {
    return 'Could not save this course. Please try again.';
  }
  return msg;
}
