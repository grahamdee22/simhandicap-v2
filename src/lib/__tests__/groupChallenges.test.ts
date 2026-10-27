/**
 * Group Challenges pure helpers
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHandicapSnapshot,
  canSubmitChallengeRound,
  challengeResultLabel,
  challengeRoundBadgeKey,
  friendlyChallengeError,
  GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS,
  isGroupChallengeRosterEligible,
  markGroupChallengeBundleDirty,
  netScoreForGroupChallengeRound,
  opponentGroupId,
  opposingRosterUserIds,
  qualifyingRoundsCount,
  resolveChallengeViewGroupId,
  rosterEligibilityForPlayer,
  takeGroupChallengeBundleDirty,
  teamTotalFromRounds,
  type GroupChallengeLike,
} from '../groupChallengeHelpers';
import type { SimRound } from '../../store/useAppStore';

function round(adjustedDiff: number, id: string, opts?: { excludes?: boolean }): SimRound {
  return {
    id,
    courseId: 'pebble',
    courseName: 'Pebble',
    platform: 'GSPro',
    grossScore: 82,
    holeScores: Array(18).fill(4),
    putting: 'auto_2putt',
    pin: 'sat',
    wind: 'off',
    mulligans: 'none',
    playedAt: `2026-01-0${id}T12:00:00.000Z`,
    courseRating: 72.1,
    slope: 128,
    rawDiff: 5,
    adjustedDiff,
    difficultyModifier: 1,
    indexAfter: null,
    indexDelta: null,
    excludesFromSimcapIndex: opts?.excludes,
  };
}

function challenge(partial: Partial<GroupChallengeLike> = {}): GroupChallengeLike {
  return {
    challenging_group_id: 'g1',
    challenged_group_id: 'g2',
    status: 'active',
    start_date: '2026-01-01',
    end_date: '2026-01-31',
    ...partial,
  };
}

describe('groupChallenges eligibility', () => {
  it('requires 5 qualifying rounds', () => {
    const four = [1, 2, 3, 4].map((n) => round(10, String(n)));
    assert.equal(isGroupChallengeRosterEligible(four), false);
    assert.equal(rosterEligibilityForPlayer(four).missing, 1);

    const five = [...four, round(10, '5')];
    assert.equal(isGroupChallengeRosterEligible(five), true);
    assert.equal(GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS, 5);
  });

  it('ignores rounds excluded from SimCap index', () => {
    const rounds = [
      round(10, '1'),
      round(10, '2'),
      round(10, '3'),
      round(10, '4'),
      round(10, '5', { excludes: true }),
    ];
    assert.equal(qualifyingRoundsCount(rounds), 4);
    assert.equal(isGroupChallengeRosterEligible(rounds), false);
  });
});

describe('groupChallenges handicap snapshot', () => {
  it('uses SimCap when established, else GHIN', () => {
    const established = [1, 2, 3].map((n) => round(12, String(n)));
    const snap = buildHandicapSnapshot({ rounds: established, ghinIndex: 20 });
    assert.equal(snap.handicap_source, 'simcap');
    assert.ok(snap.handicap_snapshot != null);

    const few = [round(12, '1')];
    const ghin = buildHandicapSnapshot({ rounds: few, ghinIndex: 18.5 });
    assert.equal(ghin.handicap_source, 'ghin');
    assert.equal(ghin.handicap_snapshot, 18.5);
  });
});

describe('groupChallenges scoring', () => {
  it('nets from snapshot, not live index', () => {
    const net = netScoreForGroupChallengeRound({
      gross: 90,
      handicapSnapshot: 10,
      courseRating: 72,
      slope: 113,
      coursePar: 72,
    });
    assert.equal(net, 80);
  });

  it('team totals respect verification mode', () => {
    const rounds = [
      { net_score: 70, verification_status: 'verified' as const },
      { net_score: 72, verification_status: 'pending' as const },
      { net_score: 99, verification_status: 'rejected' as const },
    ];
    assert.equal(teamTotalFromRounds(rounds, 'verified'), 70);
    assert.equal(teamTotalFromRounds(rounds, 'casual'), 142);
  });
});

describe('groupChallenges create errors', () => {
  it('maps RLS insert failures to a clear message', () => {
    const msg = friendlyChallengeError(
      'new row violates row-level security policy for table "group_challenges"'
    );
    assert.match(msg, /permission denied/i);
  });

  it('maps duplicate roster user to a clear one-side-only message', () => {
    const msg = friendlyChallengeError(
      'duplicate key value violates unique constraint "group_challenge_rosters_challenge_id_user_id_key"'
    );
    assert.match(msg, /one side/i);
  });

  it('lists opposing roster users for the picker', () => {
    const taken = opposingRosterUserIds(
      [
        { user_id: 'a1', group_id: 'gA' },
        { user_id: 'b1', group_id: 'gB' },
        { user_id: 'b2', group_id: 'gB', withdrawn_at: '2026-01-01' },
      ],
      'gB'
    );
    assert.equal(taken.has('a1'), true);
    assert.equal(taken.has('b1'), false);
    assert.equal(taken.has('b2'), false);
  });
});

describe('groupChallenges flow guards', () => {
  it('blocks second official round and out-of-window play', () => {
    const roster = {
      eligibility_status: 'eligible' as const,
      withdrawn_at: null,
      handicap_snapshot: 12,
    };
    assert.equal(
      canSubmitChallengeRound({
        challenge: challenge(),
        roster,
        existingRound: null,
        todayYmd: '2026-01-15',
      }).ok,
      true
    );
    assert.equal(
      canSubmitChallengeRound({
        challenge: challenge(),
        roster,
        existingRound: { id: 'x' },
        todayYmd: '2026-01-15',
      }).ok,
      false
    );
    assert.equal(
      canSubmitChallengeRound({
        challenge: challenge(),
        roster,
        existingRound: null,
        todayYmd: '2025-12-01',
      }).ok,
      false
    );
  });

  it('labels results for history', () => {
    assert.equal(
      challengeResultLabel({
        status: 'completed',
        myGroupId: 'g1',
        winnerGroupId: 'g1',
      }),
      'win'
    );
    assert.equal(
      challengeResultLabel({
        status: 'completed',
        myGroupId: 'g1',
        winnerGroupId: null,
      }),
      'tie'
    );
    assert.equal(opponentGroupId(challenge(), 'g1'), 'g2');
  });
});

describe('groupChallenges polish helpers', () => {
  it('shows Counted badge for casual counting rounds, Verified only in verified mode', () => {
    assert.equal(challengeRoundBadgeKey('verified', 'casual'), 'counted');
    assert.equal(challengeRoundBadgeKey('pending', 'casual'), 'counted');
    assert.equal(challengeRoundBadgeKey('rejected', 'casual'), 'rejected');
    assert.equal(challengeRoundBadgeKey('verified', 'verified'), 'verified');
    assert.equal(challengeRoundBadgeKey('pending', 'verified'), 'pending');
  });

  it('resolves view side from fromGroupId for dual members', () => {
    assert.equal(
      resolveChallengeViewGroupId({
        challengingGroupId: 'gA',
        challengedGroupId: 'gB',
        fromGroupId: 'gB',
        rosterGroupId: null,
        memberGroupIds: ['gA', 'gB'],
      }),
      'gB'
    );
    assert.equal(
      resolveChallengeViewGroupId({
        challengingGroupId: 'gA',
        challengedGroupId: 'gB',
        fromGroupId: null,
        rosterGroupId: null,
        memberGroupIds: ['gA', 'gB'],
      }),
      'gA'
    );
    assert.equal(
      resolveChallengeViewGroupId({
        challengingGroupId: 'gA',
        challengedGroupId: 'gB',
        fromGroupId: 'gOther',
        rosterGroupId: 'gB',
        memberGroupIds: ['gA', 'gB'],
      }),
      'gB'
    );
  });

  it('tracks dirty challenge ids for post-mutation refetch', () => {
    markGroupChallengeBundleDirty('c1');
    assert.equal(takeGroupChallengeBundleDirty('c1'), true);
    assert.equal(takeGroupChallengeBundleDirty('c1'), false);
    assert.equal(takeGroupChallengeBundleDirty('missing'), false);
  });
});
