/**
 * Pure Group Challenge helpers (no Supabase / RN) — unit-testable.
 */

import { resolveEffectiveHandicap } from './effectiveHandicap';
import { netScoreForLeagueRound } from './netHandicap';
import type { SimRound } from '../store/useAppStore';

export const GROUP_CHALLENGE_ROSTER_SIZE = 5;
/** Minimum counting SimCap rounds to be roster-eligible (sandbagging guard). */
export const GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS = 5;

export type GroupChallengeStatus =
  | 'pending'
  | 'declined'
  | 'accepted'
  | 'active'
  | 'completed'
  | 'canceled'
  | 'disputed';

export type GroupChallengeVerificationMode = 'verified' | 'casual';

export type GroupChallengeEligibility = 'eligible' | 'ineligible' | 'withdrawn';

export type GroupChallengeRoundVerification =
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'disputed';

export type GroupChallengeLike = {
  challenging_group_id: string;
  challenged_group_id: string;
  status: GroupChallengeStatus;
  start_date: string;
  end_date: string;
};

export type RosterLike = {
  eligibility_status: GroupChallengeEligibility;
  withdrawn_at: string | null;
  handicap_snapshot: number | null;
};

export type RoundScoreLike = {
  net_score: number;
  verification_status: GroupChallengeRoundVerification;
};

/** Counting SimCap rounds (excludes practice / excluded-from-index). */
export function qualifyingRoundsCount(rounds: SimRound[]): number {
  return rounds.filter((r) => !r.excludesFromSimcapIndex).length;
}

export function isGroupChallengeRosterEligible(rounds: SimRound[]): boolean {
  return qualifyingRoundsCount(rounds) >= GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS;
}

export type RosterEligibilityInfo = {
  eligible: boolean;
  qualifyingRounds: number;
  required: number;
  missing: number;
};

export function rosterEligibilityForPlayer(rounds: SimRound[]): RosterEligibilityInfo {
  const qualifyingRounds = qualifyingRoundsCount(rounds);
  const required = GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS;
  const missing = Math.max(0, required - qualifyingRounds);
  return {
    eligible: qualifyingRounds >= required,
    qualifyingRounds,
    required,
    missing,
  };
}

export function buildHandicapSnapshot(params: {
  rounds: SimRound[];
  ghinIndex: number | null | undefined;
}): {
  handicap_snapshot: number | null;
  handicap_source: 'simcap' | 'ghin' | null;
  qualifying_rounds_count: number;
  snapshot_context: Record<string, unknown>;
} {
  const qualifying = qualifyingRoundsCount(params.rounds);
  const resolved = resolveEffectiveHandicap({
    rounds: params.rounds,
    ghinIndex: params.ghinIndex,
  });
  return {
    handicap_snapshot: resolved.index,
    handicap_source: resolved.source,
    qualifying_rounds_count: qualifying,
    snapshot_context: {
      source: resolved.source,
      qualifying_rounds_count: qualifying,
      min_qualifying_rounds: GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS,
    },
  };
}

/** Net from snapshotted index — never live index. */
export function netScoreForGroupChallengeRound(params: {
  gross: number;
  handicapSnapshot: number | null;
  courseRating?: number | null;
  slope?: number | null;
  coursePar?: number | null;
  holesPlayed?: '18' | 'front' | 'back';
}): number {
  return netScoreForLeagueRound(
    params.gross,
    true,
    params.handicapSnapshot,
    {
      courseRating: params.courseRating,
      slope: params.slope,
      coursePar: params.coursePar,
    },
    params.holesPlayed ?? '18'
  );
}

export function teamTotalFromRounds(
  rounds: RoundScoreLike[],
  mode: GroupChallengeVerificationMode
): number {
  return rounds
    .filter((r) =>
      mode === 'verified'
        ? r.verification_status === 'verified'
        : r.verification_status === 'verified' || r.verification_status === 'pending'
    )
    .reduce((sum, r) => sum + Number(r.net_score), 0);
}

export function challengeResultLabel(params: {
  status: GroupChallengeStatus;
  myGroupId: string;
  winnerGroupId: string | null;
}): 'win' | 'loss' | 'tie' | 'pending' | 'declined' | 'canceled' | 'disputed' {
  const { status, myGroupId, winnerGroupId } = params;
  if (status === 'declined') return 'declined';
  if (status === 'canceled') return 'canceled';
  if (status === 'disputed') return 'disputed';
  if (status !== 'completed') return 'pending';
  if (winnerGroupId == null) return 'tie';
  return winnerGroupId === myGroupId ? 'win' : 'loss';
}

export function opponentGroupId(
  challenge: Pick<GroupChallengeLike, 'challenging_group_id' | 'challenged_group_id'>,
  myGroupId: string
): string {
  return challenge.challenging_group_id === myGroupId
    ? challenge.challenged_group_id
    : challenge.challenging_group_id;
}

/**
 * Which side of a challenge the viewer should act as.
 * Prefers explicit navigation context (fromGroupId), then roster side, then
 * challenging membership (sender) before challenged — dual members need a stable pick.
 */
export function resolveChallengeViewGroupId(params: {
  challengingGroupId: string;
  challengedGroupId: string;
  fromGroupId?: string | null;
  rosterGroupId?: string | null;
  memberGroupIds: string[];
}): string {
  const {
    challengingGroupId,
    challengedGroupId,
    fromGroupId,
    rosterGroupId,
    memberGroupIds,
  } = params;
  const members = new Set(memberGroupIds);
  const inChallenge = (gid: string) =>
    gid === challengingGroupId || gid === challengedGroupId;

  if (fromGroupId && inChallenge(fromGroupId) && members.has(fromGroupId)) {
    return fromGroupId;
  }
  if (rosterGroupId && inChallenge(rosterGroupId) && members.has(rosterGroupId)) {
    return rosterGroupId;
  }
  if (members.has(challengingGroupId)) return challengingGroupId;
  if (members.has(challengedGroupId)) return challengedGroupId;
  return '';
}

/**
 * Badge key for a challenge round. Casual rounds are stored as `verified` for
 * standings but should display as "Counted", not "Verified".
 */
export function challengeRoundBadgeKey(
  status: GroupChallengeRoundVerification,
  mode: GroupChallengeVerificationMode
): 'counted' | GroupChallengeRoundVerification {
  if (mode === 'casual' && (status === 'verified' || status === 'pending')) {
    return 'counted';
  }
  return status;
}

/** Dirty flags so detail screens refetch after mutations that navigate away. */
const dirtyChallengeIds = new Set<string>();

export function markGroupChallengeBundleDirty(challengeId: string): void {
  if (challengeId) dirtyChallengeIds.add(challengeId);
}

export function takeGroupChallengeBundleDirty(challengeId: string): boolean {
  if (!challengeId || !dirtyChallengeIds.has(challengeId)) return false;
  dirtyChallengeIds.delete(challengeId);
  return true;
}

/** Extract a readable message from a PostgREST / RPC error body. */
export function friendlyChallengeError(raw: string | null | undefined): string {
  if (!raw) return '';
  const text = raw.trim();
  if (/row-level security|42501|violates row-level/i.test(text)) {
    return 'Could not create challenge (permission denied). Confirm you admin the challenging group and try again.';
  }
  if (
    /group_challenge_rosters_challenge_id_user_id_key|duplicate key.*user_id|23505/i.test(text)
  ) {
    return 'A player can only represent one side of a challenge. Remove anyone already on the opposing roster and try again.';
  }
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string; code?: string };
      if (parsed.code === '23505' || /duplicate key/i.test(parsed.message ?? '')) {
        return 'A player can only represent one side of a challenge. Remove anyone already on the opposing roster and try again.';
      }
      if (parsed.message) return parsed.message;
      if (parsed.error) return parsed.error;
    } catch {
      /* fall through */
    }
  }
  return text;
}

/** Users already rostered for a challenge (any side) cannot be added to the other side. */
export function opposingRosterUserIds(
  rosters: { user_id: string; group_id: string; withdrawn_at?: string | null }[],
  myGroupId: string
): Set<string> {
  const out = new Set<string>();
  for (const r of rosters) {
    if (r.withdrawn_at) continue;
    if (r.group_id !== myGroupId) out.add(r.user_id);
  }
  return out;
}

export function canSubmitChallengeRound(params: {
  challenge: GroupChallengeLike;
  roster: RosterLike | null;
  existingRound: unknown | null;
  todayYmd: string;
}): { ok: boolean; reason?: string } {
  const { challenge, roster, existingRound, todayYmd } = params;
  if (challenge.status !== 'active') {
    return { ok: false, reason: 'Challenge is not active' };
  }
  if (todayYmd < challenge.start_date || todayYmd > challenge.end_date) {
    return { ok: false, reason: 'Outside the challenge window' };
  }
  if (!roster || roster.eligibility_status !== 'eligible' || roster.withdrawn_at) {
    return { ok: false, reason: 'You are not on an eligible roster' };
  }
  if (roster.handicap_snapshot == null) {
    return { ok: false, reason: 'Handicap snapshot missing' };
  }
  if (existingRound) {
    return { ok: false, reason: 'You already submitted your official round' };
  }
  return { ok: true };
}
