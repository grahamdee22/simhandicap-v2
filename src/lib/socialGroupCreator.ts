import type { FriendGroup, GroupMember } from '../store/useAppStore';

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

function memberIsAdmin(
  group: Pick<FriendGroup, 'members'> | null | undefined,
  authUserId: string | null | undefined
): boolean {
  if (!group || !authUserId) return false;
  const uid = authUserId.trim().toLowerCase();
  return group.members.some(
    (m) => m.userId?.trim().toLowerCase() === uid && m.isAdmin === true
  );
}

/** Creator or designated group admin — tournaments, invites, manage tournament. */
export function isSocialGroupManager(
  group: Pick<FriendGroup, 'createdByUserId' | 'members'> | null | undefined,
  authUserId: string | null | undefined
): boolean {
  return isSocialGroupCreator(group, authUserId) || memberIsAdmin(group, authUserId);
}

export function groupMemberIsAdmin(member: GroupMember): boolean {
  return member.isAdmin === true;
}
