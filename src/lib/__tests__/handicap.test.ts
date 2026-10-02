import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  adjustedDifferentialForVersion,
  CURRENT_DIFFERENTIAL_VERSION,
  difficultyProduct,
  formatDifferentialDisplay,
  formatHandicapIndexDisplay,
  handicapIndexFromDifferentials,
  normalizeMulligans,
  rawDifferential,
} from '../handicap';

describe('mulligan compatibility', () => {
  it('normalizes current tiers and legacy values', () => {
    const cases = [
      ['none', 'none'],
      ['off', 'none'],
      ['', 'none'],
      ['one', 'one'],
      ['on', 'one'],
      ['1', 'one'],
      ['two', 'two'],
      ['2', 'two'],
      ['three_plus', 'three_plus'],
      ['3+', 'three_plus'],
      ['3plus', 'three_plus'],
      ['three', 'three_plus'],
      ['unexpected', 'none'],
    ] as const;

    for (const [input, expected] of cases) {
      assert.equal(normalizeMulligans(input), expected, input);
    }
  });
});

describe('difficulty and differential regression fixtures', () => {
  it('pins representative condition multipliers', () => {
    assert.equal(difficultyProduct('putt_all', 'sun', 'strong', 'none'), 0.88);
    assert.equal(difficultyProduct('auto_2putt', 'thu', 'off', 'three_plus'), 1.870176);
  });

  it('pins the version 1 differential calculation', () => {
    assert.equal(CURRENT_DIFFERENTIAL_VERSION, 1);
    assert.equal(rawDifferential(82, 72, 120), 1130 / 120);
    assert.deepEqual(
      adjustedDifferentialForVersion(
        1,
        82,
        72,
        120,
        'auto_2putt',
        'thu',
        'off',
        'three_plus'
      ),
      { raw: 9.4, adjusted: 17.6, modifier: 1.87 }
    );
  });

  it('returns a zero differential for an invalid slope', () => {
    assert.equal(rawDifferential(82, 72, 0), 0);
    assert.equal(rawDifferential(82, 72, -1), 0);
  });
});

describe('handicap index regression fixtures', () => {
  it('uses only the last 20 differentials and averages their best 8', () => {
    const chronological = Array.from({ length: 25 }, (_, index) => index + 1);
    // Last 20 are 6..25; best eight average to 9.5, then the current 0.96 factor applies.
    assert.equal(handicapIndexFromDifferentials(chronological), 9.1);
  });

  it('uses every available differential when fewer than eight exist', () => {
    assert.equal(handicapIndexFromDifferentials([10, 12, 14]), 11.5);
    assert.equal(handicapIndexFromDifferentials([]), null);
  });

  it('formats below-scratch values with golf plus notation', () => {
    assert.equal(formatHandicapIndexDisplay(-2.14), '+2.1');
    assert.equal(formatDifferentialDisplay(-10.86), '+10.9');
    assert.equal(formatHandicapIndexDisplay(4.34), '4.3');
    assert.equal(formatHandicapIndexDisplay(null), '—');
  });
});
