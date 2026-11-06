/**
 * Regressions from the Nov 2026 tournament / side-games QA pass.
 * Run with the rest of the unit gate: npm test
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { join } from 'node:path';
import { leagueDetailStatusBadge } from '../leagueStandings';
import { shouldAutoCompleteLeague } from '../leagueCompletion';
import { PAIRING_STATUS_I18N_KEY } from '../matchPlayBracket';
import { computeNassau } from '../nassau';
import {
  computeIndividualSideGamesBoard,
  computeTeamSideGamesBoard,
  courseHandicapForSideGame,
  nassauResultsFromScorecards,
  teamCardsFromTeamHoleScores,
} from '../sideGameCompute';
import type { DbLeagueRow } from '../leagues';
import type { DbTournamentTeamHoleScoreRow } from '../tournamentTypes';

const root = join(import.meta.dirname, '../../..');

function locale(code: 'en' | 'es' | 'ko'): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, `src/i18n/locales/${code}.json`), 'utf8'));
}

function dig(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur == null || typeof cur !== 'object') return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

function teamRow(
  teamId: string,
  hole: number,
  net: number,
  partial = false
): DbTournamentTeamHoleScoreRow {
  return {
    id: `${teamId}-${hole}`,
    league_id: 'L',
    league_team_id: teamId,
    round_date: '2026-11-04',
    hole_number: hole,
    team_score: net + 1,
    team_net_score: net,
    is_partial: partial,
    source_league_round_id: null,
    created_at: '',
    updated_at: '',
  };
}

describe('match status i18n keys', () => {
  it('match badges use matchPlay.status / league.match keys in en, es, and ko', () => {
    const statuses = ['scheduled', 'in_progress', 'complete', 'halved'] as const;
    for (const code of ['en', 'es', 'ko'] as const) {
      const messages = locale(code);
      for (const status of statuses) {
        const key = PAIRING_STATUS_I18N_KEY[status];
        const value = dig(messages, key);
        assert.equal(typeof value, 'string', `${code} ${key}`);
        assert.notEqual(value, key, `${code} still has the raw key for ${status}`);
        assert.equal(String(value).includes('match.status.'), false, `${code} ${key}`);
      }
      const needs = dig(messages, 'league.detail.needsResults');
      const completed = dig(messages, 'season.detail.statusCompleted');
      assert.equal(typeof needs, 'string');
      assert.notEqual(needs, 'league.detail.needsResults');
      assert.equal(typeof completed, 'string');
      assert.notEqual(completed, 'season.detail.statusCompleted');
    }
  });
});

describe('match play completion vs the date window', () => {
  const matchPlay = {
    format: 'match_play',
    status: 'active',
    start_date: '2026-11-03',
    end_date: '2026-12-01',
  } as DbLeagueRow;

  it('flips to completed when the bracket is ready before the end date', () => {
    assert.equal(shouldAutoCompleteLeague(matchPlay, '2026-11-06', true), true);
    assert.equal(leagueDetailStatusBadge({ ...matchPlay, status: 'completed' }, '2026-11-06'), 'completed');
  });

  it('stays open and shows Needs results when the window ends with the final unplayed', () => {
    const past = { ...matchPlay, end_date: '2026-10-29' };
    assert.equal(shouldAutoCompleteLeague(past, '2026-11-06', false), false);
    assert.equal(leagueDetailStatusBadge(past, '2026-11-06'), 'needsResults');
    assert.notEqual(leagueDetailStatusBadge(past, '2026-11-06'), 'completed');
  });

  it('migration 098 completes a resolved bracket in the database, not only in the client', () => {
    const sql = readFileSync(
      join(root, 'supabase/migrations/098_complete_match_play_when_bracket_resolves.sql'),
      'utf8'
    );
    assert.match(sql, /mark_match_play_league_completed_if_resolved/);
    assert.match(sql, /bracket_round = 'final'/);
    assert.match(sql, /winner_entry_id is not null/);
    assert.match(sql, /set status = 'completed'/);
    assert.match(sql, /league_match_pairings_complete_league/);
  });
});

describe('scorecard kept after a finished match round is deleted', () => {
  it('migration 097 does not delete rounds linked to a complete or halved pairing', () => {
    const sql = readFileSync(
      join(root, 'supabase/migrations/097_keep_finished_match_scorecards.sql'),
      'utf8'
    );
    assert.match(sql, /p\.status in \('complete', 'halved'\)/);
    assert.match(sql, /league_match_pairing_rounds/);
    assert.match(sql, /not exists/);
  });

  it('Nassau still resolves from the remaining card and Skins do not invent a result', () => {
    const p2 = ['W', 'L', 'H', 'W', 'W', 'L', 'H', 'W', 'L'] as const;
    const results = nassauResultsFromScorecards(
      [],
      p2.map((result, i) => ({ hole_number: i + 1, result })),
      9
    );
    const nassau = computeNassau(results, 9);
    assert.equal(nassau.segments[0].resolved, true);
    assert.equal(nassau.segments[0].p1Wins, 3);
    assert.equal(nassau.segments[0].p2Wins, 4);

    const oneCard = computeIndividualSideGamesBoard({
      flags: { skins: true, stableford: true },
      cards: [
        {
          userId: 'p2',
          displayName: 'Remaining',
          courseHandicap: 4,
          holes: [{ hole_number: 1, gross_score: 4 }],
        },
      ],
      holeCount: 1,
      useHandicap: true,
      strokeIndexByHole: [1],
      nine: null,
      pars: [4],
    });
    assert.equal(oneCard.skins, null);
    assert.ok((oneCard.stableford?.totals.p2 ?? 0) > 0);
  });
});

describe('team side games after both teams have submitted', () => {
  it('resolves Skins and Stableford, including a team whose player has no handicap', () => {
    assert.equal(
      courseHandicapForSideGame({
        index: null,
        useHandicap: true,
        course: null,
        holesPlayed: '18',
      }),
      0
    );
    const cards = teamCardsFromTeamHoleScores(
      [
        teamRow('withIndex', 1, 3),
        teamRow('withIndex', 2, 5),
        teamRow('noIndex', 1, 4),
        teamRow('noIndex', 2, 4),
      ],
      [
        { id: 'withIndex', displayName: 'Has index' },
        { id: 'noIndex', displayName: 'No HCP' },
      ],
      2,
      true
    );
    const board = computeTeamSideGamesBoard({
      flags: { skins: true, stableford: true },
      cards,
      holeCount: 2,
      pars: [4, 4],
    });
    assert.equal(board.skins?.holes.every((h) => h.awarded), true);
    assert.equal(board.skins?.holes[0].winnerId, 'withIndex');
    assert.equal(board.skins?.holes[1].winnerId, 'noIndex');
    assert.equal(board.stableford?.totals.withIndex, 3 + 1);
    assert.equal(board.stableford?.totals.noIndex, 2 + 2);
  });

  it('does not pay Skins while one team is still missing a player', () => {
    const cards = teamCardsFromTeamHoleScores(
      [teamRow('a', 1, 3), teamRow('b', 1, 4, true)],
      [
        { id: 'a', displayName: 'A' },
        { id: 'b', displayName: 'B' },
      ],
      1,
      true
    );
    const board = computeTeamSideGamesBoard({
      flags: { skins: true, stableford: true },
      cards,
      holeCount: 1,
      pars: [4],
    });
    assert.equal(board.skins?.holes[0].pending, true);
    assert.equal(board.stableford?.holes[0].complete, false);
  });
});
