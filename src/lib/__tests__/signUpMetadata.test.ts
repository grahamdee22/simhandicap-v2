/**
 * Signup metadata payload for referral attribution.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSignUpUserMetadata } from '../signUpMetadata';

describe('buildSignUpUserMetadata', () => {
  it('includes referral_code when provided', () => {
    const data = buildSignUpUserMetadata('Jordan P.', 'KevinMaust');
    assert.equal(data.display_name, 'Jordan P.');
    assert.equal(data.referral_code, 'kevinmaust');
    assert.deepEqual(Object.keys(data).sort(), ['display_name', 'referral_code']);
  });

  it('omits referral_code when blank or missing', () => {
    assert.deepEqual(buildSignUpUserMetadata('Jordan', ''), { display_name: 'Jordan' });
    assert.deepEqual(buildSignUpUserMetadata('Jordan', '   '), { display_name: 'Jordan' });
    assert.deepEqual(buildSignUpUserMetadata('Jordan'), { display_name: 'Jordan' });
    assert.equal('referral_code' in buildSignUpUserMetadata('Jordan', undefined), false);
  });

  it('falls back display_name to Golfer when empty', () => {
    assert.equal(buildSignUpUserMetadata('  ').display_name, 'Golfer');
  });
});
