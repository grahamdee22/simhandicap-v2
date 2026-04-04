import { PLATFORMS, type PlatformId } from './constants';
import { headToHeadFromLoggedRound } from './h2hFromRound';
import { supabase } from './supabase';
import {
  currentIndexFromRounds,
  initialsFrom,
  useAppStore,
  type FriendGroup,
  type GroupMember,
  type HeadToHead,
  type SimRound,
} from '../store/useAppStore';

function isPlatformId(v: string | null | undefined): v is PlatformId {
  return v != null && (PLATFORMS as readonly string[]).includes(v);
}

function mapProfileToMember(
  row: {
    id: string;
    group_id: string;
    user_id: string;
    display_name_snapshot: string | null;
  },
  profile: { display_name: string; preferred_platform: string | null; ghin_index: number | null } | undefined,
  currentUserId: string,
  rounds: SimRound[]
): GroupMember {
  const isYou = row.user_id === currentUserId;
  const name =
    profile?.display_name?.trim() ||
    row.display_name_snapshot?.trim() ||
    'Member';
  const platform: PlatformId =
    isPlatformId(profile?.preferred_platform) ? profile.preferred_platform : 'Trackman';
  const ghin = profile?.ghin_index != null ? Number(profile.ghin_index) : null;
  const simIdx = isYou ? currentIndexFromRounds(rounds) : null;
  const index = simIdx ?? (ghin != null && Number.isFinite(ghin) ? ghin : null);
  return {
    id: row.id,
    displayName: isYou ? `${name} (you)` : name,
    initials: initialsFrom(name),
    platform,
    roundsLogged: isYou ? rounds.length : 0,
    index,
    trend: 'flat',
    isYou,
  };
}

/** Load crews from Supabase and replace `groups` in the store (then caller may run recomputeGroupsFromYou). */
export async function fetchMySocialGroupsIntoStore(): Promise<void> {
  if (!supabase) {
    return;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    useAppStore.getState().setGroups([]);
    return;
  }

  const { data: myMemberships, error: memErr } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', user.id);

  if (memErr) {
    console.warn('[socialGroups]', memErr.message);
    useAppStore.getState().setGroups([]);
    return;
  }

  const groupIds = [...new Set((myMemberships ?? []).map((m) => m.group_id))];
  if (groupIds.length === 0) {
    useAppStore.getState().setGroups([]);
    return;
  }

  const { data: groupsRows, error: gErr } = await supabase
    .from('social_groups')
    .select('id, name, created_by, created_at')
    .in('id', groupIds);

  if (gErr || !groupsRows?.length) {
    console.warn('[socialGroups]', gErr?.message);
    useAppStore.getState().setGroups([]);
    return;
  }

  const { data: allMembers, error: allErr } = await supabase
    .from('group_members')
    .select('id, group_id, user_id, display_name_snapshot, joined_at')
    .in('group_id', groupIds);

  if (allErr || !allMembers) {
    console.warn('[socialGroups]', allErr?.message);
    useAppStore.getState().setGroups([]);
    return;
  }

  const userIds = [...new Set(allMembers.map((m) => m.user_id))];
  const { data: profilesRows } = await supabase
    .from('profiles')
    .select('id, display_name, preferred_platform, ghin_index')
    .in('id', userIds);

  const profileById = new Map(
    (profilesRows ?? []).map((p) => [
      p.id,
      {
        display_name: p.display_name,
        preferred_platform: p.preferred_platform,
        ghin_index: p.ghin_index != null ? Number(p.ghin_index) : null,
      },
    ])
  );

  const rounds = useAppStore.getState().rounds;
  const friendGroups: FriendGroup[] = groupsRows.map((gr) => {
    const membersRaw = allMembers.filter((m) => m.group_id === gr.id);
    const members: GroupMember[] = membersRaw
      .map((m) => mapProfileToMember(m, profileById.get(m.user_id), user.id, rounds))
      .sort((a, b) => {
        const ai = a.index ?? 999;
        const bi = b.index ?? 999;
        return ai - bi;
      });
    return {
      id: gr.id,
      name: gr.name,
      members,
      lastRoundSummary: `${members.length} member${members.length === 1 ? '' : 's'}`,
      headToHead: [],
    };
  });

  friendGroups.sort((a, b) => a.name.localeCompare(b.name));
  useAppStore.getState().setGroups(friendGroups);
}

export async function fetchGroupMatchesFromSupabase(groupId: string): Promise<HeadToHead[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('social_group_matches')
    .select('*')
    .eq('group_id', groupId)
    .order('played_at', { ascending: false });

  if (error) {
    console.warn('[socialGroups] matches', error.message);
    return [];
  }

  return (data ?? []).map(
    (row): HeadToHead => ({
      id: row.id,
      courseName: row.course_name,
      playedAt: row.played_at,
      left: {
        name: row.left_name,
        gross: row.left_gross,
        net: row.left_net != null ? Number(row.left_net) : null,
        won: row.left_won,
      },
      right: {
        name: row.right_name,
        gross: row.right_gross,
        net: row.right_net != null ? Number(row.right_net) : null,
        won: row.right_won,
      },
      conditionsLine: row.conditions_line ?? '',
    })
  );
}

export async function insertSocialMatchFromRound(round: SimRound, displayName: string): Promise<void> {
  if (!supabase || !round.h2hGroupId) return;
  const h = headToHeadFromLoggedRound(round, displayName);
  if (!h) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase.from('social_group_matches').insert({
    group_id: round.h2hGroupId,
    created_by: user.id,
    course_name: h.courseName,
    played_at: h.playedAt,
    left_name: h.left.name,
    left_gross: h.left.gross,
    left_net: h.left.net,
    left_won: h.left.won,
    right_name: h.right.name,
    right_gross: h.right.gross,
    right_net: h.right.net,
    right_won: h.right.won,
    conditions_line: h.conditionsLine,
  });

  if (error) console.warn('[socialGroups] insert match', error.message);
}

/**
 * Creates a crew: 1) insert `social_groups`, 2) insert creator into `group_members`.
 * If step 2 fails, attempts to delete the new row from `social_groups` (requires DELETE RLS for creator).
 */
export async function createSocialGroup(name: string): Promise<{ id: string } | { error: string }> {
  if (!supabase) return { error: 'Supabase is not configured' };
  const trimmed = name.trim();
  if (!trimmed) return { error: 'Enter a group name' };

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { error: userErr?.message ?? 'Not signed in' };
  }

  const displayNameSnapshot = useAppStore.getState().displayName.trim() || null;

  const { data: g, error: gErr } = await supabase
    .from('social_groups')
    .insert({ name: trimmed, created_by: user.id })
    .select('id')
    .single();

  if (gErr || !g?.id) {
    return { error: gErr?.message ?? 'Could not create group' };
  }

  const groupId = g.id;

  const { error: mErr } = await supabase.from('group_members').insert({
    group_id: groupId,
    user_id: user.id,
    display_name_snapshot: displayNameSnapshot,
  });

  if (mErr) {
    console.warn('[socialGroups] group_members insert failed', mErr.message);
    const { error: delErr } = await supabase
      .from('social_groups')
      .delete()
      .eq('id', groupId)
      .eq('created_by', user.id);
    if (delErr) {
      console.warn('[socialGroups] rollback: could not delete orphan group', delErr.message);
    }
    return { error: mErr.message };
  }

  return { id: groupId };
}

export async function sendSocialGroupInvite(groupId: string, email: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured' };
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) return { error: 'Not signed in' };

  const { error } = await supabase.from('social_group_invites').insert({
    group_id: groupId,
    email: email.trim().toLowerCase(),
    invited_by: user.id,
  });

  if (error) return { error: error.message };
  return {};
}
