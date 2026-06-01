/**
 * Single-elimination bracket layout (Match Play). Pure logic for tests + SQL parity.
 */

export const MATCH_PLAY_MIN_PLAYERS = 2;
export const MATCH_PLAY_MAX_PLAYERS = 30;

export const MATCH_PLAY_ODD_PLAYERS_ERROR =
  'Match Play requires an even number of players. Add or remove a player to enable this format.';

export const MATCH_PLAY_TOO_MANY_PLAYERS_ERROR = 'Match Play supports up to 30 players.';

export type BracketR1Slot =
  | { slot: number; kind: 'match'; seed1: number; seed2: number }
  | { slot: number; kind: 'bye'; seed: number };

/** Next power of 2 >= player count (min 2). */
export function bracketSizeForPlayers(playerCount: number): number {
  if (playerCount <= 2) return 2;
  let size = 2;
  while (size < playerCount) size *= 2;
  return size;
}

export function totalBracketRounds(bracketSize: number): number {
  if (bracketSize <= 2) return 1;
  let rounds = 0;
  let n = bracketSize;
  while (n > 1) {
    rounds += 1;
    n /= 2;
  }
  return rounds;
}

/** Standard seed order for first-round bracket positions (length = bracketSize). */
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

export function bracketR1Slots(playerCount: number): BracketR1Slot[] {
  const bracketSize = bracketSizeForPlayers(playerCount);
  const order = bracketSeedOrder(bracketSize);
  const slots: BracketR1Slot[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const slot = i / 2;
    const seed1 = order[i]!;
    const seed2 = order[i + 1]!;
    if (seed1 <= playerCount && seed2 <= playerCount) {
      slots.push({ slot, kind: 'match', seed1, seed2 });
    } else if (seed1 <= playerCount) {
      slots.push({ slot, kind: 'bye', seed: seed1 });
    } else if (seed2 <= playerCount) {
      slots.push({ slot, kind: 'bye', seed: seed2 });
    }
  }
  return slots;
}

export function slotsInBracketRound(bracketSize: number, roundIndex: number): number {
  const total = totalBracketRounds(bracketSize);
  if (roundIndex < 0 || roundIndex >= total) return 0;
  return bracketSize / 2 ** (roundIndex + 1);
}

export function bracketRoundId(roundIndex: number, totalRounds: number): string {
  if (roundIndex >= totalRounds - 1) return 'final';
  return `r${roundIndex + 1}`;
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
