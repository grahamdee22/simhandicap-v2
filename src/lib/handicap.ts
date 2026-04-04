/**
 * SimHandicap differential math (WHS-style + difficulty modifiers).
 * @see SimHandicap_Scope.docx
 */

export type PuttingMode = 'auto_2putt' | 'gimme_5' | 'putt_all';
export type PinDay = 'thu' | 'fri' | 'sat' | 'sun';
export type Wind = 'off' | 'light' | 'strong';
export type Mulligans = 'on' | 'off';

const PUTTING: Record<PuttingMode, number> = {
  auto_2putt: 0.62,
  gimme_5: 0.82,
  putt_all: 1.0,
};

const PIN: Record<PinDay, number> = {
  thu: 0.9,
  fri: 0.92,
  sat: 0.97,
  sun: 1.0,
};

const WIND: Record<Wind, number> = {
  off: 0.92,
  light: 0.96,
  strong: 1.0,
};

const MULLIGANS: Record<Mulligans, number> = {
  on: 0.88,
  off: 1.0,
};

export function difficultyProduct(
  putting: PuttingMode,
  pin: PinDay,
  wind: Wind,
  mulligans: Mulligans
): number {
  return PUTTING[putting] * PIN[pin] * WIND[wind] * MULLIGANS[mulligans];
}

export function rawDifferential(ags: number, courseRating: number, slope: number): number {
  if (slope <= 0) return 0;
  return ((ags - courseRating) * 113) / slope;
}

export function adjustedDifferential(
  ags: number,
  courseRating: number,
  slope: number,
  putting: PuttingMode,
  pin: PinDay,
  wind: Wind,
  mulligans: Mulligans
): { raw: number; adjusted: number; modifier: number } {
  const modifier = difficultyProduct(putting, pin, wind, mulligans);
  const raw = rawDifferential(ags, courseRating, slope);
  return {
    raw: round1(raw),
    adjusted: round1(raw * modifier),
    modifier: round2(modifier),
  };
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
