import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatPracticeStatDisplay,
  normalizePracticeAnalysisPayload,
  parsePracticeAnalysisJson,
} from '../practiceAnalysisNormalize';

describe('parsePracticeAnalysisJson', () => {
  it('parses bare JSON', () => {
    const raw = parsePracticeAnalysisJson('{"tips":["A"],"takeaways":["B"]}');
    assert.ok(raw && typeof raw === 'object');
    assert.deepEqual((raw as { tips: string[] }).tips, ['A']);
  });

  it('strips markdown fences and preamble', () => {
    const raw = parsePracticeAnalysisJson('Here you go:\n```json\n{"tips":["Keep tempo"]}\n```\n');
    assert.ok(raw && typeof raw === 'object');
    assert.equal((raw as { tips: string[] }).tips[0], 'Keep tempo');
  });

  it('returns null for malformed text', () => {
    assert.equal(parsePracticeAnalysisJson('not json'), null);
    assert.equal(parsePracticeAnalysisJson(''), null);
  });
});

describe('normalizePracticeAnalysisPayload', () => {
  it('normalizes the canonical shape', () => {
    const n = normalizePracticeAnalysisPayload({
      detected_system: 'TrackMan',
      session_notes: '7-iron work',
      extracted_stats: {
        summary: [
          { label: 'Carry', value: '165', unit: 'yd' },
          { label: 'Ball speed', value: 128, unit: 'mph' },
        ],
        shots: [{ shot: '1', club: '7i', stats: [{ label: 'Smash', value: '1.42' }] }],
      },
      takeaways: ['Dispersion is tight left-to-right.', ''],
      tips: ['Hit 10 more with a softer transition.', 'Check face at impact outdoors.'],
    });
    assert.equal(n.detectedSystem, 'TrackMan');
    assert.equal(n.sessionNotes, '7-iron work');
    assert.equal(n.extractedStats.summary.length, 2);
    assert.equal(n.extractedStats.summary[1]?.value, '128');
    assert.equal(n.extractedStats.shots.length, 1);
    assert.equal(n.takeaways.length, 1);
    assert.equal(n.tips.length, 2);
  });

  it('accepts alternate keys and flat shot objects', () => {
    const n = normalizePracticeAnalysisPayload({
      simulator: 'GSPro',
      insights: ['Spin is high on two outliers.'],
      recommendations: ['Widen your target window one club.'],
      stats: {
        averages: [{ name: 'Launch', val: '14.2', units: 'deg' }],
        per_shot: [{ club: 'Driver', ball_speed: 155, carry: '248 yd' }],
      },
    });
    assert.equal(n.detectedSystem, 'GSPro');
    assert.equal(n.extractedStats.summary[0]?.label, 'Launch');
    assert.equal(n.extractedStats.shots[0]?.club, 'Driver');
    assert.ok((n.extractedStats.shots[0]?.stats.length ?? 0) >= 2);
    assert.equal(n.takeaways[0], 'Spin is high on two outliers.');
  });

  it('handles missing units and partial payloads without inventing stats', () => {
    const n = normalizePracticeAnalysisPayload({
      extracted_stats: {
        summary: [{ label: 'Apex', value: '32' }, { label: '', value: '9' }, { value: '10' }],
        shots: [],
      },
      takeaways: ['Too little data for a firm pattern call.'],
      tips: [],
    });
    assert.equal(n.extractedStats.summary.length, 1);
    assert.equal(n.extractedStats.summary[0]?.unit, null);
    assert.equal(n.extractedStats.shots.length, 0);
    assert.deepEqual(n.tips, []);
  });

  it('returns empty structure for null / garbage', () => {
    assert.deepEqual(normalizePracticeAnalysisPayload(null).extractedStats.summary, []);
    assert.deepEqual(normalizePracticeAnalysisPayload(42).takeaways, []);
    assert.deepEqual(normalizePracticeAnalysisPayload('{"broken"').tips, []);
  });
});

describe('formatPracticeStatDisplay', () => {
  it('appends unit when not already in the value', () => {
    assert.equal(formatPracticeStatDisplay({ label: 'Carry', value: '165', unit: 'yd' }), '165 yd');
    assert.equal(formatPracticeStatDisplay({ label: 'Carry', value: '165 yd', unit: 'yd' }), '165 yd');
    assert.equal(formatPracticeStatDisplay({ label: 'Smash', value: '1.4', unit: null }), '1.4');
  });
});
