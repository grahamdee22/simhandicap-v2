/**
 * referral_source normalize helpers.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReferralSource } from '../referralSource';

describe('normalizeReferralSource', () => {
  it('accepts link and typed', () => {
    assert.equal(normalizeReferralSource('link'), 'link');
    assert.equal(normalizeReferralSource('TYPED'), 'typed');
  });

  it('rejects other values', () => {
    assert.equal(normalizeReferralSource('organic'), null);
    assert.equal(normalizeReferralSource(''), null);
    assert.equal(normalizeReferralSource(null), null);
  });
});
