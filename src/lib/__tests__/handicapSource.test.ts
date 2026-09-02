/**
 * Course verified/unverified metadata must not change differential or index math.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedDifferential, handicapIndexFromDifferentials } from '../handicap';
import { simcapIndexWhenEstablished } from '../effectiveHandicap';
import type { SimRound } from '../../store/useAppStore';

type HandicapSource = 'verified' | 'unverified';

function mkRound(
  adjustedDiff: number,
  id: string,
  handicapSource: HandicapSource,
  playedAt: string
): SimRound {
  return {
    id,
    courseId: 'community-uuid',
    courseName: 'Test Community Course',
    platform: 'GSPro',
    grossScore: 82,
    holeScores: Array(18).fill(4),
    putting: 'auto_2putt',
    pin: 'sat',
    wind: 'off',
    mulligans: 'none',
    playedAt,
    courseRating: 72,
    slope: 128,
    rawDiff: adjustedDiff,
    adjustedDiff,
    difficultyModifier: 1,
    indexAfter: null,
    indexDelta: null,
    handicapSource,
  };
}

/** Mirrors currentIndexFromRounds / roundsForSimcapIndex without importing the store (RN). */
function indexFromRounds(rounds: SimRound[]): number | null {
  const sorted = rounds
    .filter((r) => !r.excludesFromSimcapIndex)
    .sort((a, b) => new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime());
  return handicapIndexFromDifferentials(sorted.map((r) => r.adjustedDiff));
}

describe('handicapSource neutrality', () => {
  it('produces the same differential for identical rating/slope inputs', () => {
    const gross = 82;
    const rating = 72.1;
    const slope = 128;
    const putting = 'auto_2putt' as const;
    const pin = 'sat' as const;
    const wind = 'off' as const;
    const mulligans = 'none' as const;

    const a = adjustedDifferential(gross, rating, slope, putting, pin, wind, mulligans);
    const b = adjustedDifferential(gross, rating, slope, putting, pin, wind, mulligans);

    assert.equal(a.raw, b.raw);
    assert.equal(a.adjusted, b.adjusted);
    assert.equal(a.modifier, b.modifier);
  });

  it('counts verified and unverified rounds identically toward SimCap index', () => {
    const diffs = [8.1, 9.2, 7.5, 10.0, 8.8, 9.1, 7.9, 8.3, 9.0, 8.5];
    const playedAts = diffs.map((_, i) => `2026-01-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`);

    const verified = diffs.map((d, i) => mkRound(d, `v-${i}`, 'verified', playedAts[i]));
    const unverified = diffs.map((d, i) => mkRound(d, `u-${i}`, 'unverified', playedAts[i]));
    const mixed = diffs.map((d, i) =>
      mkRound(d, `m-${i}`, i % 2 === 0 ? 'verified' : 'unverified', playedAts[i])
    );

    const indexVerified = indexFromRounds(verified);
    const indexUnverified = indexFromRounds(unverified);
    const indexMixed = indexFromRounds(mixed);

    assert.equal(indexVerified, indexUnverified);
    assert.equal(indexVerified, indexMixed);
    assert.notEqual(indexVerified, null);

    const establishedVerified = simcapIndexWhenEstablished(verified);
    const establishedUnverified = simcapIndexWhenEstablished(unverified);
    const establishedMixed = simcapIndexWhenEstablished(mixed);

    assert.equal(establishedVerified, establishedUnverified);
    assert.equal(establishedVerified, establishedMixed);
    assert.equal(establishedVerified, indexVerified);
  });
});
