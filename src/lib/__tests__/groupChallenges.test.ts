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
  GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS,
  isGroupChallengeRosterEligible,
  netScoreForGroupChallengeRound,
  opponentGroupId,
  qualifyingRoundsCount,
  rosterEligibilityForPlayer,
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
