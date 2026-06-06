/**
 * Scorecard parse apply helpers
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyParseScorecardToLogForm, scanBannerMessage } from '../scorecardParseApply';

describe('scorecardParseApply', () => {
  it('maps successful parse to log form fields', () => {
    const applied = applyParseScorecardToLogForm(
      {
        success: true,
        confidence: 'high',
        data: {
          total_score: 77,
          mulligans: true,
          wind: 'Off',
          pin_placement: 'Thu',
          putting_mode: 'Auto',
          tees: 'Blue',
        },
        errors: [],
      },
      ['Red', 'White', 'Blue']
    );
    assert.equal(applied.grossScore, 77);
    assert.equal(applied.mulligans, 'on');
    assert.equal(applied.wind, 'off');
    assert.equal(applied.pin, 'thu');
    assert.equal(applied.putting, 'auto_2putt');
    assert.equal(applied.teePickKey, 'Blue');
    assert.equal(applied.banner, 'high');
  });

  it('does not pre-populate on failure', () => {
    const applied = applyParseScorecardToLogForm(
      { success: false, confidence: 'low', data: {}, errors: ['bad image'] },
      ['Blue']
    );
    assert.equal(applied.banner, 'failed');
    assert.equal(applied.grossScore, undefined);
  });

  it('shows banner copy', () => {
    assert.match(scanBannerMessage('high') ?? '', /review before logging/);
    assert.match(scanBannerMessage('low') ?? '', /review carefully/);
    assert.match(scanBannerMessage('failed') ?? '', /enter your round manually/);
  });
});
