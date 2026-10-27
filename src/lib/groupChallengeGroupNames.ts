/**
 * Resolve group display names for Group Challenge UI.
 * Own groups come from the store; opponent groups via `lookup_groups_for_challenge` (UUID lookup).
 * Non-managers cannot call the lookup RPC, so callers must fall back to a truncated id.
 */

import type { FriendGroup } from '../store/useAppStore';
import { lookupGroupsForChallenge } from './groupChallenges';

const remoteNameCache = new Map<string, string>();

export function truncatedGroupId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** Synchronous best-effort name: store group → cached lookup → null. */
export function cachedGroupName(
  groupId: string,
  storeGroups: Pick<FriendGroup, 'id' | 'name'>[]
): string | null {
  return storeGroups.find((g) => g.id === groupId)?.name ?? remoteNameCache.get(groupId) ?? null;
}

/** Fill the cache for any ids not in the store. Returns a map of resolved names (id → name). */
export async function resolveGroupNames(
  groupIds: string[],
  storeGroups: Pick<FriendGroup, 'id' | 'name'>[],
  accessToken?: string
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const id of new Set(groupIds)) {
    const hit = cachedGroupName(id, storeGroups);
    if (hit) out[id] = hit;
    else missing.push(id);
  }
  await Promise.all(
    missing.map(async (id) => {
      try {
        const res = await lookupGroupsForChallenge(id, accessToken);
        const row = (res.data ?? []).find((r) => r.id.toLowerCase() === id.toLowerCase());
        if (row?.name) {
          remoteNameCache.set(id, row.name);
          out[id] = row.name;
        }
      } catch {
        /* leave unresolved */
      }
    })
  );
  return out;
}

/** Extract a readable message from a PostgREST / RPC error body. */
export function friendlyChallengeError(raw: string | null | undefined): string {
  if (!raw) return '';
  const text = raw.trim();
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (parsed.message) return parsed.message;
    } catch {
      /* fall through */
    }
  }
  return text;
}
