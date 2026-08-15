/**
 * Pure helpers for Practice Analyzer Claude responses.
 * Kept free of React Native / Supabase imports so unit tests can run under tsx.
 */

export type PracticeStatValue = {
  label: string;
  value: string;
  unit?: string | null;
};

export type PracticeShotRow = {
  shot?: string | null;
  club?: string | null;
  stats: PracticeStatValue[];
};

export type PracticeExtractedStats = {
  summary: PracticeStatValue[];
  shots: PracticeShotRow[];
  raw?: unknown;
};

export type NormalizedPracticeAnalysis = {
  detectedSystem: string | null;
  sessionNotes: string | null;
  extractedStats: PracticeExtractedStats;
  takeaways: string[];
  tips: string[];
};

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function asStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = asTrimmedString(item);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function formatLooseValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

function normalizeStat(raw: unknown): PracticeStatValue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const label =
    asTrimmedString(o.label) ??
    asTrimmedString(o.name) ??
    asTrimmedString(o.key) ??
    asTrimmedString(o.metric);
  const value =
    formatLooseValue(o.value) ??
    formatLooseValue(o.val) ??
    formatLooseValue(o.reading) ??
    formatLooseValue(o.amount);
  if (!label || value == null) return null;
  const unit = asTrimmedString(o.unit) ?? asTrimmedString(o.units);
  return { label, value, unit: unit ?? null };
}

function normalizeStatList(raw: unknown, max: number): PracticeStatValue[] {
  if (!Array.isArray(raw)) return [];
  const out: PracticeStatValue[] = [];
  for (const item of raw) {
    const s = normalizeStat(item);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeShot(raw: unknown): PracticeShotRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const statsSource = o.stats ?? o.metrics ?? o.values;
  let stats = normalizeStatList(statsSource, 24);

  // Flat shot objects like { club, ball_speed, carry } → promote unknown keys to stats.
  if (stats.length === 0) {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'shot' || k === 'club' || k === 'label' || k === 'name' || k === 'index') continue;
      const value = formatLooseValue(v);
      if (value == null) continue;
      stats.push({ label: k.replace(/_/g, ' '), value, unit: null });
      if (stats.length >= 24) break;
    }
  }

  if (stats.length === 0) return null;
  return {
    shot: asTrimmedString(o.shot) ?? asTrimmedString(o.label) ?? asTrimmedString(o.name),
    club: asTrimmedString(o.club),
    stats,
  };
}

function normalizeShots(raw: unknown, max: number): PracticeShotRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PracticeShotRow[] = [];
  for (const item of raw) {
    const s = normalizeShot(item);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Tolerant normalizer for Claude JSON. Accepts partial / oddly shaped payloads
 * from unknown simulator layouts without inventing numeric values.
 */
export function normalizePracticeAnalysisPayload(raw: unknown): NormalizedPracticeAnalysis {
  const empty: NormalizedPracticeAnalysis = {
    detectedSystem: null,
    sessionNotes: null,
    extractedStats: { summary: [], shots: [] },
    takeaways: [],
    tips: [],
  };
  if (raw == null) return empty;

  let obj: Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty;
      obj = parsed as Record<string, unknown>;
    } catch {
      return empty;
    }
  } else if (typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  } else {
    return empty;
  }

  const statsRoot =
    (obj.extracted_stats && typeof obj.extracted_stats === 'object'
      ? (obj.extracted_stats as Record<string, unknown>)
      : null) ??
    (obj.stats && typeof obj.stats === 'object' ? (obj.stats as Record<string, unknown>) : null) ??
    obj;

  const summary = normalizeStatList(
    statsRoot.summary ?? statsRoot.summary_stats ?? statsRoot.averages ?? statsRoot.session_stats,
    40
  );
  const shots = normalizeShots(statsRoot.shots ?? statsRoot.shot_list ?? statsRoot.per_shot, 60);

  // If the model returned a flat list of stats at the top level, treat as summary.
  const topLevelStats = normalizeStatList(obj.stats, 40);
  const mergedSummary = summary.length > 0 ? summary : topLevelStats;

  return {
    detectedSystem:
      asTrimmedString(obj.detected_system) ??
      asTrimmedString(obj.system) ??
      asTrimmedString(obj.simulator) ??
      asTrimmedString(obj.platform),
    sessionNotes:
      asTrimmedString(obj.session_notes) ??
      asTrimmedString(obj.sessionNotes) ??
      asTrimmedString(obj.notes) ??
      asTrimmedString(obj.club_context),
    extractedStats: {
      summary: mergedSummary,
      shots,
      raw: obj.extracted_stats ?? obj.stats ?? undefined,
    },
    takeaways: asStringArray(obj.takeaways ?? obj.insights ?? obj.patterns, 6),
    tips: asStringArray(obj.tips ?? obj.recommendations ?? obj.next_session_tips, 5),
  };
}

/** Extract first JSON object from a model text blob (markdown fences / preamble). */
export function parsePracticeAnalysisJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

export function formatPracticeStatDisplay(stat: PracticeStatValue): string {
  if (stat.unit && !stat.value.includes(stat.unit)) {
    return `${stat.value} ${stat.unit}`;
  }
  return stat.value;
}
