/**
 * Pending referral code helpers (OAuth / deep-link attribution).
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReferralCode, parseReferralCodeFromUrl } from '../referralCodeNormalize';

describe('normalizeReferralCode', () => {
  it('trims and lowercases', () => {
    assert.equal(normalizeReferralCode('  KevinMaust  '), 'kevinmaust');
  });

  it('returns null for blank', () => {
    assert.equal(normalizeReferralCode(''), null);
    assert.equal(normalizeReferralCode('   '), null);
    assert.equal(normalizeReferralCode(null), null);
    assert.equal(normalizeReferralCode(undefined), null);
  });
});

describe('parseReferralCodeFromUrl', () => {
  it('reads ref from query', () => {
    assert.equal(
      parseReferralCodeFromUrl('https://app.sim-cap.com/sign-up?ref=KevinMaust'),
      'kevinmaust'
    );
  });

  it('reads referral / referral_code aliases', () => {
    assert.equal(
      parseReferralCodeFromUrl('simcap://sign-up?referral=PartnerOne'),
      'partnerone'
    );
    assert.equal(
      parseReferralCodeFromUrl('https://app.sim-cap.com/?referral_code=ABC'),
      'abc'
    );
  });

  it('returns null when absent', () => {
    assert.equal(parseReferralCodeFromUrl('https://app.sim-cap.com/sign-up'), null);
    assert.equal(parseReferralCodeFromUrl(''), null);
  });
});
