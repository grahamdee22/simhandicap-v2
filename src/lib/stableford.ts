/**
 * Stableford side game — standard R&A/USGA point table vs par.
 */

/** Points for net score relative to hole par (net − par). */
export function stablefordPointsForNetVsPar(netToPar: number): number {
  if (!Number.isFinite(netToPar)) return 0;
  if (netToPar <= -3) return 5; // albatross or better
  if (netToPar === -2) return 4; // eagle
  if (netToPar === -1) return 3; // birdie
  if (netToPar === 0) return 2; // par
  if (netToPar === 1) return 1; // bogey
  return 0; // double bogey or worse
}

export function stablefordPointsForHole(net: number, par: number): number {
  if (!Number.isFinite(net) || !Number.isFinite(par)) return 0;
  return stablefordPointsForNetVsPar(net - par);
}

export type StablefordParticipant = {
  id: string;
  /** Net per scorecard hole. null = missing. */
  nets: (number | null)[];
};

export type StablefordHolePoints = {
  holeNumber: number;
  /** Points per participant id; omitted when that player lacked a net. */
  pointsById: Record<string, number>;
  /** True when every participant had a net for this hole. */
  complete: boolean;
};

export type StablefordResult = {
  holes: StablefordHolePoints[];
  totals: Record<string, number>;
};

/**
 * Running Stableford totals. Points are credited per hole as soon as that
 * participant has a net (partial-friendly for display), but `complete` flags
 * whether the whole field has posted for the hole (Skins-style gating for UI).
 */
export function computeStableford(
  participants: StablefordParticipant[],
  pars: number[],
  holeCount: number
): StablefordResult {
  const totals: Record<string, number> = {};
  for (const p of participants) totals[p.id] = 0;

  const holes: StablefordHolePoints[] = [];
  for (let i = 0; i < holeCount; i += 1) {
    const par = pars[i] ?? 4;
    const pointsById: Record<string, number> = {};
    let complete = participants.length > 0;
    for (const p of participants) {
      const net = p.nets[i];
      if (net == null || !Number.isFinite(net)) {
        complete = false;
        continue;
      }
      const pts = stablefordPointsForHole(net, par);
      pointsById[p.id] = pts;
      totals[p.id] = (totals[p.id] ?? 0) + pts;
    }
    holes.push({ holeNumber: i + 1, pointsById, complete });
  }

  return { holes, totals };
}

export function stablefordLeaderboard(
  result: StablefordResult,
  displayName: (id: string) => string
): { id: string; name: string; points: number }[] {
  return Object.entries(result.totals)
    .map(([id, points]) => ({ id, name: displayName(id), points }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}
