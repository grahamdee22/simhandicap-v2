/**
 * Play Install Referrer → channel parser (utm_source).
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aliasPlayChannel,
  isCampaignPlayChannel,
  parseChannelFromPlayInstallReferrer,
} from '../playInstallReferrer';

describe('parseChannelFromPlayInstallReferrer', () => {
  it('reads utm_source from query string (Option B)', () => {
    assert.equal(
      parseChannelFromPlayInstallReferrer('utm_source=kevin&utm_medium=campaign'),
      'kevin'
    );
    assert.equal(
      parseChannelFromPlayInstallReferrer('?utm_source=Reddit&utm_campaign=spring'),
      'reddit'
    );
  });

  it('reads encoded referrer form', () => {
    assert.equal(
      parseChannelFromPlayInstallReferrer('utm_source%3Dkevin%26utm_medium%3Dcpc'),
      'kevin'
    );
  });

  it('reads nested referrer=utm_source from a Play Store URL', () => {
    assert.equal(
      parseChannelFromPlayInstallReferrer(
        'https://play.google.com/store/apps/details?id=com.simcap.app&referrer=utm_source%3Dkevin'
      ),
      'kevin'
    );
    assert.equal(parseChannelFromPlayInstallReferrer('utm_source=partner_one'), 'partner_one');
  });

  it('returns null when utm_source absent', () => {
    assert.equal(parseChannelFromPlayInstallReferrer('utm_medium=organic'), null);
    assert.equal(parseChannelFromPlayInstallReferrer(''), null);
    assert.equal(parseChannelFromPlayInstallReferrer(null), null);
  });
});

describe('isCampaignPlayChannel', () => {
  it('rejects Play organic sources', () => {
    assert.equal(isCampaignPlayChannel('google-play'), false);
    assert.equal(isCampaignPlayChannel('organic'), false);
    assert.equal(isCampaignPlayChannel('google'), false);
    assert.equal(isCampaignPlayChannel(null), false);
  });

  it('accepts channel labels', () => {
    assert.equal(isCampaignPlayChannel('kevin'), true);
    assert.equal(isCampaignPlayChannel('Reddit'), true);
  });

  it('accepts simcap-google (marketing google channel; not Play organic)', () => {
    assert.equal(isCampaignPlayChannel('simcap-google'), true);
  });
});

describe('aliasPlayChannel', () => {
  it('maps simcap-google → google for reporting / referral_code', () => {
    assert.equal(aliasPlayChannel('simcap-google'), 'google');
    assert.equal(aliasPlayChannel('SimCap-Google'), 'google');
  });

  it('leaves other channels unchanged', () => {
    assert.equal(aliasPlayChannel('kevin'), 'kevin');
    assert.equal(aliasPlayChannel('chatgpt'), 'chatgpt');
    assert.equal(aliasPlayChannel(null), null);
  });
});

describe('parse + campaign + alias (google collision path)', () => {
  it('utm_source=simcap-google is campaign and aliases to google', () => {
    const parsed = parseChannelFromPlayInstallReferrer('utm_source=simcap-google');
    assert.equal(parsed, 'simcap-google');
    assert.equal(isCampaignPlayChannel(parsed), true);
    assert.equal(aliasPlayChannel(parsed), 'google');
  });

  it('utm_source=google stays organic and does not become a campaign', () => {
    const parsed = parseChannelFromPlayInstallReferrer('utm_source=google');
    assert.equal(parsed, 'google');
    assert.equal(isCampaignPlayChannel(parsed), false);
  });
});
