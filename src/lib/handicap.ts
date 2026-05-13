/**
 * SimHandicap differential math (WHS-style + difficulty modifiers).
 * @see SimHandicap_Scope.docx
 */

export type PuttingMode = 'auto_2putt' | 'gimme_5' | 'putt_all';
export type PinDay = 'thu' | 'fri' | 'sat' | 'sun';
export type Wind = 'off' | 'light' | 'strong';
export type Mulligans = 'on' | 'off';

/**
 * Version marker stored with each logged round so future formula changes only affect new rounds.
 * Historical rounds keep the differential version they were logged with.
 */
export const CURRENT_DIFFERENTIAL_VERSION = 1;

/** Putting multipliers (higher → higher adjusted diff for same gross). Order: putt_all < gimme < auto_2putt. */
const PUTTING: Record<PuttingMode, number> = {
  putt_all: 1.0,
  auto_2putt: 1.15,
  gimme_5: 1.05,
};

/** Putting slice of `difficultyProduct` (single source of truth for UI breakdowns). */
export function puttingDifficultyMultiplier(mode: PuttingMode): number {
  return PUTTING[mode];
}

/**
 * Pin placement: easier Thu pins → higher multiplier (penalize); hardest Sun → lowest (most credit).
 */
const PIN: Record<PinDay, number> = {
  thu: 1.12,
  fri: 1.08,
  sat: 1.04,
  sun: 1.0,
};

/** Pin slice of `difficultyProduct` (single source of truth for UI breakdowns). */
export function pinDifficultyMultiplier(day: PinDay): number {
  return PIN[day];
}

/**
 * Wind: off (easiest) → higher multiplier; strong (hardest) → lowest (most credit).
 */
const WIND: Record<Wind, number> = {
  off: 1.1,
  light: 1.05,
  strong: 1.0,
};

/** Wind slice of `difficultyProduct` (single source of truth for UI breakdowns). */
export function windDifficultyMultiplier(mode: Wind): number {
  return WIND[mode];
}

const MULLIGANS: Record<Mulligans, number> = {
  on: 1.15,
  off: 1.0,
};

/**
 * Universal sim baseline (~12% discount): flat lies, no sand, ideal turf — not modeled as inputs.
 * Applied after putting × pin × wind × mulligans, before the floor clamp. Tune when real-world data lands.
 */
export const SIM_BASELINE = 0.88;

const MIN_DIFFICULTY_MODIFIER = 0.5;

export function difficultyProduct(
  putting: PuttingMode,
  pin: PinDay,
  wind: Wind,
  mulligans: Mulligans
): number {
  const conditioned = PUTTING[putting] * PIN[pin] * WIND[wind] * MULLIGANS[mulligans];
  const product = conditioned * SIM_BASELINE;
  return Math.max(MIN_DIFFICULTY_MODIFIER, product);
}

export function rawDifferential(ags: number, courseRating: number, slope: number): number {
  if (slope <= 0) return 0;
  return ((ags - courseRating) * 113) / slope;
}

/** `courseRating` / `slope` are the WHS values for the tee played (from course data or custom entry). */
export function adjustedDifferentialForVersion(
  version: number,
  ags: number,
  courseRating: number,
  slope: number,
  putting: PuttingMode,
  pin: PinDay,
  wind: Wind,
  mulligans: Mulligans
): { raw: number; adjusted: number; modifier: number } {
  switch (version) {
    case 1:
    default: {
      const modifier = difficultyProduct(putting, pin, wind, mulligans);
      const raw = rawDifferential(ags, courseRating, slope);
      return {
        raw: round1(raw),
        adjusted: round1(raw * modifier),
        modifier: round2(modifier),
      };
    }
  }
}

/** Uses the latest differential algorithm for new rounds and previews. */
export function adjustedDifferential(
  ags: number,
  courseRating: number,
  slope: number,
  putting: PuttingMode,
  pin: PinDay,
  wind: Wind,
  mulligans: Mulligans
): { raw: number; adjusted: number; modifier: number } {
  return adjustedDifferentialForVersion(
    CURRENT_DIFFERENTIAL_VERSION,
    ags,
    courseRating,
    slope,
    putting,
    pin,
    wind,
    mulligans
  );
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Lower differential is better. Uses last up to 20 scores; best 8 average × 0.96. */
export function handicapIndexFromDifferentials(adjusted: number[]): number | null {
  if (adjusted.length === 0) return null;
  const window = adjusted.slice(-20);
  const sorted = [...window].sort((a, b) => a - b);
  const k = Math.min(8, sorted.length);
  const best = sorted.slice(0, k);
  const avg = best.reduce((s, x) => s + x, 0) / best.length;
  return round1(avg * 0.96);
}

/** Chronological rounds with adjusted differentials → index after each round. */
export function indexHistoryFromRounds(
  rounds: { playedAt: string; adjustedDiff: number }[]
): { date: string; index: number }[] {
  const sorted = [...rounds].sort(
    (a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime()
  );
  const out: { date: string; index: number }[] = [];
  const diffs: number[] = [];
  for (const r of sorted) {
    diffs.push(r.adjustedDiff);
    const idx = handicapIndexFromDifferentials(diffs);
    if (idx != null) out.push({ date: r.playedAt, index: idx });
  }
  return out;
}

export function grossFromHoles(holes: (number | null)[]): number | null {
  if (holes.length !== 18) return null;
  if (holes.some((h) => h == null || Number.isNaN(h))) return null;
  return holes.reduce<number>((s, h) => s + (h as number), 0);
}

export function scoreToParStyle(
  score: number,
  par: number
): 'eagle_plus' | 'birdie' | 'par' | 'bogey' | 'double_plus' {
  const d = score - par;
  if (d <= -2) return 'eagle_plus';
  if (d === -1) return 'birdie';
  if (d === 0) return 'par';
  if (d === 1) return 'bogey';
  return 'double_plus';
}

/** WHS-style label: plain "4.3" for typical index; "+2.1" only when value is below scratch (stored negative). */
export function formatHandicapIndexDisplay(i: number | null | undefined): string {
  if (i == null || Number.isNaN(i) || !Number.isFinite(i)) return '—';
  if (i < 0) return `+${Math.abs(i).toFixed(1)}`;
  return i.toFixed(1);
}

/** Differential display: show "+" for values stored negative (e.g. -10.9 -> +10.9). */
export function formatDifferentialDisplay(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v) || !Number.isFinite(v)) return '—';
  if (v < 0) return `+${Math.abs(v).toFixed(1)}`;
  return v.toFixed(1);
}
