/**
 * Skins side game — lowest net on the hole wins; ties carry to the next hole.
 * Fully recomputes from hole 1; never caches a "paid" state.
 */

export type SkinsParticipant = {
  id: string;
  /** Net (or gross-as-net) per scorecard hole index 0..holeCount-1. null = missing. */
  nets: (number | null)[];
};

export type SkinHoleAward = {
  holeNumber: number;
  /** Participant id, or null when unresolved / carried. */
  winnerId: string | null;
  /** Skins awarded this hole (1 + carry into the hole). 0 if unresolved or carried. */
  skinsWon: number;
  /** Carry entering this hole. */
  carryIn: number;
  /** True when all participants had a comparable net and there was a unique low. */
  awarded: boolean;
  /** True when all had nets but lowest was tied — pot carries forward. */
  carried: boolean;
  /** True when at least one participant lacked a net — hole skipped for skins. */
  pending: boolean;
};

export type SkinsResult = {
  holes: SkinHoleAward[];
  /** Total skins won per participant id. */
  totals: Record<string, number>;
  /** Skins still in the pot after the last resolved hole. */
  potRemaining: number;
};

/**
 * Process holes in order. Stops advancing the pot past the first incomplete hole
 * (later holes are marked pending even if some nets exist).
 */
export function computeSkins(
  participants: SkinsParticipant[],
  holeCount: number
): SkinsResult {
  const totals: Record<string, number> = {};
  for (const p of participants) totals[p.id] = 0;

  if (participants.length < 2 || holeCount <= 0) {
    return {
      holes: Array.from({ length: Math.max(0, holeCount) }, (_, i) => ({
        holeNumber: i + 1,
        winnerId: null,
        skinsWon: 0,
        carryIn: 0,
        awarded: false,
        carried: false,
        pending: true,
      })),
      totals,
      potRemaining: 0,
    };
  }

  const holes: SkinHoleAward[] = [];
  let carry = 0;
  let blocked = false;

  for (let i = 0; i < holeCount; i += 1) {
    const holeNumber = i + 1;
    const carryIn = carry;

    if (blocked) {
      holes.push({
        holeNumber,
        winnerId: null,
        skinsWon: 0,
        carryIn,
        awarded: false,
        carried: false,
        pending: true,
      });
      continue;
    }

    const nets: { id: string; net: number }[] = [];
    let missing = false;
    for (const p of participants) {
      const n = p.nets[i];
      if (n == null || !Number.isFinite(n)) {
        missing = true;
        break;
      }
      nets.push({ id: p.id, net: n });
    }

    if (missing) {
      blocked = true;
      holes.push({
        holeNumber,
        winnerId: null,
        skinsWon: 0,
        carryIn,
        awarded: false,
        carried: false,
        pending: true,
      });
      continue;
    }

    let low = nets[0].net;
    for (const row of nets) {
      if (row.net < low) low = row.net;
    }
    const winners = nets.filter((r) => r.net === low);
    if (winners.length === 1) {
      const winnerId = winners[0].id;
      const skinsWon = 1 + carry;
      totals[winnerId] = (totals[winnerId] ?? 0) + skinsWon;
      carry = 0;
      holes.push({
        holeNumber,
        winnerId,
        skinsWon,
        carryIn,
        awarded: true,
        carried: false,
        pending: false,
      });
    } else {
      carry = carryIn + 1;
      holes.push({
        holeNumber,
        winnerId: null,
        skinsWon: 0,
        carryIn,
        awarded: false,
        carried: true,
        pending: false,
      });
    }
  }

  return { holes, totals, potRemaining: carry };
}

export function skinsLeaderboard(
  result: SkinsResult,
  displayName: (id: string) => string
): { id: string; name: string; skins: number }[] {
  return Object.entries(result.totals)
    .map(([id, skins]) => ({ id, name: displayName(id), skins }))
    .sort((a, b) => b.skins - a.skins || a.name.localeCompare(b.name));
}
