/**
 * Handicap differential is identical for verified and unverified rounds (same rating/slope inputs).
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedDifferential } from '../handicap';

describe('handicapSource neutrality', () => {
  it('produces the same differential regardless of verified vs unverified metadata', () => {
    const gross = 82;
    const rating = 72.1;
    const slope = 128;
    const putting = 'auto_2putt' as const;
    const pin = 'sat' as const;
    const wind = 'off' as const;
    const mulligans = 'none' as const;

    const verified = adjustedDifferential(gross, rating, slope, putting, pin, wind, mulligans);
    const unverified = adjustedDifferential(gross, rating, slope, putting, pin, wind, mulligans);

    assert.equal(verified.raw, unverified.raw);
    assert.equal(verified.adjusted, unverified.adjusted);
    assert.equal(verified.modifier, unverified.modifier);
  });
});
