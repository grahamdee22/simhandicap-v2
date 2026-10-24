import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { friendlyCourseWriteError } from '../courseWriteErrors';
import { normalizeCourseName, stripGolfCourseSuffixes } from '../courseNameNormalize';

describe('friendlyCourseWriteError', () => {
  it('replaces RLS / Postgres policy strings', () => {
    const raw =
      'new row violates row-level security policy for table "courses"';
    const msg = friendlyCourseWriteError(raw);
    assert.equal(msg.includes('row-level security'), false);
    assert.equal(msg.includes('violates'), false);
    assert.match(msg, /sign out and back in/i);
  });

  it('replaces duplicate-key dumps', () => {
    const msg = friendlyCourseWriteError(
      'duplicate key value violates unique constraint "courses_name_normalized_unique"'
    );
    assert.equal(msg.includes('violates'), false);
    assert.match(msg, /already in the library/i);
  });

  it('passes through already-friendly duplicate copy', () => {
    const friendly =
      '“DPC Craggy Ranch” is already in the library. Search for it instead of creating a duplicate.';
    assert.equal(friendlyCourseWriteError(friendly), friendly);
  });

  it('handles empty / unknown DB-looking text', () => {
    assert.match(friendlyCourseWriteError(''), /try again/i);
    assert.match(
      friendlyCourseWriteError('new row for relation "course_tees" violates check constraint'),
      /try again/i
    );
  });
});

describe('TPC Craig Ranch vs DPC Craggy Ranch (Kevin case)', () => {
  it('are not treated as the same normalized / stem name', () => {
    const a = 'TPC Craig Ranch';
    const b = 'DPC Craggy Ranch';
    assert.notEqual(normalizeCourseName(a), normalizeCourseName(b));
    assert.notEqual(stripGolfCourseSuffixes(a), stripGolfCourseSuffixes(b));
  });
});
