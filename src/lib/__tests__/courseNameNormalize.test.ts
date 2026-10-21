import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  courseNameFuzzyMatch,
  courseNameMatchRank,
  normalizeCourseName,
  stripGolfCourseSuffixes,
} from '../courseNameNormalize';

describe('courseNameNormalize', () => {
  it('strips common golf suffixes', () => {
    assert.equal(stripGolfCourseSuffixes('Pebble Beach Golf Club'), 'pebble beach');
    assert.equal(stripGolfCourseSuffixes('Bandon Dunes Golf Links'), 'bandon dunes');
  });

  it('fuzzy-matches suffix variants', () => {
    assert.equal(courseNameFuzzyMatch('Pebble Beach Golf Club', 'pebble beach'), true);
    assert.equal(courseNameFuzzyMatch('Pebble Beach', 'Pebble Beach Golf Club'), true);
  });

  it('ranks exact normalized above substring', () => {
    assert.ok(
      courseNameMatchRank('Pebble Beach', 'pebble beach') <
        courseNameMatchRank('Pebble Beach Golf Club', 'beach')
    );
    assert.equal(normalizeCourseName('  Augusta  National  '), 'augusta national');
  });
});
