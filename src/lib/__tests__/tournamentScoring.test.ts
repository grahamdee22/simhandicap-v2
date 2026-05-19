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
  it('rejects odd team sizes', () => {
    assert.match(
      validateScrambleTeamSizes([{ name: 'A', memberIds: ['1', '2', '3'] }]) ?? '',
      /even/
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
    const { scores, hasPartialPending } = bestBallStandingsScores(agg, false);
    assert.equal(scores.length, 0);
    assert.equal(hasPartialPending, true);
  });

  it('includes complete team rounds', () => {
    const rows = Array.from({ length: 18 }, (_, i) => holeRow(i + 1, 4, false));
    const agg = aggregateBestBallTeamRounds(rows, teamId, false);
    const { scores } = bestBallStandingsScores(agg, false);
    assert.deepEqual(scores, [72]);
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
