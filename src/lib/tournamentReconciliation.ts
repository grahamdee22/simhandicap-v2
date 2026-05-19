/**
 * Gross vs hole-sum reconciliation (PRD §5.4) — pure helpers, no Supabase.
 */

export type HoleGrossInput = {
  gross_score?: number | null;
};

export type GrossReconciliation = {
  holeTotal: number | null;
  loggedGross: number;
  matches: boolean;
  delta: number | null;
};

export function sumGrossFromHoles(holes: HoleGrossInput[]): number | null {
  let sum = 0;
  let any = false;
  for (const h of holes) {
    if (h.gross_score == null || !Number.isFinite(h.gross_score)) continue;
    sum += h.gross_score;
    any = true;
  }
  return any ? sum : null;
}

/** PRD §5.4 — warn when hole sum ≠ logged gross; do not block. */
export function reconcileGrossWithHoles(
  holes: HoleGrossInput[],
  loggedGross: number
): GrossReconciliation {
  const holeTotal = sumGrossFromHoles(holes);
  if (holeTotal == null) {
    return { holeTotal: null, loggedGross, matches: true, delta: null };
  }
  const delta = holeTotal - loggedGross;
  return {
    holeTotal,
    loggedGross,
    matches: delta === 0,
    delta,
  };
}
