/**
 * Side-game unit tests (Skins, Stableford, Nassau).
 * Run: npm test
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeNassau } from '../nassau';
import { computeSkins } from '../skins';
import {
  availableSideGamesForFormat,
  filterSideGamesForFormat,
  normalizeSideGames,
} from '../sideGames';
import {
  stablefordPointsForHole,
  stablefordPointsForNetVsPar,
  computeStableford,
} from '../stableford';
import { holeNet, strokesReceivedOnHole } from '../netHandicap';

describe('sideGames format matrix', () => {
  it('offers Nassau only on Match Play; nothing on Stroke', () => {
    assert.deepEqual(availableSideGamesForFormat('match_play'), [
      'skins',
      'nassau',
      'stableford',
    ]);
    assert.deepEqual(availableSideGamesForFormat('scramble'), ['skins', 'stableford']);
    assert.deepEqual(availableSideGamesForFormat('best_ball'), ['skins', 'stableford']);
    assert.deepEqual(availableSideGamesForFormat('stroke'), []);
  });

  it('filters incompatible flags', () => {
    assert.deepEqual(
      filterSideGamesForFormat({ skins: true, nassau: true, stableford: true }, 'scramble'),
      { skins: true, stableford: true }
    );
    assert.deepEqual(normalizeSideGames({ skins: true, junk: 1 }), { skins: true });
  });
});

describe('skins carryover', () => {
  it('awards unique low and carries ties', () => {
    const a = { id: 'a', nets: [4, 5, 3, 4] };
    const b = { id: 'b', nets: [5, 5, 4, 5] };
    const r = computeSkins([a, b], 4);
    assert.equal(r.holes[0].winnerId, 'a');
    assert.equal(r.holes[0].skinsWon, 1);
    assert.equal(r.holes[1].carried, true);
    assert.equal(r.holes[2].winnerId, 'a');
    assert.equal(r.holes[2].skinsWon, 2); // hole 2 carry + hole 3
    assert.equal(r.holes[3].winnerId, 'a');
    assert.equal(r.holes[3].skinsWon, 1);
    assert.equal(r.totals.a, 4);
    assert.equal(r.totals.b, 0);
  });

  it('blocks at first incomplete hole and fully recomputes after edit', () => {
    const before = computeSkins(
      [
        { id: 'a', nets: [4, null, 3] },
        { id: 'b', nets: [5, 5, 4] },
      ],
      3
    );
    assert.equal(before.holes[0].awarded, true);
    assert.equal(before.holes[1].pending, true);
    assert.equal(before.holes[2].pending, true);

    const after = computeSkins(
      [
        { id: 'a', nets: [5, 4, 3] },
        { id: 'b', nets: [5, 5, 4] },
      ],
      3
    );
    assert.equal(after.holes[0].carried, true);
    assert.equal(after.holes[1].winnerId, 'a');
    assert.equal(after.holes[1].skinsWon, 2);
  });

  it('no-ops with fewer than 2 participants', () => {
    const r = computeSkins([{ id: 'a', nets: [3, 4] }], 2);
    assert.equal(r.holes[0].pending, true);
    assert.equal(r.totals.a, 0);
  });
});

describe('stableford R&A table', () => {
  it('matches standard points', () => {
    assert.equal(stablefordPointsForNetVsPar(-3), 5);
    assert.equal(stablefordPointsForNetVsPar(-2), 4);
    assert.equal(stablefordPointsForNetVsPar(-1), 3);
    assert.equal(stablefordPointsForNetVsPar(0), 2);
    assert.equal(stablefordPointsForNetVsPar(1), 1);
    assert.equal(stablefordPointsForNetVsPar(2), 0);
    assert.equal(stablefordPointsForHole(3, 4), 3);
  });

  it('sums running totals', () => {
    const r = computeStableford(
      [
        { id: 'a', nets: [3, 5] },
        { id: 'b', nets: [4, 4] },
      ],
      [4, 4],
      2
    );
    assert.equal(r.totals.a, 3 + 1);
    assert.equal(r.totals.b, 2 + 2);
  });
});

describe('nassau segments', () => {
  it('splits front/back/overall on 18', () => {
    const results = Array.from({ length: 18 }, (_, i) =>
      i < 9 ? ('W' as const) : i < 15 ? ('L' as const) : ('H' as const)
    );
    const r = computeNassau(results, 18);
    assert.equal(r.segments.length, 3);
    assert.equal(r.segments[0].key, 'front');
    assert.equal(r.segments[0].winner, 'p1');
    assert.equal(r.segments[1].key, 'back');
    assert.equal(r.segments[1].winner, 'p2');
    assert.equal(r.segments[2].key, 'overall');
    assert.equal(r.segments[2].resolved, true);
  });

  it('collapses to one overall bet on 9-hole', () => {
    const results = Array.from({ length: 9 }, () => 'W' as const);
    const r = computeNassau(results, 9);
    assert.equal(r.segments.length, 1);
    assert.equal(r.segments[0].key, 'overall');
    assert.equal(r.segments[0].winner, 'p1');
  });

  it('stays unresolved until segment is complete', () => {
    const results = [...Array.from({ length: 8 }, () => 'W' as const), null];
    const r = computeNassau(results, 9);
    assert.equal(r.segments[0].resolved, false);
    assert.equal(r.segments[0].winner, null);
  });
});

describe('full-CH holeNet', () => {
  it('subtracts strokes on hardest SI holes', () => {
    const si = [9, 11, 7, 15, 3, 13, 1, 17, 5, 10, 12, 8, 16, 4, 14, 2, 18, 6];
    assert.equal(strokesReceivedOnHole(7, 2, si), 1); // SI 1
    assert.equal(strokesReceivedOnHole(16, 2, si), 1); // SI 2
    assert.equal(holeNet(5, 7, 2, si), 4);
    assert.equal(holeNet(5, 1, 2, si), 5);
  });
});
