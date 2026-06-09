/**
 * Effective handicap (SimCap vs GHIN) for tournaments
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getEffectiveHandicap,
  resolveEffectiveHandicap,
  simcapIndexWhenEstablished,
  SIMCAP_INDEX_MIN_ROUNDS,
} from '../effectiveHandicap';
import type { SimRound } from '../../store/useAppStore';

function round(adjustedDiff: number, id = '1'): SimRound {
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
    mulligans: 'off',
    playedAt: '2026-01-01T12:00:00.000Z',
    courseRating: 72.1,
    slope: 128,
    rawDiff: 5,
    adjustedDiff,
    difficultyModifier: 1,
    indexAfter: null,
    indexDelta: null,
  };
}

describe('effectiveHandicap', () => {
  it('requires 3+ rounds before using SimCap index', () => {
    assert.equal(SIMCAP_INDEX_MIN_ROUNDS, 3);
    assert.equal(simcapIndexWhenEstablished([round(10), round(11)]), null);
    assert.notEqual(
      simcapIndexWhenEstablished([round(10), round(11), round(12)]),
      null
    );
  });

  it('uses SimCap index when established', () => {
    const r = resolveEffectiveHandicap({
      rounds: [round(8.0, 'a'), round(9.0, 'b'), round(10.0, 'c')],
      ghinIndex: 14.2,
    });
    assert.equal(r.source, 'simcap');
    assert.notEqual(r.index, 14.2);
  });

  it('falls back to GHIN when fewer than 3 SimCap rounds', () => {
    const r = resolveEffectiveHandicap({
      rounds: [round(8.0)],
      ghinIndex: 12.4,
    });
    assert.equal(r.source, 'ghin');
    assert.equal(r.index, 12.4);
  });

  it('returns null when no SimCap history and no GHIN', () => {
    const r = resolveEffectiveHandicap({ rounds: [], ghinIndex: null });
    assert.equal(r.index, null);
    assert.equal(r.source, null);
  });

  it('getEffectiveHandicap looks up member roster', () => {
    const eff = getEffectiveHandicap('u2', [
      { userId: 'u1', index: 8.1, handicapSource: 'simcap' },
      { userId: 'u2', index: 15.0, handicapSource: 'ghin' },
    ]);
    assert.equal(eff.source, 'ghin');
    assert.equal(eff.index, 15);
  });
});
