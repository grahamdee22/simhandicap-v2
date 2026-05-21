/**
 * Single-elimination bracket view model (Match Play tournament).
 */

import {
  bracketHalvedAdvanceLine,
  bracketHalvedResultLine,
} from './matchPlayBracketCopy';
import { formatPairingResultLine, pairingPlayerNames } from './matchPlayPairingDisplay';
import type {
  BracketRound,
  DbLeagueMatchPairingRow,
  LeagueMatchPairingStatus,
} from './matchPlayPairingTypes';

/** Minimal entry fields for bracket UI (avoids pulling Supabase via leagues.ts in tests). */
export type BracketEntry = {
  id: string;
  user_id: string;
  bracket_seed?: number | null;
};

export const BRACKET_PLAYER_COUNTS = [2, 3, 4, 8] as const;
export type BracketPlayerCount = (typeof BRACKET_PLAYER_COUNTS)[number];

export const MATCH_PLAY_BRACKET_SIZE_ERROR =
  'Match Play bracket requires 2, 3, 4, or 8 players.';

export function isBracketPlayerCount(n: number): n is BracketPlayerCount {
  return BRACKET_PLAYER_COUNTS.includes(n as BracketPlayerCount);
}

export function bracketRoundLabel(round: BracketRound | null | undefined): string {
  switch (round) {
    case 'r1':
      return 'Round 1';
    case 'semifinal':
      return 'Semifinals';
    case 'final':
      return 'Final';
    default:
      return 'Bracket';
  }
}

export function pairingStatusLabel(status: LeagueMatchPairingStatus): string {
  switch (status) {
    case 'scheduled':
      return 'Scheduled';
    case 'in_progress':
      return 'In progress';
    case 'complete':
      return 'Complete';
    case 'halved':
      return 'Halved';
    default:
      return status;
  }
}

export type BracketPairingCard = {
  pairing: DbLeagueMatchPairingRow;
  name1: string;
  name2: string;
  seed1: number | null;
  seed2: number | null;
  statusLabel: string;
  resultLine: string | null;
  isMine: boolean;
};

export type BracketRoundSection = {
  round: BracketRound;
  label: string;
  pairings: BracketPairingCard[];
  isCurrent: boolean;
};

export type BracketViewModel = {
  currentRound: BracketRound | null;
  currentRoundLabel: string;
  sections: BracketRoundSection[];
  myPairingId: string | null;
  championEntryId: string | null;
  championName: string | null;
  byeSeed1Name: string | null;
  showBye: boolean;
};

const ROUND_ORDER: BracketRound[] = ['r1', 'semifinal', 'final'];

function entrySeed(entries: BracketEntry[], entryId: string): number | null {
  return entries.find((e) => e.id === entryId)?.bracket_seed ?? null;
}

function resultLineForPairing(
  pairing: DbLeagueMatchPairingRow,
  entries: BracketEntry[],
  displayNames: Record<string, string>,
  myEntryId: string | null
): string | null {
  if (pairing.status === 'scheduled') return null;
  const { name1, name2 } = pairingPlayerNames(pairing, entries, displayNames);
  if (pairing.status === 'complete' && pairing.winner_entry_id) {
    const winner =
      pairing.winner_entry_id === pairing.player_1_entry_id ? name1 : name2;
    const loser =
      pairing.winner_entry_id === pairing.player_1_entry_id ? name2 : name1;
    return `${winner} def. ${loser}`;
  }
  if (pairing.status === 'halved' && pairing.winner_entry_id && myEntryId) {
    const adv =
      pairing.winner_entry_id === pairing.player_1_entry_id ? name1 : name2;
    return bracketHalvedAdvanceLine(adv);
  }
  if (pairing.status === 'halved') {
    const advId = pairing.winner_entry_id;
    if (advId) {
      const adv = advId === pairing.player_1_entry_id ? name1 : name2;
      return bracketHalvedResultLine(adv);
    }
    return 'Match halved';
  }
  if (myEntryId) {
    const opp =
      pairing.player_1_entry_id === myEntryId
        ? name2
        : name1;
    return formatPairingResultLine(pairing, myEntryId, opp);
  }
  return `${name1} vs. ${name2}`;
}

export function buildBracketViewModel(params: {
  pairings: DbLeagueMatchPairingRow[];
  entries: BracketEntry[];
  displayNames: Record<string, string>;
  currentBracketRound: BracketRound | null;
  myEntryId: string | null;
  playerCount: number;
}): BracketViewModel {
  const { pairings, entries, displayNames, currentBracketRound, myEntryId, playerCount } =
    params;

  const roundsPresent = new Set(
    pairings.map((p) => p.bracket_round).filter((r): r is BracketRound => r != null)
  );

  const sections: BracketRoundSection[] = ROUND_ORDER.filter((r) => roundsPresent.has(r)).map(
    (round) => {
      const roundPairings = pairings
        .filter((p) => p.bracket_round === round)
        .sort((a, b) => (a.bracket_slot ?? 0) - (b.bracket_slot ?? 0));

      const cards: BracketPairingCard[] = roundPairings.map((pairing) => {
        const { name1, name2 } = pairingPlayerNames(pairing, entries, displayNames);
        const isMine =
          myEntryId != null &&
          (pairing.player_1_entry_id === myEntryId ||
            pairing.player_2_entry_id === myEntryId);
        return {
          pairing,
          name1,
          name2,
          seed1: entrySeed(entries, pairing.player_1_entry_id),
          seed2: entrySeed(entries, pairing.player_2_entry_id),
          statusLabel: pairingStatusLabel(pairing.status),
          resultLine: resultLineForPairing(pairing, entries, displayNames, myEntryId),
          isMine,
        };
      });

      return {
        round,
        label: bracketRoundLabel(round),
        pairings: cards,
        isCurrent: currentBracketRound === round,
      };
    }
  );

  const finalPairing = pairings.find((p) => p.bracket_round === 'final');
  const championEntryId =
    finalPairing?.status === 'complete' || finalPairing?.status === 'halved'
      ? finalPairing.winner_entry_id
      : null;

  let championName: string | null = null;
  if (championEntryId) {
    const e = entries.find((x) => x.id === championEntryId);
    championName = e ? displayNames[e.user_id] ?? 'Champion' : null;
  }

  const myPairingId =
    myEntryId != null
      ? pairings.find(
          (p) =>
            (p.player_1_entry_id === myEntryId || p.player_2_entry_id === myEntryId) &&
            p.bracket_round === currentBracketRound &&
            p.status !== 'complete' &&
            p.status !== 'halved'
        )?.id ??
        pairings.find(
          (p) =>
            (p.player_1_entry_id === myEntryId || p.player_2_entry_id === myEntryId) &&
            p.bracket_round === currentBracketRound
        )?.id ??
        null
      : null;

  const showBye =
    playerCount === 3 &&
    currentBracketRound === 'r1' &&
    !pairings.some((p) => p.bracket_round === 'final');

  let byeSeed1Name: string | null = null;
  if (showBye) {
    const seed1 = entries.find((e) => e.bracket_seed === 1);
    if (seed1) byeSeed1Name = displayNames[seed1.user_id] ?? 'Seed 1';
  }

  return {
    currentRound: currentBracketRound,
    currentRoundLabel: bracketRoundLabel(currentBracketRound),
    sections,
    myPairingId,
    championEntryId,
    championName,
    byeSeed1Name,
    showBye,
  };
}
