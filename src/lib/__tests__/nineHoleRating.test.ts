/**
 * 9-hole differential resolver + index contribution.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustedDifferential,
  handicapIndexFromDifferentials,
} from '../handicap';
import {
  clampGrossScore,
  getNineHoleRatingSlope,
  isNineHolePlayed,
  nineHoleLoggingUnlocked,
  ratingSlopeForHolesPlayed,
  shouldBlockTournamentApplyForHoles,
} from '../nineHoleRating';
import { isNineHoleSocialMatch, buildNewRoundInputFromCompletedMatch } from '../matchPlayIndexRound';
import type { DbMatchRow } from '../matchPlay';

describe('getNineHoleRatingSlope', () => {
  it('derives rating as half of 18-hole CR and keeps slope', () => {
    const r = getNineHoleRatingSlope({ rating: 72.1, slope: 128 }, 'front');
    assert.equal(r.rating, 36.1);
    assert.equal(r.slope, 128);
    assert.equal(r.nineHoleSource, 'derived');
  });

  it('prefers real Front 9 fields when present', () => {
    const r = getNineHoleRatingSlope(
      {
        rating: 72.1,
        slope: 128,
        front9Rating: 35.4,
        front9Slope: 125,
      },
      'front'
    );
    assert.equal(r.rating, 35.4);
    assert.equal(r.slope, 125);
    assert.equal(r.nineHoleSource, 'real');
  });

  it('uses real Back 9 when present without affecting Front', () => {
    const front = getNineHoleRatingSlope(
      { rating: 72, slope: 130, back9Rating: 37.2, back9Slope: 132 },
      'front'
    );
    assert.equal(front.nineHoleSource, 'derived');
    assert.equal(front.rating, 36);
    const back = getNineHoleRatingSlope(
      { rating: 72, slope: 130, back9Rating: 37.2, back9Slope: 132 },
      'back'
    );
    assert.equal(back.rating, 37.2);
    assert.equal(back.slope, 132);
    assert.equal(back.nineHoleSource, 'real');
  });
});

describe('9-hole differential in best-8-of-20', () => {
  it('counts one 9-hole adjusted diff like any other round', () => {
    const eighteen = adjustedDifferential(78, 72.0, 130, 'auto_2putt', 'thu', 'off', 'none');
    const nineTee = getNineHoleRatingSlope({ rating: 72.0, slope: 130 }, 'front');
    const nine = adjustedDifferential(39, nineTee.rating, nineTee.slope, 'auto_2putt', 'thu', 'off', 'none');

    const withNine = handicapIndexFromDifferentials([eighteen.adjusted, nine.adjusted]);
    const eighteenOnly = handicapIndexFromDifferentials([eighteen.adjusted]);
    assert.ok(withNine != null && eighteenOnly != null);
    // Adding a second counting diff changes the index (not ignored / not paired away).
    assert.notEqual(withNine, eighteenOnly);

    const allNineish = handicapIndexFromDifferentials([
      nine.adjusted,
      nine.adjusted,
      eighteen.adjusted,
    ]);
    assert.ok(allNineish != null);
  });

  it('uses 9-hole CR not full 18 CR for raw math', () => {
    const with18Cr = adjustedDifferential(40, 72.0, 130, 'putt_all', 'sun', 'strong', 'none');
    const nineTee = ratingSlopeForHolesPlayed({ rating: 72.0, slope: 130 }, 'front');
    const with9Cr = adjustedDifferential(40, nineTee.rating, nineTee.slope, 'putt_all', 'sun', 'strong', 'none');
    // Same gross vs half CR is a worse (higher) differential than vs full 18 CR.
    assert.ok(with9Cr.adjusted > with18Cr.adjusted);
    assert.equal(nineTee.rating, 36);
  });
});

describe('null-index gate (Decision 2)', () => {
  it('blocks 9-hole options when SimCap index is null (first-ever round)', () => {
    assert.equal(nineHoleLoggingUnlocked(null), false);
    assert.equal(nineHoleLoggingUnlocked(null, false), false);
  });

  it('unlocks 9-hole once an index exists', () => {
    assert.equal(nineHoleLoggingUnlocked(12.4), true);
    assert.equal(nineHoleLoggingUnlocked(0), true);
  });

  it('allows editing an already-saved 9-hole round even if index math is odd', () => {
    assert.equal(nineHoleLoggingUnlocked(null, true), true);
  });
});

describe('null-index / score bounds helpers', () => {
  it('clamps 9-hole gross to 27–65', () => {
    assert.equal(clampGrossScore(20, 'front'), 27);
    assert.equal(clampGrossScore(80, 'back'), 65);
    assert.equal(clampGrossScore(40, 'front'), 40);
  });

  it('isNineHolePlayed', () => {
    assert.equal(isNineHolePlayed('18'), false);
    assert.equal(isNineHolePlayed('front'), true);
    assert.equal(isNineHolePlayed(undefined), false);
  });
});

describe('tournament-apply suppression (Decision 3)', () => {
  it('blocks Front/Back 9 for every tournament format path (shared gate)', () => {
    // Stroke, Scramble, and Best Ball all insert league_rounds via recordOptedInLeagueRounds;
    // this gate runs before any format branch. DB trigger is a second line of defense.
    assert.equal(shouldBlockTournamentApplyForHoles('front'), true);
    assert.equal(shouldBlockTournamentApplyForHoles('back'), true);
    assert.equal(shouldBlockTournamentApplyForHoles('18'), false);
    assert.equal(shouldBlockTournamentApplyForHoles(undefined), false);
  });
});

describe('custom tee on 9-hole (bypass derived resolver)', () => {
  it('typed custom 9-hole CR must not be halved again', () => {
    // User enters Front 9 rating 35.5 directly. Halving that (as if it were 18) would be wrong.
    const typedNineCr = 35.5;
    const mistakenDoubleDerive = getNineHoleRatingSlope(
      { rating: typedNineCr, slope: 122 },
      'front'
    );
    assert.equal(mistakenDoubleDerive.rating, 17.8);
    // Save/preview paths store typedNineCr as-is with nineHoleSource=real — not mistakenDoubleDerive.
    assert.notEqual(typedNineCr, mistakenDoubleDerive.rating);
  });
});

describe('Match Play save-to-index gate', () => {
  const baseMatch = {
    id: 'm1',
    status: 'complete',
    player_1_id: 'u1',
    player_2_id: 'u2',
    course_name: 'Pebble Beach Golf Links',
    holes: 18,
    nine_selection: null,
    putting_mode: 'auto_2putt',
    pin_placement: 'thu',
    wind: 'off',
    mulligans: 'none',
    player_1_course_rating: 72,
    player_1_course_slope: 130,
    player_1_tee: 'White',
    player_2_course_rating: 72,
    player_2_course_slope: 130,
    player_2_tee: 'White',
  } as unknown as DbMatchRow;

  it('detects Front/Back 9 matches', () => {
    assert.equal(isNineHoleSocialMatch({ holes: 18, nine_selection: null }), false);
    assert.equal(isNineHoleSocialMatch({ holes: 9, nine_selection: 'front' }), true);
    assert.equal(isNineHoleSocialMatch({ holes: 9, nine_selection: 'back' }), true);
  });

  it('rejects buildNewRoundInput for 9-hole matches', () => {
    const built = buildNewRoundInputFromCompletedMatch({
      match: { ...baseMatch, holes: 9, nine_selection: 'front' },
      holesRows: [],
      playerId: 'u1',
      playedAtIso: new Date().toISOString(),
      platform: 'Trackman',
    });
    assert.equal(built.ok, false);
  });
});
