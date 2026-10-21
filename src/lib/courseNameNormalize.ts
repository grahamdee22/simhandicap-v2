/** Normalize course names for dedupe and search (accent-insensitive, collapsed whitespace). */
export function normalizeCourseName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const GOLF_SUFFIX_RE =
  /\b(golf\s+(club|course|links|resort|and\s+country\s+club|&\s+country\s+club)|country\s+club|g\.?c\.?)\b\.?/gi;

/** Strip common golf-course suffixes for fuzzier matching (e.g. "Pebble Beach Golf Club" → "pebble beach"). */
export function stripGolfCourseSuffixes(s: string): string {
  return normalizeCourseName(s)
    .replace(GOLF_SUFFIX_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fuzzy course-name match: exact normalized, stripped-suffix exact, or substring either way.
 * Empty query matches everything.
 */
export function courseNameFuzzyMatch(name: string, rawQuery: string): boolean {
  const q = normalizeCourseName(rawQuery);
  if (!q) return true;
  const n = normalizeCourseName(name);
  if (n.includes(q) || q.includes(n)) return true;
  const qs = stripGolfCourseSuffixes(rawQuery);
  const ns = stripGolfCourseSuffixes(name);
  if (!qs || !ns) return false;
  return ns.includes(qs) || qs.includes(ns);
}

/** Rank for typeahead: lower is better. Exact normalized beat fuzzy. */
export function courseNameMatchRank(name: string, rawQuery: string): number {
  const q = normalizeCourseName(rawQuery);
  if (!q) return 50;
  const n = normalizeCourseName(name);
  if (n === q) return 0;
  const qs = stripGolfCourseSuffixes(rawQuery);
  const ns = stripGolfCourseSuffixes(name);
  if (qs && ns && ns === qs) return 1;
  if (n.startsWith(q) || (qs && ns.startsWith(qs))) return 2;
  if (n.includes(q) || (qs && ns.includes(qs))) return 3;
  if (q.includes(n) || (qs && qs.includes(ns))) return 4;
  return 99;
}
