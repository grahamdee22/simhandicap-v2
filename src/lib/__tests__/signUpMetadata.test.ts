/**
 * Signup metadata payload for referral + platform + source attribution.
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

  it('includes platform when ios/android/web', () => {
    const ios = buildSignUpUserMetadata('Jordan', undefined, 'ios');
    assert.equal(ios.platform, 'ios');
    assert.deepEqual(Object.keys(ios).sort(), ['display_name', 'platform']);

    const android = buildSignUpUserMetadata('Jordan', 'kevin', 'android');
    assert.equal(android.platform, 'android');
    assert.equal(android.referral_code, 'kevin');

    const web = buildSignUpUserMetadata('Jordan', '', 'web');
    assert.equal(web.platform, 'web');
  });

  it('includes referral_source with a code', () => {
    const typed = buildSignUpUserMetadata('Jordan', 'kevin', 'ios', 'typed');
    assert.equal(typed.referral_source, 'typed');
    const link = buildSignUpUserMetadata('Jordan', 'kevin', 'android', 'link');
    assert.equal(link.referral_source, 'link');
  });

  it('omits referral_source without a code', () => {
    const data = buildSignUpUserMetadata('Jordan', undefined, 'ios', 'typed');
    assert.equal('referral_source' in data, false);
  });

  it('omits platform when invalid', () => {
    assert.equal('platform' in buildSignUpUserMetadata('Jordan', undefined, 'windows'), false);
    assert.equal('platform' in buildSignUpUserMetadata('Jordan', undefined, null), false);
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
