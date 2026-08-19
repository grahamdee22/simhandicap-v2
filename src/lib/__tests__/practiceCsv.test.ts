/**
 * GSPro practice CSV parser
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MIN_SHOTS_FOR_TAKEAWAY,
  applyClubTakeaways,
  parseGsProExportFilename,
  parsePracticeCsv,
} from '../practiceCsv';

const dir = dirname(fileURLToPath(import.meta.url));
const SAMPLE = readFileSync(join(dir, 'fixtures/gspro-export08-16-26-14-43-17.csv'), 'utf8');

describe('parseGsProExportFilename', () => {
  it('reads MM-DD-YY-HH-MM-SS from a GSPro export name', () => {
    assert.equal(
      parseGsProExportFilename('gspro-export08-16-26-14-43-17.csv'),
      '2026-08-16T14:43:17'
    );
  });

  it('still finds the stamp when the download is renamed with (1)', () => {
    assert.equal(
      parseGsProExportFilename('gspro-export08-16-26-14-43-17 (1).csv'),
      '2026-08-16T14:43:17'
    );
  });

  it('returns null when the filename has no timestamp', () => {
    assert.equal(parseGsProExportFilename('practice.csv'), null);
  });
});

describe('parsePracticeCsv (real GSPro sample)', () => {
  const result = parsePracticeCsv(SAMPLE, 'gspro-export08-16-26-14-43-17.csv');

  it('parses 19 driver shots and a session date from the filename', () => {
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.session.platform, 'gspro');
    assert.equal(result.session.shots.length, 19);
    assert.equal(result.session.session_played_at, '2026-08-16T14:43:17');
    assert.equal(result.session.clubs.length, 1);
    assert.equal(result.session.clubs[0]?.club, 'DR');
    assert.equal(result.session.clubs[0]?.shot_count, 19);
    assert.equal(result.session.clubs[0]?.qualifies_for_takeaway, true);
  });

  it('drops mostly-zero launch-monitor columns (90%+ zeros) and ignores DistanceToPin', () => {
    assert.equal(result.ok, true);
    if (!result.ok) return;
    for (const col of ['DistanceToPin', 'Lie', 'Loft', 'DynamicLoft', 'CR', 'HI', 'VI', 'AoA']) {
      assert.ok(result.session.excluded_columns.includes(col), `expected ${col} excluded`);
    }
    for (const shot of result.session.shots) {
      assert.equal(shot.lie, null);
      assert.equal(shot.loft, null);
      assert.equal(shot.dynamic_loft, null);
      assert.equal(shot.cr, null);
      assert.equal(shot.hi, null);
      assert.equal(shot.vi, null);
      assert.equal(shot.aoa, null);
    }
    assert.equal(result.session.clubs[0]?.metrics.lie, undefined);
    assert.equal(result.session.clubs[0]?.metrics.loft, undefined);
    assert.equal(result.session.clubs[0]?.metrics.aoa, undefined);
  });

  it('does not keep a single non-zero AoA when the rest of the session is 0', () => {
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.session.shots.length, 19);
    assert.ok(result.session.excluded_columns.includes('AoA'));
  });

  it('computes carry and offline averages plus dispersion', () => {
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const carry = result.session.clubs[0]?.metrics.carry;
    const offline = result.session.clubs[0]?.metrics.offline;
    assert.ok(carry);
    assert.ok(offline);
    assert.equal(carry?.n, 19);
    assert.ok((carry?.stdev ?? 0) > 0);
    assert.ok((offline?.stdev ?? 0) > 0);
    assert.ok((carry?.mean ?? 0) > 100);
    assert.ok((carry?.mean ?? 0) < 300);
  });

  it('matches HLA and Offline signs on low-curve sample shots (positive = right)', () => {
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const lowCurve = result.session.shots.filter(
      (s) =>
        Math.abs(s.hla ?? 0) >= 2 &&
        Math.abs(s.offline ?? 0) >= 2 &&
        Math.abs(s.side_spin ?? 0) < 350
    );
    assert.ok(lowCurve.length >= 2);
    for (const shot of lowCurve) {
      assert.equal(
        Math.sign(shot.hla as number),
        Math.sign(shot.offline as number),
        `HLA ${shot.hla} and Offline ${shot.offline} should share sign on a low-curve shot`
      );
    }
  });
});

describe('parsePracticeCsv guards', () => {
  it('rejects an empty file', () => {
    const result = parsePracticeCsv('', 'gspro-export08-16-26-14-43-17.csv');
    assert.equal(result.ok, false);
  });

  it('rejects a CSV that is not a supported practice export', () => {
    const result = parsePracticeCsv('Name,Score\nA,1\n', 'other.csv');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not a supported practice export/i);
  });

  it('shows stats but skips takeaways for clubs with fewer than 3 shots', () => {
    const csv = [
      'Carry,TotalDistance,BallSpeed,BackSpin,SideSpin,HLA,VLA,Decent,DistanceToPin,PeakHeight,Offline,rawSpinAxis,rawCarryGame,rawCarryLM,Club,ClubSpeed,Path,AoA,FaceToTarget,FaceToPath,Lie,Loft,DynamicLoft,CR,HI,VI,SmashFactor',
      '150,155,90,4000,100,1,18,40,0 ft,50,2,1,150,150,7I,80,0,0,1,1,0,0,0,0,0,0,1.3',
      '152,157,91,4100,80,-1,17,41,0 ft,52,-1,1,152,152,7I,81,0,0,1,1,0,0,0,0,0,0,1.31',
      '110,112,70,5000,20,0,24,44,0 ft,40,0,0,110,110,PW,70,0,0,0,0,0,0,0,0,0,0,1.2',
      '200,210,130,2500,50,-2,12,40,0 ft,80,-3,2,200,200,DR,100,0,0,-2,1,0,0,0,0,0,0,1.45',
      '205,215,132,2400,40,-1,13,41,0 ft,82,-1,2,205,205,DR,101,0,0,-1,1,0,0,0,0,0,0,1.46',
      '198,208,129,2600,60,0,12,39,0 ft,78,1,2,198,198,DR,99,0,0,0,1,0,0,0,0,0,0,1.44',
    ].join('\n');
    const result = parsePracticeCsv(csv, 'gspro-export08-16-26-14-43-17.csv');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const byClub = Object.fromEntries(result.session.clubs.map((c) => [c.club, c]));
    assert.equal(byClub.DR?.qualifies_for_takeaway, true);
    assert.equal(byClub.DR?.shot_count, 3);
    assert.equal(byClub['7I']?.qualifies_for_takeaway, false);
    assert.equal(byClub['7I']?.shot_count, 2);
    assert.ok(byClub['7I']?.metrics.carry);
    assert.equal(byClub.PW?.qualifies_for_takeaway, false);
    assert.equal(MIN_SHOTS_FOR_TAKEAWAY, 3);

    const withTakeaways = applyClubTakeaways(result.session, [
      { club: 'DR', takeaway: 'Driver window is tight enough to coach.' },
      { club: '7I', takeaway: 'Should be ignored.' },
      { club: 'PW', takeaway: 'Should also be ignored.' },
    ]);
    const applied = Object.fromEntries(withTakeaways.clubs.map((c) => [c.club, c]));
    assert.equal(applied.DR?.takeaway, 'Driver window is tight enough to coach.');
    assert.equal(applied['7I']?.takeaway, null);
    assert.equal(applied.PW?.takeaway, null);
  });

  it('keeps a column when fewer than 90% of rows are zero', () => {
    const header =
      'Carry,TotalDistance,BallSpeed,BackSpin,SideSpin,HLA,VLA,Decent,DistanceToPin,PeakHeight,Offline,rawSpinAxis,rawCarryGame,rawCarryLM,Club,ClubSpeed,Path,AoA,FaceToTarget,FaceToPath,Lie,Loft,DynamicLoft,CR,HI,VI,SmashFactor';
    const rows = [];
    for (let i = 0; i < 10; i++) {
      const aoa = i < 2 ? '3.1' : '0';
      rows.push(
        `200,210,130,2500,50,-1,12,40,0 ft,80,-2,2,200,200,DR,100,1,${aoa},-1,1,2,10,12,1,1,1,1.45`
      );
    }
    const result = parsePracticeCsv([header, ...rows].join('\n'), 'gspro-export08-16-26-14-43-17.csv');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.session.excluded_columns.includes('AoA'), false);
    assert.ok(result.session.clubs[0]?.metrics.aoa);
  });
});
