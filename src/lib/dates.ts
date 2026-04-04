/** Local calendar day → stable ISO (noon local) for sorting & display. */
export function localYmdToIso(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return new Date().toISOString();
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return new Date().toISOString();
  return new Date(y, mo - 1, d, 12, 0, 0, 0).toISOString();
}

export function todayLocalYmd(): string {
  const t = new Date();
  const y = t.getFullYear();
  const mo = String(t.getMonth() + 1).padStart(2, '0');
  const da = String(t.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function isoToLocalYmd(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return todayLocalYmd();
  const y = t.getFullYear();
  const mo = String(t.getMonth() + 1).padStart(2, '0');
  const da = String(t.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function parseYmdParts(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** Clamp day to valid calendar day for y/m. */
export function clampYmdParts(y: number, m: number, d: number): { y: number; m: number; d: number } {
  const dim = daysInMonth(y, m);
  return { y, m, d: Math.min(Math.max(1, d), dim) };
}

export function ymdFromParts(y: number, m: number, d: number): string {
  const c = clampYmdParts(y, m, d);
  return `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

export function dateFromYmdLocal(ymd: string): Date {
  const p = parseYmdParts(ymd);
  if (!p) return new Date();
  return new Date(p.y, p.m - 1, p.d, 12, 0, 0, 0);
}
