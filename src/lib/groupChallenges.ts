/**
 * Group Challenges: cross-group net stroke play (5v5).
 * Handicap snapshots + verification are scoped here — not used by regular leagues.
 */

import Constants from 'expo-constants';
import { supabase } from './supabase';
import {
  GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS,
  GROUP_CHALLENGE_ROSTER_SIZE,
  buildHandicapSnapshot,
  canSubmitChallengeRound,
  challengeResultLabel,
  isGroupChallengeRosterEligible,
  netScoreForGroupChallengeRound,
  opponentGroupId,
  qualifyingRoundsCount,
  rosterEligibilityForPlayer,
  teamTotalFromRounds,
  type GroupChallengeEligibility,
  type GroupChallengeRoundVerification,
  type GroupChallengeStatus,
  type GroupChallengeVerificationMode,
  type RosterEligibilityInfo,
} from './groupChallengeHelpers';

export {
  GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS,
  GROUP_CHALLENGE_ROSTER_SIZE,
  buildHandicapSnapshot,
  canSubmitChallengeRound,
  challengeResultLabel,
  isGroupChallengeRosterEligible,
  netScoreForGroupChallengeRound,
  opponentGroupId,
  qualifyingRoundsCount,
  rosterEligibilityForPlayer,
  teamTotalFromRounds,
};
export type {
  GroupChallengeEligibility,
  GroupChallengeRoundVerification,
  GroupChallengeStatus,
  GroupChallengeVerificationMode,
  RosterEligibilityInfo,
};

export type DbGroupChallenge = {
  id: string;
  name: string;
  challenging_group_id: string;
  challenged_group_id: string;
  status: GroupChallengeStatus;
  course_id: string;
  tee_name: string | null;
  holes_per_round: '18' | '9';
  roster_size: number;
  verification_mode: GroupChallengeVerificationMode;
  start_date: string;
  end_date: string;
  accepted_at: string | null;
  activated_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  winner_group_id: string | null;
  created_by: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type DbGroupChallengeRoster = {
  id: string;
  challenge_id: string;
  group_id: string;
  user_id: string;
  handicap_snapshot: number | null;
  handicap_source: 'simcap' | 'ghin' | null;
  snapshot_context: Record<string, unknown>;
  eligibility_status: GroupChallengeEligibility;
  qualifying_rounds_count: number;
  withdrawn_at: string | null;
  created_at: string;
};

export type DbGroupChallengeRound = {
  id: string;
  challenge_id: string;
  roster_entry_id: string;
  round_id: string | null;
  gross_score: number;
  net_score: number;
  course_rating: number | null;
  slope: number | null;
  course_par: number | null;
  tee_name: string | null;
  submitted_at: string;
  evidence_path: string | null;
  verification_status: GroupChallengeRoundVerification;
  verified_by: string | null;
  verified_at: string | null;
  verification_notes: string | null;
  disputed_by: string | null;
  disputed_at: string | null;
  dispute_reason: string | null;
  created_at: string;
};

export type DbGroupChallengeResult = {
  challenge_id: string;
  group_id: string;
  total_net: number;
  final_position: number;
  finalized_at: string;
};

export type GroupChallengeBundle = {
  challenge: DbGroupChallenge;
  rosters: DbGroupChallengeRoster[];
  rounds: DbGroupChallengeRound[];
  results: DbGroupChallengeResult[];
  displayNames: Record<string, string>;
};

function getSupabaseRestConfig(): { supabaseUrl: string; supabaseAnonKey: string } {
  const extra = Constants.expoConfig?.extra as
    | { supabaseUrl?: string; supabaseAnonKey?: string; supabasePublishableKey?: string }
    | undefined;
  return {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra?.supabaseUrl ?? '',
    supabaseAnonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_KEY ??
      extra?.supabaseAnonKey ??
      extra?.supabasePublishableKey ??
      '',
  };
}

async function restSelect<T>(
  path: string,
  accessToken?: string
): Promise<{ data: T[] | null; error: string | null }> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured' };
  const headers: Record<string, string> = { apikey: supabaseAnonKey };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { data: null, error: body || res.statusText };
  }
  const parsed = (await res.json()) as T[];
  return { data: Array.isArray(parsed) ? parsed : [], error: null };
}

async function restRpc<T>(
  fn: string,
  body: Record<string, unknown>,
  accessToken?: string
): Promise<{ data: T | null; error: string | null }> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured' };
  const headers: Record<string, string> = {
    apikey: supabaseAnonKey,
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    return { data: null, error: text };
  }
  const parsed = (await res.json()) as T;
  return { data: parsed, error: null };
}

export async function lookupGroupsForChallenge(
  query: string,
  accessToken?: string
): Promise<{ data: { id: string; name: string }[] | null; error: string | null }> {
  const q = query.trim();
  if (!q) return { data: [], error: null };
  if (accessToken) {
    return restRpc<{ id: string; name: string }[]>('lookup_groups_for_challenge', {
      p_query: q,
    }, accessToken).then((r) => ({
      data: Array.isArray(r.data) ? r.data : r.data ? [r.data as never] : [],
      error: r.error,
    }));
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase.rpc('lookup_groups_for_challenge', { p_query: q });
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as { id: string; name: string }[], error: null };
}

export async function fetchGroupChallengesForGroup(
  groupId: string,
  accessToken?: string
): Promise<{ data: DbGroupChallenge[] | null; error: string | null }> {
  const filter = `or=(challenging_group_id.eq.${encodeURIComponent(groupId)},challenged_group_id.eq.${encodeURIComponent(groupId)})&order=created_at.desc`;
  if (accessToken) {
    return restSelect<DbGroupChallenge>(`group_challenges?${filter}`, accessToken);
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('group_challenges')
    .select('*')
    .or(`challenging_group_id.eq.${groupId},challenged_group_id.eq.${groupId}`)
    .order('created_at', { ascending: false });
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as DbGroupChallenge[], error: null };
}

export async function fetchGroupChallengeBundle(
  challengeId: string,
  accessToken?: string
): Promise<{ data: GroupChallengeBundle | null; error: string | null }> {
  const challengePath = `group_challenges?id=eq.${encodeURIComponent(challengeId)}&select=*`;
  const rostersPath = `group_challenge_rosters?challenge_id=eq.${encodeURIComponent(challengeId)}&select=*`;
  const roundsPath = `group_challenge_rounds?challenge_id=eq.${encodeURIComponent(challengeId)}&select=*`;
  const resultsPath = `group_challenge_results?challenge_id=eq.${encodeURIComponent(challengeId)}&select=*`;

  let challenge: DbGroupChallenge | null = null;
  let rosters: DbGroupChallengeRoster[] = [];
  let rounds: DbGroupChallengeRound[] = [];
  let results: DbGroupChallengeResult[] = [];

  if (accessToken) {
    const [cRes, rRes, roundRes, resRes] = await Promise.all([
      restSelect<DbGroupChallenge>(challengePath, accessToken),
      restSelect<DbGroupChallengeRoster>(rostersPath, accessToken),
      restSelect<DbGroupChallengeRound>(roundsPath, accessToken),
      restSelect<DbGroupChallengeResult>(resultsPath, accessToken),
    ]);
    if (cRes.error || !cRes.data?.length) {
      return { data: null, error: cRes.error ?? 'Challenge not found' };
    }
    challenge = cRes.data[0];
    rosters = rRes.data ?? [];
    rounds = roundRes.data ?? [];
    results = resRes.data ?? [];
  } else {
    if (!supabase) return { data: null, error: 'Supabase is not configured' };
    const [cRes, rRes, roundRes, resRes] = await Promise.all([
      supabase.from('group_challenges').select('*').eq('id', challengeId).maybeSingle(),
      supabase.from('group_challenge_rosters').select('*').eq('challenge_id', challengeId),
      supabase.from('group_challenge_rounds').select('*').eq('challenge_id', challengeId),
      supabase.from('group_challenge_results').select('*').eq('challenge_id', challengeId),
    ]);
    if (cRes.error || !cRes.data) {
      return { data: null, error: cRes.error?.message ?? 'Challenge not found' };
    }
    challenge = cRes.data as DbGroupChallenge;
    rosters = (rRes.data ?? []) as DbGroupChallengeRoster[];
    rounds = (roundRes.data ?? []) as DbGroupChallengeRound[];
    results = (resRes.data ?? []) as DbGroupChallengeResult[];
  }

  const namesRes = await fetchRosterDisplayNames(challengeId, accessToken);
  return {
    data: {
      challenge,
      rosters,
      rounds,
      results,
      displayNames: namesRes.data ?? {},
    },
    error: null,
  };
}

async function fetchRosterDisplayNames(
  challengeId: string,
  accessToken?: string
): Promise<{ data: Record<string, string> | null; error: string | null }> {
  if (accessToken) {
    const r = await restRpc<{ user_id: string; display_name: string }[]>(
      'group_challenge_roster_display_names',
      { p_challenge_id: challengeId },
      accessToken
    );
    if (r.error) return { data: {}, error: r.error };
    const map: Record<string, string> = {};
    for (const row of r.data ?? []) map[row.user_id] = row.display_name;
    return { data: map, error: null };
  }
  if (!supabase) return { data: {}, error: null };
  const { data, error } = await supabase.rpc('group_challenge_roster_display_names', {
    p_challenge_id: challengeId,
  });
  if (error) return { data: {}, error: error.message };
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as { user_id: string; display_name: string }[]) {
    map[row.user_id] = row.display_name;
  }
  return { data: map, error: null };
}

export type CreateGroupChallengeInput = {
  name: string;
  challengingGroupId: string;
  challengedGroupId: string;
  courseId: string;
  teeName?: string | null;
  holesPerRound: '18' | '9';
  verificationMode: GroupChallengeVerificationMode;
  startDate: string;
  endDate: string;
  createdBy: string;
  notes?: string | null;
  /** Challenging side roster (exactly roster_size). */
  rosterUserIds: string[];
  /** Per-user eligibility + qualifying count at create time. */
  rosterMeta: Record<
    string,
    { eligibility: GroupChallengeEligibility; qualifyingRounds: number }
  >;
};

export async function createGroupChallenge(
  input: CreateGroupChallengeInput,
  accessToken?: string
): Promise<{ data: DbGroupChallenge | null; error: string | null }> {
  if (input.challengingGroupId === input.challengedGroupId) {
    return { data: null, error: 'Pick a different group to challenge' };
  }
  if (input.rosterUserIds.length !== GROUP_CHALLENGE_ROSTER_SIZE) {
    return {
      data: null,
      error: `Select exactly ${GROUP_CHALLENGE_ROSTER_SIZE} players for your roster`,
    };
  }
  const ineligible = input.rosterUserIds.filter(
    (id) => input.rosterMeta[id]?.eligibility === 'ineligible'
  );
  if (ineligible.length > 0) {
    return {
      data: null,
      error: 'Every selected player needs at least 5 qualifying SimCap rounds',
    };
  }

  const payload = {
    name: input.name.trim(),
    challenging_group_id: input.challengingGroupId,
    challenged_group_id: input.challengedGroupId,
    status: 'pending' as const,
    course_id: input.courseId,
    tee_name: input.teeName?.trim() || null,
    holes_per_round: input.holesPerRound,
    roster_size: GROUP_CHALLENGE_ROSTER_SIZE,
    verification_mode: input.verificationMode,
    start_date: input.startDate,
    end_date: input.endDate,
    created_by: input.createdBy,
    notes: input.notes?.trim() || null,
  };

  let challenge: DbGroupChallenge | null = null;

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    const res = await fetch(`${supabaseUrl}/rest/v1/group_challenges`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify([payload]),
    });
    if (!res.ok) return { data: null, error: await res.text().catch(() => res.statusText) };
    const rows = (await res.json()) as DbGroupChallenge[];
    challenge = rows[0] ?? null;
  } else {
    if (!supabase) return { data: null, error: 'Supabase is not configured' };
    const { data, error } = await supabase
      .from('group_challenges')
      .insert(payload)
      .select('*')
      .single();
    if (error) return { data: null, error: error.message };
    challenge = data as DbGroupChallenge;
  }

  if (!challenge) return { data: null, error: 'Could not create challenge' };

  const rosterRows = input.rosterUserIds.map((userId) => ({
    challenge_id: challenge!.id,
    group_id: input.challengingGroupId,
    user_id: userId,
    eligibility_status: input.rosterMeta[userId]?.eligibility ?? 'eligible',
    qualifying_rounds_count: input.rosterMeta[userId]?.qualifyingRounds ?? 0,
  }));

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    const res = await fetch(`${supabaseUrl}/rest/v1/group_challenge_rosters`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rosterRows),
    });
    if (!res.ok) return { data: null, error: await res.text().catch(() => res.statusText) };
  } else if (supabase) {
    const { error } = await supabase.from('group_challenge_rosters').insert(rosterRows);
    if (error) return { data: null, error: error.message };
  }

  return { data: challenge, error: null };
}

export async function setChallengedGroupRoster(params: {
  challengeId: string;
  groupId: string;
  userIds: string[];
  rosterMeta: Record<
    string,
    { eligibility: GroupChallengeEligibility; qualifyingRounds: number }
  >;
  accessToken?: string;
}): Promise<{ error: string | null }> {
  const { challengeId, groupId, userIds, rosterMeta, accessToken } = params;
  if (userIds.length !== GROUP_CHALLENGE_ROSTER_SIZE) {
    return { error: `Select exactly ${GROUP_CHALLENGE_ROSTER_SIZE} players` };
  }
  const ineligible = userIds.filter((id) => rosterMeta[id]?.eligibility === 'ineligible');
  if (ineligible.length > 0) {
    return { error: 'Every selected player needs at least 5 qualifying SimCap rounds' };
  }

  // Replace existing challenged-side roster (pre-active only; RLS enforces).
  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    const del = await fetch(
      `${supabaseUrl}/rest/v1/group_challenge_rosters?challenge_id=eq.${encodeURIComponent(challengeId)}&group_id=eq.${encodeURIComponent(groupId)}`,
      {
        method: 'DELETE',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (!del.ok) return { error: await del.text().catch(() => del.statusText) };

    const rows = userIds.map((userId) => ({
      challenge_id: challengeId,
      group_id: groupId,
      user_id: userId,
      eligibility_status: rosterMeta[userId]?.eligibility ?? 'eligible',
      qualifying_rounds_count: rosterMeta[userId]?.qualifyingRounds ?? 0,
    }));
    const ins = await fetch(`${supabaseUrl}/rest/v1/group_challenge_rosters`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    });
    if (!ins.ok) return { error: await ins.text().catch(() => ins.statusText) };
    return { error: null };
  }

  if (!supabase) return { error: 'Supabase is not configured' };
  const { error: delErr } = await supabase
    .from('group_challenge_rosters')
    .delete()
    .eq('challenge_id', challengeId)
    .eq('group_id', groupId);
  if (delErr) return { error: delErr.message };
  const { error } = await supabase.from('group_challenge_rosters').insert(
    userIds.map((userId) => ({
      challenge_id: challengeId,
      group_id: groupId,
      user_id: userId,
      eligibility_status: rosterMeta[userId]?.eligibility ?? 'eligible',
      qualifying_rounds_count: rosterMeta[userId]?.qualifyingRounds ?? 0,
    }))
  );
  return { error: error?.message ?? null };
}

export async function respondGroupChallenge(
  challengeId: string,
  accept: boolean,
  accessToken?: string
): Promise<{ data: DbGroupChallenge | null; error: string | null }> {
  if (accessToken) {
    return restRpc<DbGroupChallenge>(
      'respond_group_challenge',
      { p_challenge_id: challengeId, p_accept: accept },
      accessToken
    );
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase.rpc('respond_group_challenge', {
    p_challenge_id: challengeId,
    p_accept: accept,
  });
  if (error) return { data: null, error: error.message };
  return { data: data as DbGroupChallenge, error: null };
}

export async function cancelGroupChallenge(
  challengeId: string,
  accessToken?: string
): Promise<{ data: DbGroupChallenge | null; error: string | null }> {
  if (accessToken) {
    return restRpc<DbGroupChallenge>(
      'cancel_group_challenge',
      { p_challenge_id: challengeId },
      accessToken
    );
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase.rpc('cancel_group_challenge', {
    p_challenge_id: challengeId,
  });
  if (error) return { data: null, error: error.message };
  return { data: data as DbGroupChallenge, error: null };
}

export async function activateGroupChallenge(
  challengeId: string,
  accessToken?: string
): Promise<{ data: DbGroupChallenge | null; error: string | null }> {
  if (accessToken) {
    return restRpc<DbGroupChallenge>(
      'activate_group_challenge',
      { p_challenge_id: challengeId },
      accessToken
    );
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase.rpc('activate_group_challenge', {
    p_challenge_id: challengeId,
  });
  if (error) return { data: null, error: error.message };
  return { data: data as DbGroupChallenge, error: null };
}

export async function submitGroupChallengeRound(params: {
  challengeId: string;
  rosterEntryId: string;
  roundId: string | null;
  grossScore: number;
  netScore: number;
  courseRating?: number | null;
  slope?: number | null;
  coursePar?: number | null;
  teeName?: string | null;
  evidencePath?: string | null;
  verificationMode: GroupChallengeVerificationMode;
  accessToken?: string;
}): Promise<{ data: DbGroupChallengeRound | null; error: string | null }> {
  const payload = {
    challenge_id: params.challengeId,
    roster_entry_id: params.rosterEntryId,
    round_id: params.roundId,
    gross_score: params.grossScore,
    net_score: params.netScore,
    course_rating: params.courseRating ?? null,
    slope: params.slope ?? null,
    course_par: params.coursePar ?? null,
    tee_name: params.teeName ?? null,
    evidence_path: params.evidencePath ?? null,
    // Casual: counts immediately as verified for standings; Verified waits for admin.
    verification_status:
      params.verificationMode === 'casual' ? ('verified' as const) : ('pending' as const),
  };

  if (params.accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    const res = await fetch(`${supabaseUrl}/rest/v1/group_challenge_rounds`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify([payload]),
    });
    if (!res.ok) return { data: null, error: await res.text().catch(() => res.statusText) };
    const rows = (await res.json()) as DbGroupChallengeRound[];
    return { data: rows[0] ?? null, error: null };
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('group_challenge_rounds')
    .insert(payload)
    .select('*')
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as DbGroupChallengeRound, error: null };
}

export async function attachChallengeRoundEvidence(params: {
  roundId: string;
  evidencePath: string;
  accessToken?: string;
}): Promise<{ error: string | null }> {
  const body = { evidence_path: params.evidencePath };
  if (params.accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    const res = await fetch(
      `${supabaseUrl}/rest/v1/group_challenge_rounds?id=eq.${encodeURIComponent(params.roundId)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) return { error: await res.text().catch(() => res.statusText) };
    return { error: null };
  }
  if (!supabase) return { error: 'Supabase is not configured' };
  const { error } = await supabase
    .from('group_challenge_rounds')
    .update(body)
    .eq('id', params.roundId);
  return { error: error?.message ?? null };
}

export async function verifyGroupChallengeRound(
  roundId: string,
  approve: boolean,
  notes?: string,
  accessToken?: string
): Promise<{ data: DbGroupChallengeRound | null; error: string | null }> {
  if (accessToken) {
    return restRpc<DbGroupChallengeRound>(
      'verify_group_challenge_round',
      { p_round_id: roundId, p_approve: approve, p_notes: notes ?? null },
      accessToken
    );
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase.rpc('verify_group_challenge_round', {
    p_round_id: roundId,
    p_approve: approve,
    p_notes: notes ?? null,
  });
  if (error) return { data: null, error: error.message };
  return { data: data as DbGroupChallengeRound, error: null };
}

export async function disputeGroupChallengeRound(
  roundId: string,
  reason: string,
  accessToken?: string
): Promise<{ data: DbGroupChallengeRound | null; error: string | null }> {
  if (accessToken) {
    return restRpc<DbGroupChallengeRound>(
      'dispute_group_challenge_round',
      { p_round_id: roundId, p_reason: reason },
      accessToken
    );
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase.rpc('dispute_group_challenge_round', {
    p_round_id: roundId,
    p_reason: reason,
  });
  if (error) return { data: null, error: error.message };
  return { data: data as DbGroupChallengeRound, error: null };
}

export async function finalizeGroupChallenge(
  challengeId: string,
  accessToken?: string
): Promise<{ data: DbGroupChallenge | null; error: string | null }> {
  if (accessToken) {
    return restRpc<DbGroupChallenge>(
      'finalize_group_challenge',
      { p_challenge_id: challengeId },
      accessToken
    );
  }
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase.rpc('finalize_group_challenge', {
    p_challenge_id: challengeId,
  });
  if (error) return { data: null, error: error.message };
  return { data: data as DbGroupChallenge, error: null };
}

export async function withdrawRosterPlayer(params: {
  rosterEntryId: string;
  accessToken?: string;
}): Promise<{ error: string | null }> {
  const body = {
    eligibility_status: 'withdrawn',
    withdrawn_at: new Date().toISOString(),
  };
  if (params.accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    const res = await fetch(
      `${supabaseUrl}/rest/v1/group_challenge_rosters?id=eq.${encodeURIComponent(params.rosterEntryId)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) return { error: await res.text().catch(() => res.statusText) };
    return { error: null };
  }
  if (!supabase) return { error: 'Supabase is not configured' };
  const { error } = await supabase
    .from('group_challenge_rosters')
    .update(body)
    .eq('id', params.rosterEntryId);
  return { error: error?.message ?? null };
}
