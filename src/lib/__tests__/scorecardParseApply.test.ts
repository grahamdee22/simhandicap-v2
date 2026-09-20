/**
 * Scorecard parse apply + course match helpers
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyParseScorecardToLogForm, scanBannerMessage } from '../scorecardParseApply';
import {
  matchCourseFromScannedName,
  teeNamesForScannedCourseMatch,
} from '../scorecardCourseMatch';

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
    assert.equal(applied.mulligans, 'one');
    assert.equal(applied.wind, 'off');
    assert.equal(applied.pin, 'thu');
    assert.equal(applied.putting, 'auto_2putt');
    assert.equal(applied.teePickKey, 'Blue');
    assert.equal(applied.banner, 'high');
  });

  it('sets courseId from matched raw_course_name and rematches tees', () => {
    const match = matchCourseFromScannedName('Pebble Beach Golf Links');
    assert.ok(match);
    assert.equal(match!.courseId, 'pebble');
    const teeNames = teeNamesForScannedCourseMatch(match!, 'gspro');
    const applied = applyParseScorecardToLogForm(
      {
        success: true,
        confidence: 'high',
        raw_course_name: 'Pebble Beach Golf Links',
        data: { total_score: 80, tees: 'Blue' },
        errors: [],
      },
      teeNames,
      match
    );
    assert.equal(applied.courseId, 'pebble');
    assert.equal(applied.matchedCourseName, match!.courseName);
    assert.equal(applied.detectedCourseName, 'Pebble Beach Golf Links');
    assert.equal(applied.courseMatchConfidence, 'exact');
    if (teeNames.some((n) => n.toLowerCase() === 'blue')) {
      assert.equal(applied.teePickKey, 'Blue');
    }
  });

  it('flags unmatched detected course as low-confidence review', () => {
    const applied = applyParseScorecardToLogForm(
      {
        success: true,
        confidence: 'high',
        raw_course_name: 'Totally Unknown Muni 18',
        data: { total_score: 72 },
        errors: [],
      },
      ['White'],
      null
    );
    assert.equal(applied.courseId, undefined);
    assert.equal(applied.banner, 'low');
    assert.match(
      scanBannerMessage(applied.banner, {
        detectedCourseName: applied.detectedCourseName,
        matchedCourseName: null,
      }) ?? '',
      /no catalog match/
    );
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
    assert.match(
      scanBannerMessage('high', {
        detectedCourseName: 'Pebble Beach',
        matchedCourseName: 'Pebble Beach Golf Links',
        courseMatchConfidence: 'exact',
      }) ?? '',
      /Course set to Pebble Beach Golf Links/
    );
  });
});

describe('scorecardCourseMatch', () => {
  it('exact-matches curated catalog names', () => {
    const m = matchCourseFromScannedName('Torrey Pines South');
    assert.ok(m);
    assert.equal(m!.confidence, 'exact');
    assert.equal(m!.source, 'curated');
  });

  it('fuzzy-matches contains against curated catalog', () => {
    const m = matchCourseFromScannedName('Pebble Beach');
    assert.ok(m);
    assert.equal(m!.courseId, 'pebble');
    assert.equal(m!.confidence, 'fuzzy');
  });

  it('returns null when nothing matches', () => {
    assert.equal(matchCourseFromScannedName('zzz-not-a-real-course-xyz'), null);
    assert.equal(matchCourseFromScannedName(''), null);
  });

  it('prefers community exact over missing curated', () => {
    const m = matchCourseFromScannedName('My Local Links', [
      {
        id: 'comm-1',
        name: 'My Local Links',
        name_normalized: 'my local links',
        location: null,
        designer: null,
        source: 'community',
        confident: true,
        gspro_difficulty: null,
        enrichment_tier: 1,
        enrichment_source: null,
        course_tees: [{ name: 'White', rating: 71, slope: 125, yards: 6400 }],
      },
    ]);
    assert.ok(m);
    assert.equal(m!.courseId, 'comm-1');
    assert.equal(m!.source, 'community');
    assert.equal(m!.confidence, 'exact');
  });
});
