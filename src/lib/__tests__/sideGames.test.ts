/**
 * Side-game unit tests (Skins, Stableford, Nassau) + Part 2 verification cases.
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
import {
  computeIndividualSideGamesBoard,
  computeTeamSideGamesBoard,
  nassauResultsFromScorecards,
  netsFromGrossCard,
  teamCardsFromTeamHoleScores,
} from '../sideGameCompute';
import type { DbTournamentTeamHoleScoreRow } from '../tournamentTypes';

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
    assert.equal(after.holes[2].winnerId, 'a');
    assert.equal(after.totals.a, 3);
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

  it('sums running totals when the field is complete', () => {
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

  it('does not credit a hole until every participant has a net', () => {
    const r = computeStableford(
      [
        { id: 'a', nets: [3, 4] },
        { id: 'b', nets: [4, null] },
      ],
      [4, 4],
      2
    );
    assert.equal(r.holes[0].complete, true);
    assert.equal(r.holes[1].complete, false);
    assert.deepEqual(r.holes[1].pointsById, {});
    assert.equal(r.totals.a, 3);
    assert.equal(r.totals.b, 2);
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
    const results = Array.from({ length: 9 }, (_, i) =>
      i < 5 ? ('W' as const) : ('L' as const)
    );
    const r = computeNassau(results, 9);
    assert.equal(r.segments.length, 1);
    assert.equal(r.segments[0].key, 'overall');
    assert.equal(r.segments[0].winner, 'p1');
    assert.equal(r.segments[0].p1Wins, 5);
    assert.equal(r.segments[0].p2Wins, 4);
    assert.equal(r.segments[0].halved, 0);
  });

  it('resolves from the remaining scorecard after the other round is deleted', () => {
    const p2Results = [
      'W', 'W', 'W', 'W', 'H', 'W', 'W', 'W', 'W',
      'H', 'L', 'W', 'L', 'H', 'L', 'H', 'L', 'L',
    ] as const;
    const results = nassauResultsFromScorecards(
      [],
      p2Results.map((result, i) => ({ hole_number: i + 1, gross_score: 4, result })),
      18
    );
    const r = computeNassau(results, 18);
    assert.equal(r.segments.every((seg) => seg.resolved), true);
    assert.equal(r.segments[0].winner, 'p2');
    assert.equal(r.segments[0].p2Wins, 8);
    assert.equal(r.segments[1].winner, 'p1');
    assert.equal(r.segments[2].winner, 'p2');
    assert.equal(r.segments[2].p1Wins, 5);
    assert.equal(r.segments[2].p2Wins, 9);
    assert.equal(r.segments[2].halved, 4);
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

describe('use_handicap false flattens net to gross', () => {
  it('netsFromGrossCard ignores course handicap when useHandicap is false', () => {
    const holes = [
      { hole_number: 1, gross_score: 5 },
      { hole_number: 2, gross_score: 4 },
    ];
    const nets = netsFromGrossCard({
      holes,
      holeCount: 2,
      useHandicap: false,
      courseHandicap: 18,
      strokeIndexByHole: Array.from({ length: 18 }, (_, i) => i + 1),
      nine: null,
    });
    assert.deepEqual(nets, [5, 4]);
  });

  it('team cards use team_score (gross) when useHandicap is false', () => {
    const row = (teamId: string, hole: number, gross: number, net: number): DbTournamentTeamHoleScoreRow => ({
      id: `${teamId}-${hole}`,
      league_id: 'L',
      league_team_id: teamId,
      round_date: '2026-01-01',
      hole_number: hole,
      team_score: gross,
      team_net_score: net,
      is_partial: false,
      source_league_round_id: null,
      created_at: '',
      updated_at: '',
    });
    const cards = teamCardsFromTeamHoleScores(
      [row('t1', 1, 4, 2), row('t1', 2, 5, 3), row('t2', 1, 5, 4), row('t2', 2, 4, 2)],
      [
        { id: 't1', displayName: 'A' },
        { id: 't2', displayName: 'B' },
      ],
      2,
      false
    );
    assert.deepEqual(cards[0].nets, [4, 5]);
    assert.deepEqual(cards[1].nets, [5, 4]);
  });
});

describe('team-level side games (Scramble / Best Ball)', () => {
  it('drives Skins and Stableford from team_net_score, not individual rows', () => {
    const row = (
      teamId: string,
      hole: number,
      gross: number,
      net: number,
      partial = false
    ): DbTournamentTeamHoleScoreRow => ({
      id: `${teamId}-${hole}`,
      league_id: 'L',
      league_team_id: teamId,
      round_date: '2026-01-01',
      hole_number: hole,
      team_score: gross,
      team_net_score: net,
      is_partial: partial,
      source_league_round_id: null,
      created_at: '',
      updated_at: '',
    });
    // Team nets: t1 wins hole 1 (net 3 vs 4); hole 2 tied at 4 → carry; t2 wins hole 3 with pot
    const cards = teamCardsFromTeamHoleScores(
      [
        row('t1', 1, 5, 3),
        row('t1', 2, 5, 4),
        row('t1', 3, 6, 5),
        row('t2', 1, 5, 4),
        row('t2', 2, 5, 4),
        row('t2', 3, 5, 3),
      ],
      [
        { id: 't1', displayName: 'Alpha' },
        { id: 't2', displayName: 'Bravo' },
      ],
      3,
      true
    );
    const board = computeTeamSideGamesBoard({
      flags: { skins: true, stableford: true },
      cards,
      holeCount: 3,
      pars: [4, 4, 4],
    });
    assert.ok(board.skins);
    assert.equal(board.skins!.holes[0].winnerId, 't1');
    assert.equal(board.skins!.holes[1].carried, true);
    assert.equal(board.skins!.holes[2].winnerId, 't2');
    assert.equal(board.skins!.holes[2].skinsWon, 2);
    assert.equal(board.skins!.totals.t1, 1);
    assert.equal(board.skins!.totals.t2, 2);
    // Stableford: t1 nets 3,4,5 vs par 4 → 3+2+1=6; t2 4,4,3 → 2+2+3=7
    assert.equal(board.stableford!.totals.t1, 6);
    assert.equal(board.stableford!.totals.t2, 7);
  });

  it('treats is_partial holes as missing for comparable-net gating', () => {
    const row = (
      teamId: string,
      hole: number,
      net: number,
      partial: boolean
    ): DbTournamentTeamHoleScoreRow => ({
      id: `${teamId}-${hole}`,
      league_id: 'L',
      league_team_id: teamId,
      round_date: '2026-01-01',
      hole_number: hole,
      team_score: net,
      team_net_score: net,
      is_partial: partial,
      source_league_round_id: null,
      created_at: '',
      updated_at: '',
    });
    const cards = teamCardsFromTeamHoleScores(
      [
        row('t1', 1, 3, false),
        row('t1', 2, 4, true),
        row('t2', 1, 4, false),
        row('t2', 2, 3, false),
      ],
      [
        { id: 't1', displayName: 'Alpha' },
        { id: 't2', displayName: 'Bravo' },
      ],
      2,
      true
    );
    assert.equal(cards[0].nets[1], null);
    const board = computeTeamSideGamesBoard({
      flags: { skins: true, stableford: true },
      cards,
      holeCount: 2,
      pars: [4, 4],
    });
    assert.equal(board.skins!.holes[0].awarded, true);
    assert.equal(board.skins!.holes[1].pending, true);
    assert.equal(board.stableford!.holes[1].complete, false);
    assert.equal(board.stableford!.totals.t1, 3);
    assert.equal(board.stableford!.totals.t2, 2);
  });
});

describe('side games leave core standings untouched (additive flags only)', () => {
  it('empty flags produce null boards', () => {
    const board = computeIndividualSideGamesBoard({
      flags: {},
      cards: [
        {
          userId: 'u1',
          displayName: 'A',
          holes: [{ hole_number: 1, gross_score: 4 }],
          courseHandicap: 10,
        },
      ],
      holeCount: 1,
      useHandicap: true,
      strokeIndexByHole: Array.from({ length: 18 }, (_, i) => i + 1),
      nine: null,
      pars: [4],
    });
    assert.equal(board.skins, null);
    assert.equal(board.stableford, null);
  });
});
