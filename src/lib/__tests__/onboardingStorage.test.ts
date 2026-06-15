/**
 * Onboarding storage helpers
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onboardingFlagIsSeen } from '../onboardingStorage';

describe('onboardingStorage', () => {
  it('treats missing or unexpected values as not seen', () => {
    assert.equal(onboardingFlagIsSeen(null), false);
    assert.equal(onboardingFlagIsSeen(undefined), false);
    assert.equal(onboardingFlagIsSeen(''), false);
    assert.equal(onboardingFlagIsSeen('0'), false);
  });

  it('treats persisted "1" as seen', () => {
    assert.equal(onboardingFlagIsSeen('1'), true);
  });
});
