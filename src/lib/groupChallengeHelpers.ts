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
