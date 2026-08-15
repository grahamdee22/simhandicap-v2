import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildShareRoundCardData, formatShareScoreToPar } from '../../components/ShareCard/buildShareRoundCardData';
import type { SimRound } from '../../store/useAppStore';

function sampleRound(overrides: Partial<SimRound> = {}): SimRound {
  return {
    id: 'r1',
    courseId: 'royal-birkdale',
    courseName: 'Royal Birkdale Golf Club',
    platform: 'GSPro',
    grossScore: 77,
    holeScores: Array(18).fill(4),
    putting: 'auto_2putt',
    pin: 'thu',
    wind: 'off',
    mulligans: 'none',
    playedAt: '2026-07-24T18:00:00.000Z',
    courseRating: 72,
    slope: 130,
    teeName: 'White',
    rawDiff: 7,
    adjustedDiff: 6.5,
    difficultyModifier: 0.9,
    indexAfter: 2.0,
    indexDelta: 0.0,
    ...overrides,
  };
}

describe('buildShareRoundCardData', () => {
  it('maps live round fields into share card props', () => {
    const round = sampleRound();
    const data = buildShareRoundCardData(round, [round], 'Graham');
    assert.equal(data.playerName, 'Graham');
    assert.equal(data.score, 77);
    assert.equal(data.courseName, 'Royal Birkdale Golf Club');
    assert.equal(data.simName, 'GSPro');
    assert.equal(data.teeLabel, 'White');
    assert.equal(data.differential, 6.5);
    assert.equal(data.indexAfter, 2.0);
    assert.equal(data.puttingMode, 'Auto 2-putt');
    assert.equal(data.wind, 'Off');
    assert.equal(data.mulligans, 'No mulligans');
    assert.equal(data.pinPlacement, 'Thursday · R1');
    assert.match(data.differentialSubtext ?? '', /best 8|Counts/);
  });

  it('formats score-to-par for over / even / under', () => {
    assert.equal(formatShareScoreToPar(7), '+7');
    assert.equal(formatShareScoreToPar(0), 'E');
    assert.equal(formatShareScoreToPar(-3), '-3');
  });
});
