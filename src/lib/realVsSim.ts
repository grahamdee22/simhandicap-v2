import type { SimRound } from '../store/useAppStore';

export type GhinSnapshot = {
  id: string;
  recordedAt: string;
  index: number;
};

export type GapTrend = 'closing' | 'widening' | 'steady';

export type ChartPoint = { nx: number; ny: number };

/** Latest GHIN index from snapshots (sorted ascending by date). */
export function latestGhinIndex(snapshots: GhinSnapshot[]): number | null {
  if (snapshots.length === 0) return null;
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );
  return sorted[sorted.length - 1].index;
}

function simIndexAtOrBefore(roundsAsc: SimRound[], tMs: number): number | null {
  let v: number | null = null;
  for (const r of roundsAsc) {
    if (new Date(r.playedAt).getTime() <= tMs && r.indexAfter != null) {
      v = r.indexAfter;
    }
  }
  return v;
}

function realIndexAtOrBefore(ghinAsc: GhinSnapshot[], tMs: number): number | null {
  let v: number | null = null;
  for (const g of ghinAsc) {
    if (new Date(g.recordedAt).getTime() <= tMs) {
      v = g.index;
    }
  }
  return v;
}

export function formatSimVsRealGapSentence(sim: number, real: number): string {
  const d = real - sim;
  const abs = Math.abs(d);
  if (abs < 0.05) {
    return 'Your sim index matches your GHIN right now.';
  }
  if (d > 0) {
    return `Your sim index is ${abs.toFixed(1)} stroke${abs === 1 ? '' : 's'} lower than your real handicap.`;
  }
  return `Your sim index is ${abs.toFixed(1)} stroke${abs === 1 ? '' : 's'} higher than your real handicap.`;
}

export function computeGapTrend(
  rounds: SimRound[],
  ghinSnapshots: GhinSnapshot[],
  nowMs: number = Date.now()
): GapTrend {
  const roundsAsc = [...rounds].sort(
    (a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime()
  );
  const ghinAsc = [...ghinSnapshots].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );
  const times = new Set<number>();
  for (const r of roundsAsc) times.add(new Date(r.playedAt).getTime());
  for (const g of ghinAsc) times.add(new Date(g.recordedAt).getTime());
  times.add(nowMs);
  const sorted = [...times].sort((a, b) => a - b);

  const both: { gap: number }[] = [];
  for (const t of sorted) {
    const sim = simIndexAtOrBefore(roundsAsc, t);
    const real = realIndexAtOrBefore(ghinAsc, t);
    if (sim != null && real != null) {
      both.push({ gap: Math.abs(sim - real) });
    }
  }
  if (both.length < 2) return 'steady';
  const g0 = both[0].gap;
  const g1 = both[both.length - 1].gap;
  if (g1 < g0 - 0.12) return 'closing';
  if (g1 > g0 + 0.12) return 'widening';
  return 'steady';
}

/**
 * Normalized chart points (nx, ny in 0–1). ny = 0 is top of plot (higher index drawn lower on screen).
 */
export function buildDualIndexChartPoints(
  rounds: SimRound[],
  ghinSnapshots: GhinSnapshot[],
  nowMs: number = Date.now()
): {
  simPts: ChartPoint[];
  realPts: ChartPoint[];
  yMin: number;
  yMax: number;
  tMin: number;
  tMax: number;
} | null {
  const roundsAsc = [...rounds].sort(
    (a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime()
  );
  const ghinAsc = [...ghinSnapshots].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );

  const times = new Set<number>();
  for (const r of roundsAsc) times.add(new Date(r.playedAt).getTime());
  for (const g of ghinAsc) times.add(new Date(g.recordedAt).getTime());
  times.add(nowMs);

  const sorted = [...times].sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  const simSeries: { t: number; v: number }[] = [];
  const realSeries: { t: number; v: number }[] = [];

  for (const t of sorted) {
    const sim = simIndexAtOrBefore(roundsAsc, t);
    const real = realIndexAtOrBefore(ghinAsc, t);
    if (sim != null) simSeries.push({ t, v: sim });
    if (real != null) realSeries.push({ t, v: real });
  }

  const values = [...simSeries.map((p) => p.v), ...realSeries.map((p) => p.v)];
  if (values.length === 0) return null;

  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  if (yMax - yMin < 0.5) {
    const mid = (yMin + yMax) / 2;
    yMin = mid - 0.35;
    yMax = mid + 0.35;
  } else {
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;
  }

  const tMin = sorted[0];
  const tMax = sorted[sorted.length - 1];
  const tSpan = Math.max(tMax - tMin, 1);

  const norm = (t: number, v: number): ChartPoint => ({
    nx: (t - tMin) / tSpan,
    ny: (yMax - v) / (yMax - yMin),
  });

  return {
    simPts: simSeries.map((p) => norm(p.t, p.v)),
    realPts: realSeries.map((p) => norm(p.t, p.v)),
    yMin,
    yMax,
    tMin,
    tMax,
  };
}
