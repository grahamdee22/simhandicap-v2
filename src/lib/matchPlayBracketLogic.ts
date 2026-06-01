/**
 * Single-elimination bracket layout (Match Play). Pure logic for tests + SQL parity.
 *
 * Round 1 always pairs every player: seed s vs seed (n - s + 1) for s = 1..n/2.
 * Later rounds use outer-inner pairing when a round has an odd number of competitors;
 * the slot-0 path (top seed) receives the bye.
 */

export const MATCH_PLAY_MIN_PLAYERS = 2;
export const MATCH_PLAY_MAX_PLAYERS = 30;

export const MATCH_PLAY_ODD_PLAYERS_ERROR =
  'Match Play requires an even number of players. Add or remove a player to enable this format.';

export const MATCH_PLAY_TOO_MANY_PLAYERS_ERROR = 'Match Play supports up to 30 players.';

export type BracketR1Slot = {
  slot: number;
  kind: 'match';
  seed1: number;
  seed2: number;
};

export type BracketRoundPlan = {
  roundIndex: number;
  roundId: string;
  /** Pairings created this round (every player in a match, or winner-vs-winner). */
  matchCount: number;
  /** Competitors entering this round (including any bye holder at slot 0). */
  competitors: number;
};

/** @deprecated Power-of-2 bracket size; use bracketRoundPlan for layout. */
export function bracketSizeForPlayers(playerCount: number): number {
  if (playerCount <= 2) return 2;
  let size = 2;
  while (size < playerCount) size *= 2;
  return size;
}

/** Full round structure from player count through the final. */
export function bracketRoundPlan(playerCount: number): BracketRoundPlan[] {
  if (playerCount < 2) return [];
  const plans: BracketRoundPlan[] = [];
  let competitors = playerCount;
  let roundIndex = 0;
  while (competitors > 1) {
    const matchCount = Math.floor(competitors / 2);
    plans.push({
      roundIndex,
      roundId: '',
      matchCount,
      competitors,
    });
    competitors = matchCount + (competitors % 2 === 1 ? 1 : 0);
    roundIndex += 1;
  }
  const total = plans.length;
  for (let i = 0; i < plans.length; i++) {
    plans[i]!.roundId = roundIdForIndex(i, total);
  }
  return plans;
}

export function totalBracketRounds(playerCount: number): number {
  return bracketRoundPlan(playerCount).length;
}

export function roundIdForIndex(roundIndex: number, totalRounds: number): string {
  if (roundIndex >= totalRounds - 1) return 'final';
  return `r${roundIndex + 1}`;
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/** First-round matchups: all players play. Non-POT uses 1vN; POT uses bracket slot order for clean semis. */
export function bracketR1Slots(playerCount: number): BracketR1Slot[] {
  const matchCount = playerCount / 2;
  const slots: BracketR1Slot[] = [];

  if (isPowerOfTwo(playerCount)) {
    const order = bracketSeedOrder(playerCount);
    for (let i = 0; i < order.length; i += 2) {
      slots.push({
        slot: i / 2,
        kind: 'match',
        seed1: order[i]!,
        seed2: order[i + 1]!,
      });
    }
    return slots;
  }

  for (let slot = 0; slot < matchCount; slot++) {
    slots.push({
      slot,
      kind: 'match',
      seed1: slot + 1,
      seed2: playerCount - slot,
    });
  }
  return slots;
}

/** Pair prior-round winner slots into next-round matches (odd count → slot 0 bye). */
export function bracketAdvancePairings(winnerSlotCount: number): Array<[number, number]> {
  if (winnerSlotCount < 2) return [];
  if (winnerSlotCount % 2 === 0) {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < winnerSlotCount; i += 2) {
      pairs.push([i, i + 1]);
    }
    return pairs;
  }
  const pairs: Array<[number, number]> = [];
  const last = winnerSlotCount - 1;
  for (let i = 1; i <= last / 2; i++) {
    pairs.push([i, last - i + 1]);
  }
  return pairs;
}

export function bracketRoundHasBye(competitors: number): boolean {
  return competitors % 2 === 1;
}

export function slotsInBracketRound(playerCount: number, roundIndex: number): number {
  const plan = bracketRoundPlan(playerCount);
  return plan[roundIndex]?.matchCount ?? 0;
}

export function bracketRoundId(roundIndex: number, playerCount: number): string {
  const total = totalBracketRounds(playerCount);
  return roundIdForIndex(roundIndex, total);
}

export function parseBracketRoundId(round: string): number | null {
  if (round === 'final') return null;
  if (round === 'semifinal') return null;
  if (!/^r\d+$/.test(round)) return null;
  return Number(round.slice(1));
}

export function bracketRoundSortKey(round: string): number {
  if (round === 'final') return 10_000;
  if (round === 'semifinal') return 9_000;
  const n = parseBracketRoundId(round);
  return n ?? 0;
}

/** @deprecated Use bracketRoundPlan */
export function bracketSeedOrder(bracketSize: number): number[] {
  if (bracketSize < 2) return [];
  if (bracketSize === 2) return [1, 2];
  const half = bracketSeedOrder(bracketSize / 2);
  const result: number[] = [];
  for (const seed of half) {
    result.push(seed, bracketSize + 1 - seed);
  }
  return result;
}

export function isMatchPlayBracketEligible(playerCount: number): boolean {
  return (
    Number.isInteger(playerCount) &&
    playerCount >= MATCH_PLAY_MIN_PLAYERS &&
    playerCount <= MATCH_PLAY_MAX_PLAYERS &&
    playerCount % 2 === 0
  );
}

export function getMatchPlayFormatDisabledMessage(playerCount: number): string | null {
  if (playerCount > MATCH_PLAY_MAX_PLAYERS) return MATCH_PLAY_TOO_MANY_PLAYERS_ERROR;
  if (playerCount >= MATCH_PLAY_MIN_PLAYERS && playerCount % 2 !== 0) {
    return MATCH_PLAY_ODD_PLAYERS_ERROR;
  }
  if (playerCount < MATCH_PLAY_MIN_PLAYERS) {
    return `Requires at least ${MATCH_PLAY_MIN_PLAYERS} group members.`;
  }
  return null;
}
