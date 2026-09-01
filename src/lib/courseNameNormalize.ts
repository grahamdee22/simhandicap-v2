/** Normalize course names for dedupe and search (accent-insensitive, collapsed whitespace). */
export function normalizeCourseName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
