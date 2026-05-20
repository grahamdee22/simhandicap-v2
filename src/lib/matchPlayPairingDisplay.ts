/**
 * Match play pairing display helpers (no Supabase / React Native).
 */

import type { DbLeagueMatchPairingRow, LeagueMatchPairingStatus } from './matchPlayPairingTypes';

export function pairingPlayerNames(
  pairing: DbLeagueMatchPairingRow,
  entries: { id: string; user_id: string }[],
  displayNames: Record<string, string>
): { name1: string; name2: string } {
  const e1 = entries.find((e) => e.id === pairing.player_1_entry_id);
  const e2 = entries.find((e) => e.id === pairing.player_2_entry_id);
  return {
    name1: e1 ? displayNames[e1.user_id] ?? 'Player' : 'Player',
    name2: e2 ? displayNames[e2.user_id] ?? 'Player' : 'Player',
  };
}

export function opponentEntryIdForPairing(
  pairing: DbLeagueMatchPairingRow,
  myEntryId: string
): string | null {
  if (pairing.player_1_entry_id === myEntryId) return pairing.player_2_entry_id;
  if (pairing.player_2_entry_id === myEntryId) return pairing.player_1_entry_id;
  return null;
}

export function myHolesWonInPairing(
  pairing: DbLeagueMatchPairingRow,
  myEntryId: string
): number {
  if (pairing.player_1_entry_id === myEntryId) return pairing.holes_won_p1;
  if (pairing.player_2_entry_id === myEntryId) return pairing.holes_won_p2;
  return 0;
}

export function formatPairingStatusLabel(status: LeagueMatchPairingStatus): string {
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

export function formatPairingResultLine(
  pairing: DbLeagueMatchPairingRow,
  myEntryId: string,
  opponentName: string
): string {
  if (pairing.status === 'scheduled') {
    return `vs ${opponentName} · not started`;
  }
  if (pairing.status === 'in_progress') {
    const mine = myHolesWonInPairing(pairing, myEntryId);
    const theirs =
      pairing.player_1_entry_id === myEntryId ? pairing.holes_won_p2 : pairing.holes_won_p1;
    return `vs ${opponentName} · ${mine}–${theirs} (${pairing.holes_halved} halved)`;
  }
  if (pairing.status === 'halved') {
    return `vs ${opponentName} · match halved`;
  }
  const won = pairing.winner_entry_id === myEntryId;
  return won ? `Beat ${opponentName}` : `Lost to ${opponentName}`;
}
