import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LeagueStandingRow } from '../computeLeagueStandings';
import type { DbLeagueMatchPairingRow } from '../matchPlayPairingTypes';
import {
  computeSeasonStandings,
  placesFromFinishedBracket,
  playerPointsFromTournament,
  pointsForPlace,
} from '../seasonPoints';

function pairing(
  partial: Partial<DbLeagueMatchPairingRow> & Pick<DbLeagueMatchPairingRow, 'id'>
): DbLeagueMatchPairingRow {
  return {
    league_id: 'l',
    player_1_entry_id: 'e1',
    player_2_entry_id: 'e2',
    status: 'complete',
    winner_entry_id: null,
    holes_won_p1: 0,
    holes_won_p2: 0,
    holes_halved: 0,
    scheduled_at: null,
    completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

function standing(partial: Partial<LeagueStandingRow> & Pick<LeagueStandingRow, 'entryId'>): LeagueStandingRow {
  return {
    rank: 1,
    userId: null,
    displayName: 'Golfer',
    teamId: null,
    teamName: null,
    memberNames: [],
    roundsPlayed: 1,
    bestNet: 70,
    lowNet: 70,
    bestGross: 80,
    points: 0,
    isTeam: false,
    ...partial,
  };
}

describe('points for place', () => {
  it('uses the fixed table and zero past 8th', () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map(pointsForPlace),
      [10, 8, 6, 5, 4, 3, 2, 1, 0, 0]
    );
  });
});

describe('bracket places', () => {
  it('ties semifinal losers for 3rd when the final has a winner', () => {
    const places = placesFromFinishedBracket([
      pairing({
        id: 'r1a',
        bracket_round: 'r1',
        player_1_entry_id: 'e1',
        player_2_entry_id: 'e4',
        winner_entry_id: 'e1',
      }),
      pairing({
        id: 'r1b',
        bracket_round: 'r1',
        player_1_entry_id: 'e2',
        player_2_entry_id: 'e3',
        winner_entry_id: 'e2',
      }),
      pairing({
        id: 'f',
        bracket_round: 'final',
        player_1_entry_id: 'e1',
        player_2_entry_id: 'e2',
        winner_entry_id: 'e1',
      }),
    ]);
    assert.ok(places);
    assert.equal(places.get('e1'), 1);
    assert.equal(places.get('e2'), 2);
    assert.equal(places.get('e4'), 3);
    assert.equal(places.get('e3'), 3);
  });

  it('places a 6-player bye path from losses only', () => {
    // R1 pairs everyone. The odd winner count gives seed 1 a bye in r2
    // (no pairing, so no loss). r2's loser is 3rd; R1 losers tie for 4th.
    const places = placesFromFinishedBracket([
      pairing({
        id: 'a',
        bracket_round: 'r1',
        player_1_entry_id: 'e1',
        player_2_entry_id: 'e6',
        winner_entry_id: 'e1',
      }),
      pairing({
        id: 'b',
        bracket_round: 'r1',
        player_1_entry_id: 'e2',
        player_2_entry_id: 'e5',
        winner_entry_id: 'e2',
      }),
      pairing({
        id: 'c',
        bracket_round: 'r1',
        player_1_entry_id: 'e3',
        player_2_entry_id: 'e4',
        winner_entry_id: 'e3',
      }),
      pairing({
        id: 'r2',
        bracket_round: 'r2',
        player_1_entry_id: 'e2',
        player_2_entry_id: 'e3',
        winner_entry_id: 'e2',
      }),
      pairing({
        id: 'f',
        bracket_round: 'final',
        player_1_entry_id: 'e1',
        player_2_entry_id: 'e2',
        winner_entry_id: 'e1',
      }),
    ]);
    assert.ok(places);
    assert.equal(places.get('e1'), 1);
    assert.equal(places.get('e2'), 2);
    assert.equal(places.get('e3'), 3);
    assert.equal(places.get('e4'), 4);
    assert.equal(places.get('e5'), 4);
    assert.equal(places.get('e6'), 4);
    assert.equal(places.has('missing'), false);
  });

  it('awards nothing when the final is still open', () => {
    assert.equal(
      placesFromFinishedBracket([
        pairing({
          id: 'f',
          bracket_round: 'final',
          status: 'scheduled',
          winner_entry_id: null,
        }),
      ]),
      null
    );
  });
});

describe('player points from a tournament', () => {
  it('skips stroke players who never logged a counting round', () => {
    const results = playerPointsFromTournament({
      format: 'stroke',
      standings: [
        standing({ entryId: 'a', userId: 'u1', rank: 1, roundsPlayed: 2 }),
        standing({ entryId: 'b', userId: 'u2', rank: 2, roundsPlayed: 0, lowNet: null }),
      ],
      entries: [
        { id: 'a', user_id: 'u1', league_team_id: null },
        { id: 'b', user_id: 'u2', league_team_id: null },
      ],
    });
    assert.deepEqual(results, [{ userId: 'u1', points: 10 }]);
  });

  it('gives every teammate the team place', () => {
    const results = playerPointsFromTournament({
      format: 'scramble',
      standings: [
        standing({
          entryId: 't1',
          rank: 2,
          isTeam: true,
          teamId: 't1',
          roundsPlayed: 1,
        }),
        standing({
          entryId: 't2',
          rank: 3,
          isTeam: true,
          teamId: 't2',
          roundsPlayed: 0,
          lowNet: null,
        }),
      ],
      entries: [
        { id: 'e1', user_id: 'u1', league_team_id: 't1' },
        { id: 'e2', user_id: 'u2', league_team_id: 't1' },
        { id: 'e3', user_id: 'u3', league_team_id: 't2' },
      ],
    });
    assert.deepEqual(results, [
      { userId: 'u1', points: 8 },
      { userId: 'u2', points: 8 },
    ]);
  });

  it('gives the champion 1st-place points and ties the semifinal losers', () => {
    const results = playerPointsFromTournament({
      format: 'match_play',
      pairingMethod: 'bracket',
      standings: [],
      entries: [
        { id: 'e1', user_id: 'u1', league_team_id: null },
        { id: 'e2', user_id: 'u2', league_team_id: null },
        { id: 'e3', user_id: 'u3', league_team_id: null },
        { id: 'e4', user_id: 'u4', league_team_id: null },
      ],
      pairings: [
        pairing({
          id: 'r1a',
          bracket_round: 'r1',
          player_1_entry_id: 'e1',
          player_2_entry_id: 'e4',
          winner_entry_id: 'e1',
        }),
        pairing({
          id: 'r1b',
          bracket_round: 'r1',
          player_1_entry_id: 'e2',
          player_2_entry_id: 'e3',
          winner_entry_id: 'e2',
        }),
        pairing({
          id: 'f',
          bracket_round: 'final',
          player_1_entry_id: 'e1',
          player_2_entry_id: 'e2',
          winner_entry_id: 'e1',
        }),
      ],
    });
    const byUser = Object.fromEntries(results.map((r) => [r.userId, r.points]));
    assert.equal(byUser.u1, 10);
    assert.equal(byUser.u2, 8);
    assert.equal(byUser.u3, 6);
    assert.equal(byUser.u4, 6);
  });
});

describe('season best-N', () => {
  it('keeps the best 2 of 3 and does not penalize a skipped event', () => {
    const rows = computeSeasonStandings(
      [
        { userId: 'amy', points: 10 },
        { userId: 'amy', points: 6 },
        { userId: 'amy', points: 1 },
        { userId: 'ben', points: 8 },
      ],
      2,
      { amy: 'Amy', ben: 'Ben' }
    );
    const amy = rows.find((r) => r.userId === 'amy');
    const ben = rows.find((r) => r.userId === 'ben');
    assert.equal(amy?.totalPoints, 16);
    assert.equal(amy?.eventsCounted, 2);
    assert.equal(amy?.eventsPlayed, 3);
    assert.equal(ben?.totalPoints, 8);
    assert.equal(ben?.eventsCounted, 1);
    assert.equal(ben?.eventsPlayed, 1);
    assert.equal(rows[0]?.userId, 'amy');
  });
});
