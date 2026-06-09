/**
 * Tournament scoring unit tests (Phase 7).
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateBestBallTeamRounds,
  bestBallStandingsScores,
  validateBestBallTeamSizes,
} from '../bestBallTournament';
import {
  computeScrambleTeamIndex,
  validateScrambleTeamSizes,
} from '../scrambleTournament';
import { formatTeamMemberSummary } from '../teamRosterDisplay';
import {
  autoAssignMembersToTeams,
  describePlayersPerTeamOption,
  isValidPlayersPerTeam,
  isValidTeamSplit,
  MAX_TEAM_COUNT,
  suggestPlayersPerTeam,
  unevenSplitMessage,
  validateCustomPlayersPerTeamInput,
  validPresetPlayersPerTeam,
} from '../tournamentTeamCount';
import { reconcileGrossWithHoles } from '../tournamentReconciliation';
import type { DbTournamentTeamHoleScoreRow } from '../tournamentTypes';

describe('reconcileGrossWithHoles', () => {
  it('flags mismatch between hole sum and logged gross', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      hole_number: i + 1,
      gross_score: 4,
    }));
    const r = reconcileGrossWithHoles(holes, 70);
    assert.equal(r.matches, false);
    assert.equal(r.delta, 2);
  });

  it('passes when totals match', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      hole_number: i + 1,
      gross_score: 4,
    }));
    const r = reconcileGrossWithHoles(holes, 72);
    assert.equal(r.matches, true);
  });
});

describe('scramble validation', () => {
  it('requires at least two players per team', () => {
    assert.match(
      validateScrambleTeamSizes([{ name: 'A', memberIds: ['1'] }]) ?? '',
      /at least 2/
    );
    assert.equal(
      validateScrambleTeamSizes([{ name: 'A', memberIds: ['1', '2', '3'] }]),
      null
    );
  });

  it('computes 15/85 team index', () => {
    assert.equal(computeScrambleTeamIndex([8, 18]), 16.5);
  });
});

describe('best ball aggregation', () => {
  const teamId = 'team-1';
  const leagueId = 'league-1';

  function holeRow(
    hole: number,
    score: number,
    partial: boolean,
    date = '2026-05-01'
  ): DbTournamentTeamHoleScoreRow {
    return {
      id: `h-${hole}`,
      league_id: leagueId,
      league_team_id: teamId,
      round_date: date,
      hole_number: hole,
      team_score: score,
      team_net_score: score,
      is_partial: partial,
      source_league_round_id: null,
      created_at: '',
      updated_at: '',
    };
  }

  it('excludes partial rounds from standings scores', () => {
    const rows = Array.from({ length: 18 }, (_, i) => holeRow(i + 1, 4, true));
    const agg = aggregateBestBallTeamRounds(rows, teamId, false);
    const { netScores, hasPartialPending } = bestBallStandingsScores(agg, false);
    assert.equal(netScores.length, 0);
    assert.equal(hasPartialPending, true);
  });

  it('includes complete team rounds', () => {
    const rows = Array.from({ length: 18 }, (_, i) => holeRow(i + 1, 4, false));
    const agg = aggregateBestBallTeamRounds(rows, teamId, false);
    const { netScores, grossScores } = bestBallStandingsScores(agg, false);
    assert.deepEqual(netScores, [72]);
    assert.deepEqual(grossScores, [72]);
  });
});

describe('match play gross comparison', () => {
  it('compares gross scores hole by hole', async () => {
    const { compareMatchPlayGrossHoles } = await import('../matchPlayGrossCompare');
    const mine = Array.from({ length: 18 }, (_, i) => ({
      hole_number: i + 1,
      gross_score: i < 9 ? 4 : 5,
    }));
    const theirs = Array.from({ length: 18 }, (_, i) => ({
      hole_number: i + 1,
      gross_score: 5,
    }));
    const { summary } = compareMatchPlayGrossHoles(mine, theirs);
    assert.ok(summary.wins > 0);
    assert.ok(summary.net_holes > 0);
  });
});

describe('league auto-completion', () => {
  it('completes match play when all pairings are resolved', async () => {
    const { isLeagueReadyToAutoComplete } = await import('../leagueCompletion');
    const league = {
      format: 'match_play',
      rounds_that_count: 1,
      use_handicap: true,
    } as import('../leagues').DbLeagueRow;
    assert.equal(
      isLeagueReadyToAutoComplete({
        league,
        teams: [],
        entries: [],
        rounds: [],
        pairings: [
          {
            id: 'p1',
            status: 'complete',
          } as import('../matchPlayTournamentPairings').DbLeagueMatchPairingRow,
        ],
      }),
      true
    );
    assert.equal(
      isLeagueReadyToAutoComplete({
        league,
        teams: [],
        entries: [],
        rounds: [],
        pairings: [{ id: 'p1', status: 'scheduled' } as import('../matchPlayTournamentPairings').DbLeagueMatchPairingRow],
      }),
      false
    );
  });

  it('completes bracket match play when final has a winner', async () => {
    const { isLeagueReadyToAutoComplete } = await import('../leagueCompletion');
    const league = {
      format: 'match_play',
      match_play_pairing_method: 'bracket',
      rounds_that_count: 1,
      use_handicap: true,
    } as import('../leagues').DbLeagueRow;
    const final = {
      id: 'f',
      bracket_round: 'final',
      status: 'halved',
      winner_entry_id: 'e1',
    } as import('../matchPlayPairingTypes').DbLeagueMatchPairingRow;
    assert.equal(
      isLeagueReadyToAutoComplete({
        league,
        teams: [],
        entries: [],
        rounds: [],
        pairings: [final, { id: 'r1', status: 'scheduled' } as typeof final],
      }),
      true
    );
    assert.equal(
      isLeagueReadyToAutoComplete({
        league,
        teams: [],
        entries: [],
        rounds: [],
        pairings: [{ ...final, status: 'scheduled', winner_entry_id: null }],
      }),
      false
    );
  });

  it('completes scramble when every team has enough rounds', async () => {
    const { isLeagueReadyToAutoComplete } = await import('../leagueCompletion');
    const league = {
      format: 'scramble',
      rounds_that_count: 2,
      use_handicap: true,
    } as import('../leagues').DbLeagueRow;
    const teams = [
      { id: 't1', league_id: 'l', name: 'A', designated_scorer_id: null, created_at: '' },
      { id: 't2', league_id: 'l', name: 'B', designated_scorer_id: null, created_at: '' },
    ] as import('../leagues').DbLeagueTeamRow[];
    const rounds = [
      { league_team_id: 't1', player_opted_in: true, hole_entry_status: 'complete', user_id: 'u1' },
      { league_team_id: 't1', player_opted_in: true, hole_entry_status: 'complete', user_id: 'u1' },
      { league_team_id: 't2', player_opted_in: true, hole_entry_status: 'complete', user_id: 'u2' },
      { league_team_id: 't2', player_opted_in: true, hole_entry_status: 'complete', user_id: 'u2' },
    ] as import('../leagues').DbLeagueRoundRow[];
    assert.equal(
      isLeagueReadyToAutoComplete({ league, teams, entries: [], rounds }),
      true
    );
  });
});

describe('best ball team size', () => {
  it('requires at least two players per team', () => {
    assert.match(
      validateBestBallTeamSizes([{ name: 'Solo', memberIds: ['a'] }]) ?? '',
      /at least 2/
    );
  });
});

describe('formatTeamMemberSummary', () => {
  it('truncates long member lists', () => {
    const line = formatTeamMemberSummary(['A', 'B', 'C', 'D', 'E'], 3);
    assert.equal(line, 'A, B, C +2 more');
  });
});

describe('tournament players per team', () => {
  it('suggests 3 players per team for 9 players in best ball', () => {
    const r = suggestPlayersPerTeam(9, 'best_ball');
    assert.equal(r.suggestedPlayersPerTeam, 3);
    assert.equal(r.suggestedTeamCount, 3);
    assert.deepEqual(r.validPreset, [3]);
  });

  it('defaults to 2 per team for 8 players', () => {
    const r = suggestPlayersPerTeam(8, 'best_ball');
    assert.equal(r.suggestedPlayersPerTeam, 2);
    assert.equal(r.suggestedTeamCount, 4);
    assert.deepEqual(r.validPreset.sort(), [2, 4]);
    assert.equal(r.showsCustom, false);
  });

  it('defaults to 2 per team (5 teams) for 10 players', () => {
    const r = suggestPlayersPerTeam(10, 'best_ball');
    assert.equal(r.suggestedPlayersPerTeam, 2);
    assert.equal(r.suggestedTeamCount, 5);
    assert.deepEqual(r.validPreset, [2, 5]);
    const three = describePlayersPerTeamOption(10, 3, 'best_ball');
    assert.equal(three.disabled, true);
    assert.equal(three.sub, unevenSplitMessage(10, 3));
    const four = describePlayersPerTeamOption(10, 4, 'best_ball');
    assert.equal(four.disabled, true);
    assert.equal(four.sub, unevenSplitMessage(10, 4));
  });

  it('uses same per-team rules for scramble as best ball', () => {
    assert.equal(isValidPlayersPerTeam(9, 3, 'scramble'), true);
    assert.equal(isValidPlayersPerTeam(10, 5, 'scramble'), true);
    assert.equal(isValidPlayersPerTeam(10, 5, 'best_ball'), true);
    assert.deepEqual(validPresetPlayersPerTeam(9, 'scramble'), [3]);
    assert.deepEqual(validPresetPlayersPerTeam(10, 'scramble'), [2, 5]);
    const r = suggestPlayersPerTeam(10, 'scramble');
    assert.ok(r.validPreset.includes(5));
  });

  it('suggests 5 per team for 25 players via preset', () => {
    const r = suggestPlayersPerTeam(25, 'best_ball');
    assert.equal(r.suggestedPlayersPerTeam, 5);
    assert.equal(r.suggestedTeamCount, 5);
    assert.deepEqual(r.validPreset, [5]);
    assert.equal(r.showsCustom, false);
    assert.equal(isValidPlayersPerTeam(25, 5, 'best_ball'), true);
  });

  it('shows custom option for large even groups', () => {
    const r = suggestPlayersPerTeam(24, 'best_ball');
    assert.equal(r.showsCustom, true);
    assert.ok(isValidPlayersPerTeam(24, 6, 'best_ball'));
  });

  it('enforces max team count', () => {
    assert.equal(isValidPlayersPerTeam(52, 2, 'best_ball'), false);
    assert.match(
      validateCustomPlayersPerTeamInput('1', 52, 'best_ball') ?? '',
      /Minimum/
    );
    const err = validateCustomPlayersPerTeamInput('6', 156, 'best_ball');
    assert.match(err ?? '', new RegExp(String(MAX_TEAM_COUNT)));
  });

  it('auto-assign puts every player on a team when handicaps are known', () => {
    const members = [
      { userId: 'a', handicap: 18 },
      { userId: 'b', handicap: 12 },
      { userId: 'c', handicap: 8 },
      { userId: 'd', handicap: 22 },
      { userId: 'e', handicap: 15 },
      { userId: 'f', handicap: 10 },
    ];
    const teams = autoAssignMembersToTeams(members, 3, false);
    assert.equal(teams.length, 3);
    const assigned = teams.flatMap((t) => t.memberIds);
    assert.equal(assigned.length, members.length);
    assert.deepEqual([...assigned].sort(), members.map((m) => m.userId).sort());
    for (const t of teams) {
      assert.equal(t.memberIds.length, 2);
    }
  });

  it('auto-assign skips players without handicap unless randomize flag set', () => {
    const empty = autoAssignMembersToTeams(
      [
        { userId: 'a', handicap: 10 },
        { userId: 'b', handicap: null },
      ],
      2,
      false
    );
    assert.equal(empty.every((t) => t.memberIds.length === 0), true);

    const withRandom = autoAssignMembersToTeams(
      [
        { userId: 'a', handicap: 10 },
        { userId: 'b', handicap: null },
        { userId: 'c', handicap: 14 },
        { userId: 'd', handicap: null },
      ],
      2,
      false,
      { randomizeMissingHandicap: true }
    );
    assert.equal(withRandom.flatMap((t) => t.memberIds).length, 4);
  });
});
