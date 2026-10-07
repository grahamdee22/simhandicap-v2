/**
 * Regression: rapid sequential logging must not record tournament net as gross
 * because a stale Log-screen `rounds` closure missed prior saves (KevinIGO case).
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveEffectiveHandicap,
  roundsForLeagueRecordingAfterSave,
} from '../effectiveHandicap';
import { netScoreForLeagueRound } from '../netHandicap';
import type { SimRound } from '../../store/useAppStore';

function leagueIndex(rounds: SimRound[]): number | null {
  return resolveEffectiveHandicap({ rounds, ghinIndex: null }).index;
}

function round(partial: {
  id: string;
  adjustedDiff: number;
  grossScore?: number;
  holesPlayed?: '18' | 'front' | 'back';
}): SimRound {
  return {
    id: partial.id,
    courseId: 'pebble',
    courseName: 'Pebble Beach Golf Links',
    platform: 'GSPro',
    grossScore: partial.grossScore ?? 80,
    holeScores: Array(18).fill(null),
    putting: 'auto_2putt',
    pin: 'thu',
    wind: 'off',
    mulligans: 'none',
    playedAt: '2026-10-06T12:00:00.000Z',
    courseRating: partial.holesPlayed && partial.holesPlayed !== '18' ? 36.05 : 72.1,
    slope: 128,
    rawDiff: partial.adjustedDiff,
    adjustedDiff: partial.adjustedDiff,
    difficultyModifier: 1,
    indexAfter: null,
    indexDelta: null,
    holesPlayed: partial.holesPlayed ?? '18',
  };
}

describe('roundsForLeagueRecordingAfterSave', () => {
  it('returns store rounds when saved is already present (post-addRound)', () => {
    const saved = round({ id: 'r3', adjustedDiff: 8.5 });
    const store = [saved, round({ id: 'r2', adjustedDiff: -0.1 }), round({ id: 'r1', adjustedDiff: 17.9 })];
    assert.equal(roundsForLeagueRecordingAfterSave(store, saved), store);
  });

  it('prepends saved when given a pre-add snapshot', () => {
    const saved = round({ id: 'r3', adjustedDiff: 8.5 });
    const prior = [round({ id: 'r2', adjustedDiff: -0.1 }), round({ id: 'r1', adjustedDiff: 17.9 })];
    const out = roundsForLeagueRecordingAfterSave(prior, saved);
    assert.equal(out.length, 3);
    assert.equal(out[0]?.id, 'r3');
  });
});

describe('rapid sequential logging → tournament simIndex', () => {
  /**
   * KevinIGO timeline (same calendar played_at, distinct created_at):
   *   r1 gross 92 diff 17.9 · r2 gross 72 diff -0.1 · r3 gross 47 (back 9) diff 8.5
   * Third round opted into stroke play; league_rounds.net_score was 47 (= gross).
   */
  const r1 = round({ id: 'r1', adjustedDiff: 17.9, grossScore: 92 });
  const r2 = round({ id: 'r2', adjustedDiff: -0.1, grossScore: 72 });
  const r3 = round({
    id: 'r3',
    adjustedDiff: 8.5,
    grossScore: 47,
    holesPlayed: 'back',
  });

  it('proves stale render closure yields null index on the 3rd save (bug)', () => {
    let renderRounds: SimRound[] = [];
    let storeRounds: SimRound[] = [];
    let buggyThird: number | null = null;

    for (const saved of [r1, r2, r3]) {
      // addRound updates the store synchronously before resolve
      storeRounds = [saved, ...storeRounds];
      // Log screen still holds the previous render's `rounds` (no remount / no paint)
      buggyThird = leagueIndex(renderRounds.concat(saved));
    }

    assert.equal(buggyThird, null);
    // That null index is exactly what makes net === gross
    assert.equal(
      netScoreForLeagueRound(47, true, buggyThird, {
        courseRating: 36.05,
        slope: 128,
        coursePar: 36,
      }, 'back'),
      47
    );
  });

  it('fixed path: store after each addRound establishes index on the 3rd save', () => {
    let storeRounds: SimRound[] = [];
    let fixedThird: number | null = null;

    for (const saved of [r1, r2, r3]) {
      storeRounds = [saved, ...storeRounds];
      fixedThird = leagueIndex(roundsForLeagueRecordingAfterSave(storeRounds, saved));
    }

    assert.notEqual(fixedThird, null);
    // Hand math ~ best-of diffs × 0.96 ≈ 8.4 (order-independent for these three)
    assert.ok(fixedThird! > 7 && fixedThird! < 10);

    const net = netScoreForLeagueRound(
      47,
      true,
      fixedThird,
      { courseRating: 36.05, slope: 128, coursePar: 36 },
      'back'
    );
    assert.ok(net < 47, `expected net < gross, got net=${net}`);
    // Roughly ~41 with CH from ~halved 8.4 index — allow a band for tee snap
    assert.ok(net <= 44, `expected net around low-40s, got ${net}`);
  });

  it('with a re-render between each save, concat(saved) still sees all three (unchanged happy path)', () => {
    let renderRounds: SimRound[] = [];
    let storeRounds: SimRound[] = [];
    let lastConcatIndex: number | null = null;

    for (const saved of [r1, r2, r3]) {
      storeRounds = [saved, ...storeRounds];
      // Render still has pre-add list; concat(saved) is the old log.tsx pattern
      lastConcatIndex = leagueIndex(renderRounds.concat(saved));
      renderRounds = storeRounds; // paint after save completes
    }

    assert.notEqual(lastConcatIndex, null);
  });
});
