/**
 * formatRelativeTime
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime } from '../formatRelativeTime';

describe('formatRelativeTime', () => {
  const now = new Date('2026-05-18T12:00:00Z').getTime();

  it('formats minutes ago', () => {
    const iso = new Date(now - 5 * 60 * 1000).toISOString();
    assert.equal(formatRelativeTime(iso, now), '5m ago');
  });

  it('formats yesterday', () => {
    const iso = new Date(now - 26 * 60 * 60 * 1000).toISOString();
    assert.equal(formatRelativeTime(iso, now), 'Yesterday');
  });
});
