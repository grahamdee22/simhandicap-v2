import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { coursePickerCollapseKey } from '../courseNameNormalize';
import {
  mergePickerCourses,
  type PickerCourseItem,
  type PickerDbCourse,
} from '../coursePickerSearch';

describe('coursePickerCollapseKey', () => {
  it('collapses Torrey / Pinehurst near-duplicates', () => {
    assert.equal(
      coursePickerCollapseKey('Torrey Pines North'),
      coursePickerCollapseKey('Torrey Pines – North Course')
    );
    assert.equal(
      coursePickerCollapseKey('Pinehurst No. 2'),
      coursePickerCollapseKey('Pinehurst 2')
    );
    assert.equal(
      coursePickerCollapseKey('Pinehurst No. 8'),
      coursePickerCollapseKey('Pinehurst 8')
    );
  });

  it('keeps same-family different courses distinct', () => {
    assert.notEqual(
      coursePickerCollapseKey('Bethpage Black'),
      coursePickerCollapseKey('Bethpage Blue')
    );
    assert.notEqual(
      coursePickerCollapseKey('Torrey Pines North'),
      coursePickerCollapseKey('Torrey Pines South')
    );
    assert.notEqual(
      coursePickerCollapseKey('Pinehurst No. 2'),
      coursePickerCollapseKey('Pinehurst No. 8')
    );
  });
});

describe('mergePickerCourses', () => {
  it('includes custom courses even when community list is empty', () => {
    const custom: PickerDbCourse[] = [
      { id: 'uuid-1', name: 'Coastal AI Dunes', location: null },
    ];
    const merged = mergePickerCourses([], [], 'coastal', custom);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].source, 'custom');
    assert.equal(merged[0].id, 'uuid-1');
  });

  it('omits custom when callers pass an empty custom list (tournament-lock)', () => {
    const curated: PickerCourseItem[] = [
      { id: 'pebble', name: 'Pebble Beach Golf Links', source: 'curated', confident: true },
    ];
    const community: PickerDbCourse[] = [
      { id: 'uuid-dpc', name: 'DPC Craggy Ranch', location: null },
    ];
    const custom: PickerDbCourse[] = [
      { id: 'uuid-custom', name: 'TPC Craig Ranch', location: null },
    ];
    // Tournament-lock call site passes [] instead of custom.
    const locked = mergePickerCourses(curated, community, 'TPC Craig Ranch', [], []);
    assert.ok(!locked.some((c) => c.id === 'uuid-custom' || c.source === 'custom'));
    const withCustom = mergePickerCourses(curated, community, 'TPC Craig Ranch', custom, []);
    assert.ok(withCustom.some((c) => c.id === 'uuid-custom' && c.source === 'custom'));
    const communityHit = mergePickerCourses(curated, community, 'Craggy', [], []);
    assert.ok(communityHit.some((c) => c.id === 'uuid-dpc'));
  });

  it('dedupes exact normalized name preferring curated', () => {
    const curated: PickerCourseItem[] = [
      { id: 'augusta', name: 'Augusta National', source: 'curated', confident: true },
    ];
    const custom: PickerDbCourse[] = [
      { id: 'uuid-a', name: 'Augusta National', location: null },
    ];
    const merged = mergePickerCourses(curated, [], 'augusta', custom);
    assert.equal(merged.filter((c) => c.name === 'Augusta National').length, 1);
    assert.equal(merged.find((c) => c.name === 'Augusta National')?.source, 'curated');
  });

  it('collapses Torrey / Pinehurst near-duplicates to curated', () => {
    const curated: PickerCourseItem[] = [
      { id: 'torrey-north', name: 'Torrey Pines North', source: 'curated', confident: true },
      { id: 'pinehurst', name: 'Pinehurst No. 2', source: 'curated', confident: true },
    ];
    const community: PickerDbCourse[] = [
      { id: 'uuid-tn', name: 'Torrey Pines – North Course', location: null },
      { id: 'uuid-p2', name: 'Pinehurst 2', location: null },
    ];
    const merged = mergePickerCourses(curated, community, 'torrey', []);
    assert.equal(merged.filter((c) => /torrey/i.test(c.name)).length, 1);
    assert.equal(merged.find((c) => /torrey/i.test(c.name))?.source, 'curated');
    assert.equal(merged.find((c) => /torrey/i.test(c.name))?.id, 'torrey-north');

    const pine = mergePickerCourses(curated, community, 'pinehurst', []);
    assert.equal(pine.filter((c) => /pinehurst/i.test(c.name)).length, 1);
    assert.equal(pine[0].source, 'curated');
    assert.equal(pine[0].id, 'pinehurst');
    assert.equal(pine[0].name, 'Pinehurst No. 2');
  });

  it('collapses other near-duplicate pairs from the live sweep', () => {
    const curated: PickerCourseItem[] = [
      { id: 'kapalua', name: 'Kapalua Plantation', source: 'curated', confident: true },
      { id: 'wentworth', name: 'Wentworth West', source: 'curated', confident: true },
      { id: 'wolf', name: 'Wolf Creek Golf Club', source: 'curated', confident: true },
    ];
    const community: PickerDbCourse[] = [
      { id: 'c1', name: 'Kapalua – Plantation Course', location: null },
      { id: 'c2', name: 'Wentworth West Course', location: null },
      { id: 'c3', name: 'Wolf Creek Golf Links', location: null },
    ];
    for (const q of ['kapalua', 'wentworth', 'wolf']) {
      const merged = mergePickerCourses(curated, community, q, []);
      assert.equal(merged.length, 1, q);
      assert.equal(merged[0].source, 'curated', q);
    }
  });

  it('does not merge Bethpage Black with Bethpage Blue', () => {
    const curated: PickerCourseItem[] = [
      { id: 'bethpage', name: 'Bethpage Black', source: 'curated', confident: true },
    ];
    const community: PickerDbCourse[] = [
      { id: 'uuid-bb', name: 'Bethpage Blue', location: null },
    ];
    const merged = mergePickerCourses(curated, community, 'bethpage', []);
    assert.equal(merged.length, 2);
    assert.ok(merged.some((c) => c.id === 'bethpage' && c.source === 'curated'));
    assert.ok(merged.some((c) => c.id === 'uuid-bb' && c.source === 'community'));
  });
});
