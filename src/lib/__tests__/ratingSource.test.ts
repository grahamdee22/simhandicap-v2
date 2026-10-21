import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_UNRATED_SLOPE,
  isUnratedTee,
  resolveTeeRatingFromInput,
  validateOfficialRatingSlope,
} from '../ratingSource';

describe('ratingSource', () => {
  it('flags user_reported and default_unrated as unrated', () => {
    assert.equal(isUnratedTee('user_reported'), true);
    assert.equal(isUnratedTee('default_unrated'), true);
    assert.equal(isUnratedTee('curated'), false);
    assert.equal(isUnratedTee('community'), false);
  });

  it('defaults to Par / 113 when official fields blank', () => {
    const r = resolveTeeRatingFromInput({ par: 71 });
    assert.equal(r.error, undefined);
    assert.equal(r.rating, 71);
    assert.equal(r.slope, DEFAULT_UNRATED_SLOPE);
    assert.equal(r.ratingSource, 'default_unrated');
  });

  it('stores user-reported CR/Slope when valid', () => {
    const r = resolveTeeRatingFromInput({ par: 72, ratingRaw: '74.2', slopeRaw: '138' });
    assert.equal(r.error, undefined);
    assert.equal(r.rating, 74.2);
    assert.equal(r.slope, 138);
    assert.equal(r.ratingSource, 'user_reported');
  });

  it('rejects slope outside 55–155', () => {
    const bad = validateOfficialRatingSlope('72', '200', 72);
    assert.ok(bad && 'error' in bad);
  });

  it('rejects rating far from par', () => {
    const bad = validateOfficialRatingSlope('90', '113', 72);
    assert.ok(bad && 'error' in bad);
  });
});
