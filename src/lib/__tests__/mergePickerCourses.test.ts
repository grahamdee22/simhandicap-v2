import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mergePickerCourses,
  type PickerCourseItem,
  type PickerDbCourse,
} from '../coursePickerSearch';

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
});
