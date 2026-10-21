/**
 * Typed vs link referral precedence.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReferralAttribution } from '../resolveReferralAttribution';

describe('resolveReferralAttribution', () => {
  it('typed kevin overrides a different link channel', () => {
    assert.deepEqual(
      resolveReferralAttribution({ fieldValue: ' Kevin ', linkCode: 'reddit' }),
      { code: 'kevin', source: 'typed' }
    );
  });

  it('unchanged kevin link prefill stays link (not typed)', () => {
    assert.deepEqual(
      resolveReferralAttribution({ fieldValue: 'kevin', linkCode: 'kevin' }),
      { code: 'kevin', source: 'link' }
    );
  });

  it('organic typed kevin (no link) is typed', () => {
    assert.deepEqual(
      resolveReferralAttribution({ fieldValue: 'kevin', linkCode: null }),
      { code: 'kevin', source: 'typed' }
    );
  });

  it('non-kevin typed is ignored when a link channel exists', () => {
    assert.deepEqual(
      resolveReferralAttribution({ fieldValue: 'asdf', linkCode: 'reddit' }),
      { code: 'reddit', source: 'link' }
    );
    assert.deepEqual(
      resolveReferralAttribution({ fieldValue: 'email', linkCode: 'reddit' }),
      { code: 'reddit', source: 'link' }
    );
  });

  it('unchanged link prefill stays link', () => {
    assert.deepEqual(
      resolveReferralAttribution({ fieldValue: 'reddit', linkCode: 'reddit' }),
      { code: 'reddit', source: 'link' }
    );
  });

  it('typed only (no link) uses the typed value', () => {
    assert.deepEqual(
      resolveReferralAttribution({ fieldValue: 'homepage', linkCode: null }),
      { code: 'homepage', source: 'typed' }
    );
    assert.deepEqual(
      resolveReferralAttribution({ fieldValue: 'typo123', linkCode: undefined }),
      { code: 'typo123', source: 'typed' }
    );
  });

  it('empty field uses link when present', () => {
    assert.deepEqual(
      resolveReferralAttribution({ fieldValue: '', linkCode: 'email' }),
      { code: 'email', source: 'link' }
    );
  });

  it('returns null when neither is present', () => {
    assert.equal(resolveReferralAttribution({ fieldValue: '', linkCode: null }), null);
  });
});
