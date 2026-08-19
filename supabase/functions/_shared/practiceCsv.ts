/**
 * COPY of src/lib/practiceCsv.ts for Edge Functions.
 * Keep in sync when changing parse rules. Deno imports this file; tests import src/.
 *
 * More platforms should register in PLATFORM_PARSERS rather than rewriting this file.
 */

export const MIN_SHOTS_FOR_TAKEAWAY = 3;
/** If this fraction of session rows are exactly 0 (or null), drop the whole column. */
export const MOSTLY_ZERO_EXCLUDE_FRACTION = 0.9;
export const PRACTICE_CSV_SCHEMA = 'practice_csv_v1' as const;

/**
 * GSPro lateral signs, golfer's view looking at the target.
 * HLA: official Data Tiles + Users Guide — negative = left, positive = right.
 * Offline: not signed in those docs; real exports put HLA and Offline on the same
 * axis (low-curve shots share sign), so negative = left of aim, positive = right.
 */
export const GSPRO_LATERAL_SIGN = {
  negative: 'left of target',
  positive: 'right of target',
  fields: ['hla', 'offline'] as const,
} as const;

export type PracticePlatformId = 'gspro';

export type PracticeShotMetrics = {
  club: string;
  carry: number | null;
  total_distance: number | null;
  ball_speed: number | null;
  back_spin: number | null;
  side_spin: number | null;
  hla: number | null;
  vla: number | null;
  descent: number | null;
  peak_height: number | null;
  offline: number | null;
  club_speed: number | null;
  path: number | null;
  aoa: number | null;
  face_to_target: number | null;
  face_to_path: number | null;
  lie: number | null;
  loft: number | null;
  dynamic_loft: number | null;
  cr: number | null;
  hi: number | null;
  vi: number | null;
  smash_factor: number | null;
};

export type MetricStats = {
  mean: number;
  stdev: number;
  min: number;
  max: number;
  n: number;
  unit: string | null;
};

export type ClubSummary = {
  club: string;
  club_label: string;
  shot_count: number;
  qualifies_for_takeaway: boolean;
  metrics: Record<string, MetricStats>;
  takeaway: string | null;
};

export type ParsedPracticeSession = {
  schema: typeof PRACTICE_CSV_SCHEMA;
  platform: PracticePlatformId;
  platform_label: string;
  original_filename: string;
  session_played_at: string | null;
  excluded_columns: string[];
  shots: PracticeShotMetrics[];
  clubs: ClubSummary[];
};

export type ParsePracticeCsvResult =
  | { ok: true; session: ParsedPracticeSession }
  | { ok: false; error: string };

type PlatformParser = {
  id: PracticePlatformId;
  label: string;
  match: (headers: string[]) => boolean;
  parse: (rows: Record<string, string>[], filename: string) => ParsePracticeCsvResult;
};

const GSPRO_REQUIRED_HEADERS = ['Carry', 'Club'] as const;

const GSPRO_IGNORED_COLUMNS = new Set(['DistanceToPin', 'rawCarryGame', 'rawCarryLM', 'rawSpinAxis']);

const CLUB_LABELS: Record<string, string> = {
  DR: 'Driver',
  '1W': 'Driver',
  '3W': '3-Wood',
  '4W': '4-Wood',
  '5W': '5-Wood',
  '7W': '7-Wood',
  '2H': '2-Hybrid',
  '3H': '3-Hybrid',
  '4H': '4-Hybrid',
  '5H': '5-Hybrid',
  '6H': '6-Hybrid',
  '1I': '1-Iron',
  '2I': '2-Iron',
  '3I': '3-Iron',
  '4I': '4-Iron',
  '5I': '5-Iron',
  '6I': '6-Iron',
  '7I': '7-Iron',
  '8I': '8-Iron',
  '9I': '9-Iron',
  PW: 'Pitching Wedge',
  GW: 'Gap Wedge',
  SW: 'Sand Wedge',
  LW: 'Lob Wedge',
  PT: 'Putter',
};

const CLUB_SORT_ORDER = [
  'DR',
  '1W',
  '3W',
  '4W',
  '5W',
  '7W',
  '2H',
  '3H',
  '4H',
  '5H',
  '6H',
  '1I',
  '2I',
  '3I',
  '4I',
  '5I',
  '6I',
  '7I',
  '8I',
  '9I',
  'PW',
  'GW',
  'SW',
  'LW',
  'PT',
];

type MetricKey = Exclude<keyof PracticeShotMetrics, 'club'>;

const METRIC_META: Record<MetricKey, { label: string; unit: string | null; header?: string }> = {
  carry: { label: 'Carry', unit: 'yd', header: 'Carry' },
  total_distance: { label: 'Total', unit: 'yd', header: 'TotalDistance' },
  ball_speed: { label: 'Ball speed', unit: 'mph', header: 'BallSpeed' },
  back_spin: { label: 'Back spin', unit: 'rpm', header: 'BackSpin' },
  side_spin: { label: 'Side spin', unit: 'rpm', header: 'SideSpin' },
  hla: { label: 'HLA', unit: 'deg', header: 'HLA' },
  vla: { label: 'Launch', unit: 'deg', header: 'VLA' },
  descent: { label: 'Descent', unit: 'deg', header: 'Decent' },
  peak_height: { label: 'Peak height', unit: 'ft', header: 'PeakHeight' },
  offline: { label: 'Offline', unit: 'yd', header: 'Offline' },
  club_speed: { label: 'Club speed', unit: 'mph', header: 'ClubSpeed' },
  path: { label: 'Path', unit: 'deg', header: 'Path' },
  aoa: { label: 'AoA', unit: 'deg', header: 'AoA' },
  face_to_target: { label: 'Face to target', unit: 'deg', header: 'FaceToTarget' },
  face_to_path: { label: 'Face to path', unit: 'deg', header: 'FaceToPath' },
  lie: { label: 'Lie', unit: 'deg', header: 'Lie' },
  loft: { label: 'Loft', unit: 'deg', header: 'Loft' },
  dynamic_loft: { label: 'Dynamic loft', unit: 'deg', header: 'DynamicLoft' },
  cr: { label: 'CR', unit: null, header: 'CR' },
  hi: { label: 'HI', unit: null, header: 'HI' },
  vi: { label: 'VI', unit: null, header: 'VI' },
  smash_factor: { label: 'Smash', unit: null, header: 'SmashFactor' },
};

const DISPLAY_METRIC_ORDER: MetricKey[] = [
  'carry',
  'total_distance',
  'offline',
  'ball_speed',
  'club_speed',
  'smash_factor',
  'hla',
  'vla',
  'descent',
  'peak_height',
  'back_spin',
  'side_spin',
  'path',
  'aoa',
  'face_to_target',
  'face_to_path',
  'lie',
  'loft',
  'dynamic_loft',
  'cr',
  'hi',
  'vi',
];

export function clubLabel(code: string): string {
  const key = code.trim().toUpperCase();
  return CLUB_LABELS[key] ?? code.trim();
}

export function metricLabel(key: string): string {
  return METRIC_META[key as MetricKey]?.label ?? key;
}

export function metricUnit(key: string): string | null {
  return METRIC_META[key as MetricKey]?.unit ?? null;
}

/** GSPro filenames look like gspro-export08-16-26-14-43-17.csv (MM-DD-YY-HH-MM-SS). */
export function parseGsProExportFilename(filename: string): string | null {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? filename;
  const match = base.match(/(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const yearTwo = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const year = yearTwo >= 80 ? 1900 + yearTwo : 2000 + yearTwo;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const mi = String(minute).padStart(2, '0');
  const ss = String(second).padStart(2, '0');
  return `${year}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

export function parseCsvText(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

function headerIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    const key = h.trim();
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function roundStat(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function sampleStdev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function metricStats(values: number[], unit: string | null): MetricStats | null {
  if (values.length === 0) return null;
  return {
    mean: roundStat(mean(values)),
    stdev: roundStat(sampleStdev(values)),
    min: roundStat(Math.min(...values)),
    max: roundStat(Math.max(...values)),
    n: values.length,
    unit,
  };
}

function isMostlyUnmeasured(values: Array<number | null>): boolean {
  if (values.length === 0) return true;
  const zeroLike = values.filter((v) => v == null || v === 0).length;
  return zeroLike / values.length >= MOSTLY_ZERO_EXCLUDE_FRACTION;
}

function clubSortIndex(code: string): number {
  const i = CLUB_SORT_ORDER.indexOf(code.toUpperCase());
  return i >= 0 ? i : CLUB_SORT_ORDER.length;
}

function buildClubSummaries(shots: PracticeShotMetrics[], excluded: Set<string>): ClubSummary[] {
  const byClub = new Map<string, PracticeShotMetrics[]>();
  for (const shot of shots) {
    const key = shot.club.trim() || 'Unknown';
    const list = byClub.get(key) ?? [];
    list.push(shot);
    byClub.set(key, list);
  }

  const clubs: ClubSummary[] = [];
  for (const [club, clubShots] of byClub) {
    const metrics: Record<string, MetricStats> = {};
    for (const key of DISPLAY_METRIC_ORDER) {
      const header = METRIC_META[key].header;
      if (header && excluded.has(header)) continue;
      const values = clubShots
        .map((s) => s[key])
        .filter((v): v is number => v != null && Number.isFinite(v));
      const stats = metricStats(values, METRIC_META[key].unit);
      if (stats) metrics[key] = stats;
    }
    clubs.push({
      club,
      club_label: clubLabel(club),
      shot_count: clubShots.length,
      qualifies_for_takeaway: clubShots.length >= MIN_SHOTS_FOR_TAKEAWAY,
      metrics,
      takeaway: null,
    });
  }

  clubs.sort((a, b) => {
    const d = clubSortIndex(a.club) - clubSortIndex(b.club);
    if (d !== 0) return d;
    return a.club.localeCompare(b.club);
  });
  return clubs;
}

function parseGsProRows(rows: Record<string, string>[], filename: string): ParsePracticeCsvResult {
  if (rows.length === 0) {
    return { ok: false, error: 'That CSV has a header but no shot rows.' };
  }

  const shots: PracticeShotMetrics[] = [];
  for (const row of rows) {
    const club = (row.Club ?? '').trim();
    if (!club) continue;
    shots.push({
      club,
      carry: parseNumber(row.Carry),
      total_distance: parseNumber(row.TotalDistance),
      ball_speed: parseNumber(row.BallSpeed),
      back_spin: parseNumber(row.BackSpin),
      side_spin: parseNumber(row.SideSpin),
      hla: parseNumber(row.HLA),
      vla: parseNumber(row.VLA),
      descent: parseNumber(row.Decent),
      peak_height: parseNumber(row.PeakHeight),
      offline: parseNumber(row.Offline),
      club_speed: parseNumber(row.ClubSpeed),
      path: parseNumber(row.Path),
      aoa: parseNumber(row.AoA),
      face_to_target: parseNumber(row.FaceToTarget),
      face_to_path: parseNumber(row.FaceToPath),
      lie: parseNumber(row.Lie),
      loft: parseNumber(row.Loft),
      dynamic_loft: parseNumber(row.DynamicLoft),
      cr: parseNumber(row.CR),
      hi: parseNumber(row.HI),
      vi: parseNumber(row.VI),
      smash_factor: parseNumber(row.SmashFactor),
    });
  }

  if (shots.length === 0) {
    return { ok: false, error: 'No shots with a club were found in that CSV.' };
  }

  const excludedColumns: string[] = ['DistanceToPin'];
  for (const key of DISPLAY_METRIC_ORDER) {
    const header = METRIC_META[key].header;
    if (!header || excludedColumns.includes(header)) continue;
    if (!isMostlyUnmeasured(shots.map((s) => s[key]))) continue;
    excludedColumns.push(header);
    for (const shot of shots) shot[key] = null;
  }

  const excluded = new Set(excludedColumns);
  return {
    ok: true,
    session: {
      schema: PRACTICE_CSV_SCHEMA,
      platform: 'gspro',
      platform_label: 'GSPro',
      original_filename: filename,
      session_played_at: parseGsProExportFilename(filename),
      excluded_columns: excludedColumns,
      shots,
      clubs: buildClubSummaries(shots, excluded),
    },
  };
}

const gsproParser: PlatformParser = {
  id: 'gspro',
  label: 'GSPro',
  match: (headers) => GSPRO_REQUIRED_HEADERS.every((h) => headers.includes(h)),
  parse: parseGsProRows,
};

const PLATFORM_PARSERS: PlatformParser[] = [gsproParser];

export function parsePracticeCsv(csvText: string, filename: string): ParsePracticeCsvResult {
  const table = parseCsvText(csvText);
  if (table.length < 2) {
    return { ok: false, error: 'That file does not look like a practice CSV (need a header row and at least one shot).' };
  }
  const headers = table[0].map((h) => h.trim());
  if (headers.some((h) => h.length === 0) && headers.filter(Boolean).length < 3) {
    return { ok: false, error: 'That CSV header row is empty or unreadable.' };
  }

  const parser = PLATFORM_PARSERS.find((p) => p.match(headers));
  if (!parser) {
    return {
      ok: false,
      error:
        'This CSV is not a supported practice export yet. SimCap currently reads GSPro practice CSVs (Carry, Club, …).',
    };
  }

  const index = headerIndex(headers);
  const rows: Record<string, string>[] = [];
  for (const line of table.slice(1)) {
    const rec: Record<string, string> = {};
    for (const [name, i] of index) {
      rec[name] = line[i] ?? '';
    }
    rows.push(rec);
  }
  return parser.parse(rows, filename);
}

function formatNumber(n: number, digits: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}

export function formatMetricValue(stats: MetricStats, opts?: { withStdev?: boolean }): string {
  const digits = stats.unit == null && Math.abs(stats.mean) < 10 ? 2 : 1;
  const value = formatNumber(stats.mean, digits);
  const unit = stats.unit ? ` ${stats.unit}` : '';
  if (opts?.withStdev && stats.n >= 2) {
    const sd = formatNumber(stats.stdev, digits);
    return `${value}${unit} ± ${sd}`;
  }
  return `${value}${unit}`;
}

export function applyClubTakeaways(
  session: ParsedPracticeSession,
  takeaways: Array<{ club: string; takeaway: string }>
): ParsedPracticeSession {
  const byClub = new Map(takeaways.map((t) => [t.club.trim().toUpperCase(), t.takeaway.trim()]));
  return {
    ...session,
    clubs: session.clubs.map((club) => {
      if (!club.qualifies_for_takeaway) return { ...club, takeaway: null };
      const text = byClub.get(club.club.toUpperCase()) ?? null;
      return { ...club, takeaway: text && text.length > 0 ? text : null };
    }),
  };
}

/** Compact payload for the coaching LLM — averages, not every raw shot. */
export function coachingPayload(session: ParsedPracticeSession): Record<string, unknown> {
  return {
    platform: session.platform_label,
    session_played_at: session.session_played_at,
    shot_count: session.shots.length,
    excluded_columns: session.excluded_columns,
    excluded_columns_note:
      'These columns were 0 on 90%+ of shots (or ignored). Treat as not measured — including any leftover non-zero cells.',
    lateral_sign: {
      negative: GSPRO_LATERAL_SIGN.negative,
      positive: GSPRO_LATERAL_SIGN.positive,
      fields: [...GSPRO_LATERAL_SIGN.fields],
      note: 'Golfer facing the target. Do not reverse. Do not assign left/right to Path, FaceToTarget, or FaceToPath.',
    },
    clubs: session.clubs.map((club) => ({
      club: club.club,
      club_label: club.club_label,
      shot_count: club.shot_count,
      qualifies_for_takeaway: club.qualifies_for_takeaway,
      metrics: Object.fromEntries(
        Object.entries(club.metrics).map(([k, v]) => [
          k,
          { mean: v.mean, stdev: v.stdev, min: v.min, max: v.max, n: v.n, unit: v.unit },
        ])
      ),
    })),
  };
}

void GSPRO_IGNORED_COLUMNS;
