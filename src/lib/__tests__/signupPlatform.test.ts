/**
 * signup_platform normalize helpers.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSignupPlatform } from '../signupPlatform';

describe('normalizeSignupPlatform', () => {
  it('accepts ios/android/web (case-insensitive)', () => {
    assert.equal(normalizeSignupPlatform('ios'), 'ios');
    assert.equal(normalizeSignupPlatform('Android'), 'android');
    assert.equal(normalizeSignupPlatform(' WEB '), 'web');
  });

  it('rejects other values', () => {
    assert.equal(normalizeSignupPlatform('macos'), null);
    assert.equal(normalizeSignupPlatform(''), null);
    assert.equal(normalizeSignupPlatform(null), null);
  });
});
