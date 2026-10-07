/**
 * WHS 9-hole Course Handicap: halve Handicap Index before CH formula.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  indexForCourseHandicap,
  netScoreForLeagueRound,
  whsCourseHandicapFromIndex,
} from '../netHandicap';
import { matchPlayStrokeAllocation } from '../matchPlayGrossCompare';
import { buildMatchStrokeContext } from '../matchStrokeMath';
import type { DbMatchRow } from '../matchPlay';
import type { CourseSeed } from '../courses';

describe('indexForCourseHandicap (WHS 9-hole step 1)', () => {
  it('halves and rounds to nearest tenth — USGA example 8.7 → 4.4', () => {
    assert.equal(indexForCourseHandicap(8.7, 'front'), 4.4);
    assert.equal(indexForCourseHandicap(8.7, 'back'), 4.4);
  });

  it('is a no-op for 18 holes', () => {
    assert.equal(indexForCourseHandicap(8.7, '18'), 8.7);
    assert.equal(indexForCourseHandicap(12.3, '18'), 12.3);
  });

  it('traditional rounding at .05 boundary (4.35 → 4.4)', () => {
    // 8.7 / 2 = 4.35 → nearest tenth 4.4
    assert.equal(Math.round(8.7 * 5) / 10, 4.4);
  });
});

describe('whsCourseHandicapFromIndex with halved 9-hole index', () => {
  it('matches hand math for USGA-style 9-hole inputs after step 1', () => {
    const halved = indexForCourseHandicap(8.7, 'front');
    assert.equal(halved, 4.4);
    // CH = 4.4 × (125/113) + (35.2 − 36) ≈ 4.867 − 0.8 ≈ 4.067 → 4
    const ch = whsCourseHandicapFromIndex(halved, 35.2, 125, 36);
    assert.equal(ch, Math.round(4.4 * (125 / 113) + (35.2 - 36)));
    assert.equal(ch, 4);
  });
});

describe('netScoreForLeagueRound 9-hole vs 18-hole', () => {
  const index = 8.7;
  const nineCourse = { courseRating: 35.2, slope: 125, coursePar: 36 };
  // Comparable 18-hole: roughly double rating/par, same slope
  const eighteenCourse = { courseRating: 70.4, slope: 125, coursePar: 72 };

  it('18-hole regression: same net as before (default holesPlayed)', () => {
    // CH = 8.7 * (125/113) + (70.4 - 72) ≈ 9.624 − 1.6 ≈ 8.024 → 8
    const net = netScoreForLeagueRound(80, true, index, eighteenCourse);
    assert.equal(net, 80 - 8);
    assert.equal(netScoreForLeagueRound(80, true, index, eighteenCourse, '18'), net);
  });

  it('9-hole front: strokes roughly half of 18-hole on similar tee math', () => {
    const net18 = netScoreForLeagueRound(80, true, index, eighteenCourse, '18');
    const strokes18 = 80 - net18;
    const net9 = netScoreForLeagueRound(40, true, index, nineCourse, 'front');
    const strokes9 = 40 - net9;
    // Halved index → ~half the course handicap (not ~full index / double)
    assert.equal(strokes9, 4);
    assert.ok(strokes9 <= Math.ceil(strokes18 / 2) + 1);
    assert.ok(strokes9 < strokes18);
  });

  it('9-hole back matches front for the same index and tee snap', () => {
    const front = netScoreForLeagueRound(40, true, index, nineCourse, 'front');
    const back = netScoreForLeagueRound(40, true, index, nineCourse, 'back');
    assert.equal(front, back);
  });

  it('without course snap, flat deduction also halves for 9 holes', () => {
    assert.equal(netScoreForLeagueRound(40, true, 8.7, null, 'front'), 40 - 4);
    assert.equal(netScoreForLeagueRound(40, true, 8.7, null, '18'), 40 - 9);
  });
});

describe('matchPlayStrokeAllocation 9-hole', () => {
  // Rating === Par and Slope 113 so CH equals the (possibly halved) index rounded.
  const snap9 = (index: number) => ({
    index,
    courseRating: 36,
    slope: 113,
    coursePar: 36,
  });
  const snap18 = (index: number) => ({
    index,
    courseRating: 72,
    slope: 113,
    coursePar: 72,
  });

  it('halves indexes for front-nine stroke preview', () => {
    const nine = matchPlayStrokeAllocation({
      enabled: true,
      nine: 'front',
      me: snap9(8.7),
      opponent: snap9(0),
    });
    const eighteen = matchPlayStrokeAllocation({
      enabled: true,
      nine: null,
      me: snap18(8.7),
      opponent: snap18(0),
    });
    const nineStrokes = nine.myStrokesByCourseHole.reduce((s, n) => s + n, 0);
    const eighteenStrokes = eighteen.myStrokesByCourseHole.reduce((s, n) => s + n, 0);
    // 4.4 → CH 4 on 9; full 8.7 → CH 9 on 18
    assert.equal(nine.note, 'you');
    assert.equal(nineStrokes, 4);
    assert.equal(eighteenStrokes, 9);
    assert.ok(nineStrokes < eighteenStrokes);
  });

  it('halves indexes for back-nine stroke preview', () => {
    const back = matchPlayStrokeAllocation({
      enabled: true,
      nine: 'back',
      me: snap9(8.7),
      opponent: snap9(0),
    });
    assert.equal(
      back.myStrokesByCourseHole.reduce((s, n) => s + n, 0),
      4
    );
  });
});

describe('buildMatchStrokeContext 9-hole', () => {
  // Par 36 per nine (all 4s) so rating==par keeps CH = rounded (halved) index.
  const course: CourseSeed = {
    id: 'test-nine-ch',
    name: 'Nine CH Test',
    byPlatform: { GSPro: { rating: 72, slope: 113 } },
    pars: Array.from({ length: 18 }, () => 4),
    strokeIndex: [1, 3, 5, 7, 9, 11, 13, 15, 17, 2, 4, 6, 8, 10, 12, 14, 16, 18],
  };

  function stubMatch(partial: Partial<DbMatchRow>): DbMatchRow {
    return {
      id: 'm1',
      created_at: '',
      updated_at: '',
      player_1_id: 'p1',
      player_2_id: 'p2',
      challenger_id: 'p1',
      is_open: false,
      course_name: course.name,
      player_1_course_rating: 36,
      player_1_course_slope: 113,
      player_1_tee: 'White',
      player_2_course_rating: 36,
      player_2_course_slope: 113,
      player_2_tee: 'White',
      putting_mode: 'auto_2_putt',
      pin_placement: 'thursday',
      wind: 'none',
      mulligans: 'none',
      format: 'stroke',
      holes: 9,
      nine_selection: 'front',
      status: 'active',
      winner_id: null,
      abandoned_by_id: null,
      player_1_net_score: null,
      player_2_net_score: null,
      player_1_finished: false,
      player_2_finished: false,
      player_1_settings_photo_url: null,
      player_2_settings_photo_url: null,
      ...partial,
    } as DbMatchRow;
  }

  it('allocates ~half the strokes of an 18-hole match for the same indexes', () => {
    const front = buildMatchStrokeContext(
      stubMatch({ holes: 9, nine_selection: 'front' }),
      course,
      8.7,
      0,
      'A',
      'B'
    );
    const eighteen = buildMatchStrokeContext(
      stubMatch({
        holes: 18,
        nine_selection: null,
        player_1_course_rating: 72,
        player_2_course_rating: 72,
      }),
      course,
      8.7,
      0,
      'A',
      'B'
    );
    assert.equal(front.strokeGiftTotal, 4);
    assert.equal(eighteen.strokeGiftTotal, 9);
    // Higher course handicap (p1 after halving) receives the strokes.
    assert.equal(front.receiverIsPlayer1, true);
  });

  it('treats back nine the same as front for index halving', () => {
    const back = buildMatchStrokeContext(
      stubMatch({
        holes: 9,
        nine_selection: 'back',
        player_1_course_rating: 36,
        player_2_course_rating: 36,
      }),
      course,
      8.7,
      0,
      'A',
      'B'
    );
    assert.equal(back.strokeGiftTotal, 4);
  });
});
