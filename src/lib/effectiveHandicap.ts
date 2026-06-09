/**
 * Tournament handicap resolution: SimCap index when established (3+ rounds), else GHIN.
 * Does not alter SimCap index math for established players — only adds GHIN fallback.
 */

import { handicapIndexFromDifferentials } from './handicap';
import type { SimRound } from '../store/useAppStore';

export const SIMCAP_INDEX_MIN_ROUNDS = 3;

export type EffectiveHandicapSource = 'simcap' | 'ghin';

export type EffectiveHandicap = {
  index: number | null;
  source: EffectiveHandicapSource | null;
};

export type EffectiveHandicapMember = {
  userId: string;
  index: number | null;
  handicapSource: EffectiveHandicapSource | null;
};

function roundsForSimcapIndex(rounds: SimRound[]): SimRound[] {
  return rounds.filter((r) => !r.excludesFromSimcapIndex);
}

function compareRoundsByPlayedAtAsc(a: SimRound, b: SimRound): number {
  const dt = new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime();
  if (dt !== 0) return dt;
  return a.id.localeCompare(b.id);
}

/** SimCap-generated index only when the player has enough counting rounds. */
export function simcapIndexWhenEstablished(rounds: SimRound[]): number | null {
  const counting = roundsForSimcapIndex(rounds);
  if (counting.length < SIMCAP_INDEX_MIN_ROUNDS) return null;
  const sorted = [...counting].sort(compareRoundsByPlayedAtAsc);
  return handicapIndexFromDifferentials(sorted.map((r) => r.adjustedDiff));
}

function normalizeGhinIndex(ghinIndex: number | null | undefined): number | null {
  if (ghinIndex == null || !Number.isFinite(Number(ghinIndex))) return null;
  const n = Number(ghinIndex);
  return n >= 0 ? n : null;
}

/** Resolve handicap for tournaments from rounds + profile GHIN. */
export function resolveEffectiveHandicap(params: {
  rounds: SimRound[];
  ghinIndex: number | null | undefined;
}): EffectiveHandicap {
  const simIdx = simcapIndexWhenEstablished(params.rounds);
  if (simIdx != null) {
    return { index: simIdx, source: 'simcap' };
  }

  const ghin = normalizeGhinIndex(params.ghinIndex);
  if (ghin != null) {
    return { index: ghin, source: 'ghin' };
  }

  return { index: null, source: null };
}

/** Lookup pre-resolved member handicap (from group roster). */
export function getEffectiveHandicap(
  userId: string,
  members: EffectiveHandicapMember[]
): EffectiveHandicap {
  const m = members.find((x) => x.userId === userId);
  if (!m) return { index: null, source: null };
  return { index: m.index, source: m.handicapSource };
}

export function countMembersMissingHandicap(
  members: Pick<EffectiveHandicapMember, 'index'>[]
): number {
  return members.filter((m) => m.index == null).length;
}
