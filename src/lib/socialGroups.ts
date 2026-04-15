import { PLATFORMS, type PlatformId } from './constants';
import { headToHeadFromLoggedRound } from './h2hFromRound';
import { dbRowToSimRound, type DbRoundRow } from './rounds';
import { supabase } from './supabase';
import {
  currentIndexFromRounds,
  initialsFrom,
  useAppStore,
  type FriendGroup,
  type GroupMember,
  type HeadToHead,
  type InboundGroupInvite,
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
  memberRounds: SimRound[]
): GroupMember {
  const isYou = row.user_id === currentUserId;
  const name =
    profile?.display_name?.trim() ||
    row.display_name_snapshot?.trim() ||
    'Member';
  const platform: PlatformId =
    isPlatformId(profile?.preferred_platform) ? profile.preferred_platform : 'Trackman';
  const ghin = profile?.ghin_index != null ? Number(profile.ghin_index) : null;
  const simIdx = currentIndexFromRounds(memberRounds);
  const index = simIdx ?? (ghin != null && Number.isFinite(ghin) ? ghin : null);
  return {
    id: row.id,
    userId: row.user_id,
    displayName: isYou ? `${name} (you)` : name,
    initials: initialsFrom(name),
    platform,
    roundsLogged: memberRounds.length,
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

  const { data: gpiRows, error: gpiErr } = await supabase
    .from('group_pending_invites')
    .select('id, group_id, invitee_display_snapshot')
    .in('group_id', groupIds)
    .eq('status', 'pending');

  if (gpiErr) {
    console.warn('[socialGroups] pending in-app invites', gpiErr.message);
  }

  const { data: sgiRows, error: sgiErr } = await supabase
    .from('social_group_invites')
    .select('id, group_id, email')
    .in('group_id', groupIds)
    .eq('status', 'open');

  if (sgiErr) {
    console.warn('[socialGroups] email invites', sgiErr.message);
  }

  const pendingInAppByGroup = new Map<string, { id: string; label: string }[]>();
  for (const row of gpiRows ?? []) {
    const label = (row.invitee_display_snapshot as string | null)?.trim() || 'Invited member';
    const list = pendingInAppByGroup.get(row.group_id) ?? [];
    list.push({ id: row.id as string, label });
    pendingInAppByGroup.set(row.group_id, list);
  }

  const pendingEmailByGroup = new Map<string, { id: string; email: string }[]>();
  for (const row of sgiRows ?? []) {
    const list = pendingEmailByGroup.get(row.group_id) ?? [];
    list.push({ id: row.id as string, email: String(row.email) });
    pendingEmailByGroup.set(row.group_id, list);
  }

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

  const roundsByUserId = new Map<string, SimRound[]>();
  if (userIds.length > 0) {
    const { data: roundsRows, error: rErr } = await supabase
      .from('rounds')
      .select(
        'id, user_id, course_id, course_name, platform, gross_score, hole_scores, putting_mode, pin_placement, wind, mulligans, difficulty_modifier, differential, raw_differential, course_rating, slope, tee_name, played_at, created_at, h2h_group_id, h2h_opponent_member_id, h2h_opponent_display_name'
      )
      .in('user_id', userIds)
      .order('played_at', { ascending: true });

    if (rErr) {
      console.warn('[socialGroups] cohort rounds', rErr.message);
    } else {
      for (const row of roundsRows ?? []) {
        const uid = row.user_id as string;
        const list = roundsByUserId.get(uid) ?? [];
        list.push(dbRowToSimRound(row as DbRoundRow));
        roundsByUserId.set(uid, list);
      }
    }
  }

  const friendGroups: FriendGroup[] = groupsRows.map((gr) => {
    const membersRaw = allMembers.filter((m) => m.group_id === gr.id);
    const members: GroupMember[] = membersRaw
      .map((m) =>
        mapProfileToMember(m, profileById.get(m.user_id), user.id, roundsByUserId.get(m.user_id) ?? [])
      )
      .sort((a, b) => {
        const ai = a.index ?? 999;
        const bi = b.index ?? 999;
        return ai - bi;
      });
    return {
      id: gr.id,
      name: gr.name,
      createdByUserId: gr.created_by,
      members,
      pendingInApp: pendingInAppByGroup.get(gr.id),
      pendingEmail: pendingEmailByGroup.get(gr.id),
      lastRoundSummary: `${members.length} member${members.length === 1 ? '' : 's'}`,
      headToHead: [],
    };
  });

  friendGroups.sort((a, b) => a.name.localeCompare(b.name));
  useAppStore.getState().setGroups(friendGroups);
}

let socialRealtimeDebounce: ReturnType<typeof setTimeout> | null = null;

/**
 * Subscribes to crew membership / in-app invite changes so signed-in clients
 * (e.g. inviter on Social while invitee accepts elsewhere) refetch store data.
 * Pass the current JWT so Realtime applies RLS and delivers `postgres_changes`.
 * Call the returned function on sign-out or when replacing the session.
 */
export function attachSocialGroupsRealtimeSync(accessToken: string | undefined): () => void {
  const client = supabase;
  if (!client) {
    return () => {};
  }

  let cancelled = false;
  let channel: ReturnType<typeof client.channel> | null = null;

  const scheduleRefetch = (): void => {
    if (socialRealtimeDebounce != null) {
      clearTimeout(socialRealtimeDebounce);
    }
    socialRealtimeDebounce = setTimeout(() => {
      socialRealtimeDebounce = null;
      void (async () => {
        await fetchMySocialGroupsIntoStore();
        await fetchInboundGroupInvitesIntoStore();
        useAppStore.getState().recomputeGroupsFromYou();
      })();
    }, 280);
  };

  void client.realtime.setAuth(accessToken ?? null).then(() => {
    if (cancelled) return;
    channel = client
      .channel('social-groups-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_members' },
        scheduleRefetch
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_pending_invites' },
        scheduleRefetch
      )
      .subscribe();
  });

  return () => {
    cancelled = true;
    if (socialRealtimeDebounce != null) {
      clearTimeout(socialRealtimeDebounce);
      socialRealtimeDebounce = null;
    }
    if (channel) {
      void client.removeChannel(channel);
      channel = null;
    }
  };
}

export async function fetchInboundGroupInvitesIntoStore(): Promise<void> {
  if (!supabase) {
    useAppStore.getState().setInboundGroupInvites([]);
    return;
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    useAppStore.getState().setInboundGroupInvites([]);
    return;
  }

  const { data, error } = await supabase
    .from('group_pending_invites')
    .select(
      `
      id,
      group_id,
      inviter_display_snapshot,
      social_groups ( name )
    `
    )
    .eq('invitee_user_id', user.id)
    .eq('status', 'pending');

  if (error) {
    console.warn('[socialGroups] inbound invites', error.message);
    useAppStore.getState().setInboundGroupInvites([]);
    return;
  }

  const rows = (data ?? []) as Record<string, unknown>[];

  const groupNameFromJoin = (rel: unknown): string => {
    if (rel == null) return '';
    if (Array.isArray(rel)) {
      const first = rel[0] as { name?: string } | undefined;
      return first?.name?.trim() ?? '';
    }
    const o = rel as { name?: string };
    return o.name?.trim() ?? '';
  };

  const invites: InboundGroupInvite[] = rows.map((row) => ({
    id: String(row.id),
    groupId: String(row.group_id),
    groupName: groupNameFromJoin(row.social_groups) || 'Group',
    inviterName: String(row.inviter_display_snapshot ?? '').trim() || 'Someone',
  }));

  useAppStore.getState().setInboundGroupInvites(invites);
}

export async function fetchGroupMatchesFromSupabase(groupId: string): Promise<HeadToHead[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('social_group_matches')
    .select(
      'id, course_name, played_at, left_name, left_gross, left_net, left_won, right_name, right_gross, right_net, right_won, conditions_line'
    )
    .eq('group_id', groupId)
    .order('played_at', { ascending: false })
    .limit(50);

  if (error) {
    console.warn('[socialGroups] matches', error.message);
    return [];
  }

  try {
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
  } catch (e) {
    console.warn('[socialGroups] matches map', e instanceof Error ? e.message : e);
    return [];
  }
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
 * Creates a crew via `create_social_group` RPC (migration 013): avoids RLS recursion from
 * `social_groups` policies that scan `group_members` during client-side INSERT checks.
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

  const { data: groupId, error: rpcErr } = await supabase.rpc('create_social_group', {
    p_name: trimmed,
  });

  if (rpcErr) {
    return { error: rpcErr.message };
  }

  if (groupId == null || typeof groupId !== 'string') {
    return { error: 'Could not create group' };
  }

  return { id: groupId };
}

/**
 * Deletes a crew row; FK `on delete cascade` removes members, pending invites, email invites, and H2H rows.
 *
 * Uses RPC `delete_social_group_as_creator` (migration 018): client `DELETE` + CASCADE under member RLS can
 * hang or recurse; the definer function performs one delete as owner so cascades bypass child-table RLS.
 */
export async function deleteSocialGroupAsCreator(groupId: string): Promise<{ ok: true } | { error: string }> {
  if (!supabase) {
    console.warn('[socialGroups] deleteSocialGroupAsCreator: no supabase client');
    return { error: 'Supabase is not configured' };
  }
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (userErr || !user) {
    console.warn('[socialGroups] deleteSocialGroupAsCreator: not signed in', userErr?.message);
    return { error: userErr?.message ?? 'Not signed in' };
  }

  const sessionUserId = session?.user?.id ?? null;
  const authUserId = user.id;
  console.warn('[socialGroups] deleteSocialGroupAsCreator:auth_ids', {
    groupId,
    'getUser().id': authUserId,
    'getUser().id_type': typeof authUserId,
    'getUser().id_length': authUserId?.length,
    'getSession().user.id': sessionUserId,
    'getSession().user.id_type': typeof sessionUserId,
    session_matches_getUser: sessionUserId === authUserId,
  });

  const { data: rpcData, error: rpcErr } = await supabase.rpc('delete_social_group_as_creator', {
    p_group_id: groupId,
  });

  if (rpcErr) {
    console.warn('[socialGroups] deleteSocialGroupAsCreator:rpc_error', rpcErr.message, rpcErr);
    return { error: rpcErr.message };
  }

  const deleted = rpcData === true;
  console.warn('[socialGroups] deleteSocialGroupAsCreator:rpc_result', {
    groupId,
    rpcData,
    rpcData_type: typeof rpcData,
    deleted,
  });

  if (!deleted) {
    return {
      error: 'Could not delete this group. You may not be the creator, or it was already removed.',
    };
  }

  return { ok: true };
}

export type SendGroupInviteResult = {
  kind: 'in_app' | 'email' | 'already_member';
  email: string;
  duplicate?: boolean;
};

/**
 * Sends a crew invite: registered users get an in-app pending row (RPC); others get DB email row + client mailto.
 */
export async function sendGroupInvite(
  groupId: string,
  email: string
): Promise<{ error?: string; result?: SendGroupInviteResult }> {
  if (!supabase) return { error: 'Supabase is not configured' };
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) return { error: 'Not signed in' };

  const { data, error } = await supabase.rpc('send_group_invite', {
    p_group_id: groupId,
    p_email: email.trim(),
  });

  if (error) return { error: error.message };

  const row = data as { kind?: string; email?: string; duplicate?: boolean } | null;
  if (!row?.kind || typeof row.email !== 'string') {
    return { error: 'Unexpected server response' };
  }

  const k = row.kind;
  if (k === 'already_member') {
    return { result: { kind: 'already_member', email: row.email } };
  }
  if (k === 'in_app') {
    return { result: { kind: 'in_app', email: row.email, duplicate: row.duplicate === true } };
  }
  if (k === 'email') {
    return { result: { kind: 'email', email: row.email, duplicate: row.duplicate === true } };
  }
  return { error: 'Unknown invite type' };
}

export async function respondToGroupInvite(
  inviteId: string,
  accept: boolean
): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured' };
  const { error } = await supabase.rpc('respond_group_invite', {
    p_invite_id: inviteId,
    p_accept: accept,
  });
  if (error) return { error: error.message };
  return {};
}

export async function cancelOutboundGroupInvite(
  kind: 'in_app' | 'email',
  id: string
): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured' };
  const { error } = await supabase.rpc('cancel_outbound_group_invite', {
    p_kind: kind,
    p_id: id,
  });
  if (error) return { error: error.message };
  return {};
}
