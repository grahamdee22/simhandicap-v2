/**
 * Direct (non-open) match limits shared by create flow and rematch entry.
 */

import type { DbMatchRow } from './matchPlay';

export const MAX_ACTIVE_DIRECT_CHALLENGES = 3;

export const DIRECT_CONFLICT_STATUSES = new Set<DbMatchRow['status']>(['pending', 'active', 'waiting']);

/** Non-open matches in pending/active/waiting where `selfId` is a participant (counts toward direct cap). */
export function countActiveDirectMatchesForUser(rows: DbMatchRow[], selfId: string): number {
  let n = 0;
  for (const m of rows) {
    if (m.is_open || m.player_2_id == null) continue;
    if (!DIRECT_CONFLICT_STATUSES.has(m.status)) continue;
    if (m.player_1_id === selfId || m.player_2_id === selfId) n += 1;
  }
  return n;
}

/** True if `selfId` already has a non-open match vs `opponentId` in a state that blocks a new direct challenge. */
export function hasBlockingDirectMatchWithOpponent(
  rows: DbMatchRow[],
  selfId: string,
  opponentId: string
): boolean {
  return findActiveDirectMatchBetween(rows, selfId, opponentId) != null;
}

/** Pending / active / waiting direct match between the two players, if any. */
export function findActiveDirectMatchBetween(
  rows: DbMatchRow[],
  aId: string,
  bId: string
): DbMatchRow | null {
  for (const m of rows) {
    if (m.is_open || m.player_2_id == null) continue;
    if (!DIRECT_CONFLICT_STATUSES.has(m.status)) continue;
    const p1 = m.player_1_id;
    const p2 = m.player_2_id;
    if ((p1 === aId && p2 === bId) || (p1 === bId && p2 === aId)) return m;
  }
  return null;
}
