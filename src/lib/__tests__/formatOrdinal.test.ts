import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatOrdinalPlace } from '../formatOrdinal';

describe('formatOrdinalPlace', () => {
  it('uses English suffixes by default', () => {
    assert.equal(formatOrdinalPlace(1, 'en'), '1st');
    assert.equal(formatOrdinalPlace(2, 'en'), '2nd');
    assert.equal(formatOrdinalPlace(3, 'en'), '3rd');
    assert.equal(formatOrdinalPlace(4, 'en'), '4th');
    assert.equal(formatOrdinalPlace(11, 'en'), '11th');
    assert.equal(formatOrdinalPlace(21, 'en'), '21st');
  });

  it('uses Spanish .º abbreviations', () => {
    assert.equal(formatOrdinalPlace(1, 'es'), '1.º');
    assert.equal(formatOrdinalPlace(2, 'es-MX'), '2.º');
    assert.equal(formatOrdinalPlace(3, 'es'), '3.º');
    assert.equal(formatOrdinalPlace(11, 'es'), '11.º');
  });

  it('uses Korean 위', () => {
    assert.equal(formatOrdinalPlace(1, 'ko'), '1위');
    assert.equal(formatOrdinalPlace(12, 'ko-KR'), '12위');
  });
});
