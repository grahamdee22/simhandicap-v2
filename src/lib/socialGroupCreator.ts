import type { FriendGroup } from '../store/useAppStore';

/** Compare auth user to `social_groups.created_by` (case-insensitive UUID). */
export function isSocialGroupCreator(
  group: Pick<FriendGroup, 'createdByUserId'> | null | undefined,
  authUserId: string | null | undefined
): boolean {
  if (!group || !authUserId) return false;
  const creator = group.createdByUserId?.trim();
  const uid = authUserId.trim();
  if (!creator || !uid) return false;
  return creator.toLowerCase() === uid.toLowerCase();
}
