import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CourseAlias } from '../courseAliasMatch';
import { mergePickerCourses, type PickerCourseItem, type PickerDbCourse } from '../coursePickerSearch';

const pebbleAlias: CourseAlias = {
  id: 'a1',
  courseId: 'uuid-dpc-pebble',
  communityCourseName: 'DPC Pebble',
  realCourseName: 'Pebble Beach Golf Links',
  realCourseNameNormalized: 'pebble beach golf links',
  source: 'manual_cross_reference',
  confidence: 'verified',
};

const georgiaAlias: CourseAlias = {
  id: 'a2',
  courseId: 'uuid-georgia',
  communityCourseName: 'Georgia Golf Club',
  realCourseName: 'Augusta National Golf Club',
  realCourseNameNormalized: 'augusta national golf club',
  source: 'manual_cross_reference',
  confidence: 'verified',
};

describe('mergePickerCourses aliases', () => {
  it('surfaces DPC Pebble when searching Pebble Beach, alongside curated', () => {
    const curated: PickerCourseItem[] = [
      {
        id: 'pebble',
        name: 'Pebble Beach Golf Links',
        source: 'curated',
        confident: true,
      },
    ];
    const community: PickerDbCourse[] = [
      { id: 'uuid-dpc-pebble', name: 'DPC Pebble', location: 'Pebble Beach, CA, USA' },
    ];
    const merged = mergePickerCourses(curated, community, 'Pebble Beach', [], [pebbleAlias]);
    assert.ok(merged.some((c) => c.id === 'pebble' && c.source === 'curated'));
    const dpc = merged.find((c) => c.id === 'uuid-dpc-pebble');
    assert.ok(dpc);
    assert.equal(dpc.source, 'community');
    assert.match(dpc.subtitle ?? '', /GSPro recreation of Pebble Beach/i);
    assert.equal(dpc.recreationOf, 'Pebble Beach Golf Links');
  });

  it('surfaces curated Pebble when searching DPC Pebble', () => {
    const curated: PickerCourseItem[] = [];
    const community: PickerDbCourse[] = [
      { id: 'uuid-dpc-pebble', name: 'DPC Pebble', location: null },
    ];
    const merged = mergePickerCourses(curated, community, 'DPC Pebble', [], [pebbleAlias]);
    assert.ok(merged.some((c) => c.id === 'uuid-dpc-pebble'));
    const curatedHit = merged.find((c) => c.id === 'pebble');
    assert.ok(curatedHit);
    assert.equal(curatedHit.source, 'curated');
    assert.match(curatedHit.subtitle ?? '', /Curated, verified rating/i);
  });

  it('surfaces Georgia Golf Club for Augusta National search', () => {
    const curated: PickerCourseItem[] = [
      {
        id: 'augusta',
        name: 'Augusta National Golf Club',
        source: 'curated',
        confident: true,
      },
    ];
    const community: PickerDbCourse[] = [
      { id: 'uuid-georgia', name: 'Georgia Golf Club', location: 'Augusta, GA, USA' },
    ];
    const merged = mergePickerCourses(curated, community, 'Augusta National', [], [georgiaAlias]);
    assert.equal(merged.length, 2);
    assert.ok(merged.some((c) => c.id === 'augusta'));
    assert.ok(merged.some((c) => c.id === 'uuid-georgia' && c.recreationOf));
  });

  it('does not change enrichment fields on aliased community rows', () => {
    const community: PickerDbCourse[] = [
      {
        id: 'uuid-dpc-pebble',
        name: 'DPC Pebble',
        location: null,
        enrichment_tier: 3,
        enrichment_source: 'gspro_difficulty',
      },
    ];
    const merged = mergePickerCourses([], community, 'Pebble', [], [pebbleAlias]);
    const dpc = merged.find((c) => c.id === 'uuid-dpc-pebble');
    assert.equal(dpc?.enrichmentTier, 3);
    assert.equal(dpc?.enrichmentSource, 'gspro_difficulty');
  });

  it('leaves non-aliased courses unchanged', () => {
    const curated: PickerCourseItem[] = [
      { id: 'bethpage', name: 'Bethpage Black', source: 'curated', confident: true },
    ];
    const community: PickerDbCourse[] = [
      { id: 'uuid-bb', name: 'Bethpage Blue', location: null },
    ];
    const merged = mergePickerCourses(curated, community, 'bethpage', [], [pebbleAlias]);
    assert.equal(merged.length, 2);
    assert.ok(!merged.some((c) => c.recreationOf));
  });
});
