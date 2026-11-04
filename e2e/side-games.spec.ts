/**
 * Side games regression coverage (Skins / Stableford / Nassau).
 *
 * Math cases (carryover, partial gating, handicap-off, team nets) import the same
 * pure modules the app uses — fastest reliable guard for silent scoring regressions.
 * UI smoke: Scramble create with Skins+Stableford and handicaps off against app.sim-cap.com.
 */
import { expect, test } from '@playwright/test';
import { computeSkins } from '../src/lib/skins';
import { computeStableford } from '../src/lib/stableford';
import { computeNassau } from '../src/lib/nassau';
import {
  computeTeamSideGamesBoard,
  netsFromGrossCard,
  teamCardsFromTeamHoleScores,
} from '../src/lib/sideGameCompute';
import type { DbTournamentTeamHoleScoreRow } from '../src/lib/tournamentTypes';
import { seedGroupName, uniqueTournamentName } from './fixtures';
import { loginAsSeedUser } from './helpers/auth';
import {
  acceptNativeDialogs,
  completeTournamentWizard,
  expectTournamentListed,
  goToSocial,
  openCreateTournament,
  selectGroupTab,
} from './helpers/tournaments';

test.describe('side games scoring regressions', () => {
  test('skins: tie carries and score edit fully recomputes from hole 1', () => {
    const before = computeSkins(
      [
        { id: 'a', nets: [4, 5, 3] },
        { id: 'b', nets: [5, 5, 4] },
      ],
      3
    );
    expect(before.holes[0].winnerId).toBe('a');
    expect(before.holes[1].carried).toBe(true);
    expect(before.holes[2].skinsWon).toBe(2);
    expect(before.totals.a).toBe(3);

    // Edit hole 1 to a tie — carryover chain must recompute (not keep hole-1 "paid").
    const after = computeSkins(
      [
        { id: 'a', nets: [5, 5, 3] },
        { id: 'b', nets: [5, 5, 4] },
      ],
      3
    );
    expect(after.holes[0].carried).toBe(true);
    expect(after.holes[1].carried).toBe(true);
    expect(after.holes[2].winnerId).toBe('a');
    expect(after.holes[2].skinsWon).toBe(3);
    expect(after.totals.a).toBe(3);
    expect(after.totals.b).toBe(0);
  });

  test('partial-round gating: skins + Stableford wait for comparable nets', () => {
    const skins = computeSkins(
      [
        { id: 'a', nets: [3, null, 4] },
        { id: 'b', nets: [4, 4, 5] },
      ],
      3
    );
    expect(skins.holes[0].awarded).toBe(true);
    expect(skins.holes[1].pending).toBe(true);
    expect(skins.holes[2].pending).toBe(true);

    const sf = computeStableford(
      [
        { id: 'a', nets: [3, null] },
        { id: 'b', nets: [4, 4] },
      ],
      [4, 4],
      2
    );
    expect(sf.holes[0].complete).toBe(true);
    expect(sf.holes[1].complete).toBe(false);
    expect(sf.holes[1].pointsById).toEqual({});
    expect(sf.totals.a).toBe(3);
    expect(sf.totals.b).toBe(2);
  });

  test('use_handicap=false: net equals gross for individual and team paths', () => {
    const nets = netsFromGrossCard({
      holes: [
        { hole_number: 1, gross_score: 5 },
        { hole_number: 2, gross_score: 3 },
      ],
      holeCount: 2,
      useHandicap: false,
      courseHandicap: 22,
      strokeIndexByHole: Array.from({ length: 18 }, (_, i) => i + 1),
      nine: null,
    });
    expect(nets).toEqual([5, 3]);

    const teamRow = (
      teamId: string,
      hole: number,
      gross: number,
      net: number
    ): DbTournamentTeamHoleScoreRow => ({
      id: `${teamId}-${hole}`,
      league_id: 'L',
      league_team_id: teamId,
      round_date: '2026-06-01',
      hole_number: hole,
      team_score: gross,
      team_net_score: net,
      is_partial: false,
      source_league_round_id: null,
      created_at: '',
      updated_at: '',
    });
    const cards = teamCardsFromTeamHoleScores(
      [teamRow('t1', 1, 4, 1), teamRow('t2', 1, 5, 2)],
      [
        { id: 't1', displayName: 'A' },
        { id: 't2', displayName: 'B' },
      ],
      1,
      false
    );
    expect(cards[0].nets).toEqual([4]);
    expect(cards[1].nets).toEqual([5]);
  });

  test('Scramble/Best Ball: team_net_score drives Skins + Stableford (not individuals)', () => {
    const row = (
      teamId: string,
      hole: number,
      net: number
    ): DbTournamentTeamHoleScoreRow => ({
      id: `${teamId}-${hole}`,
      league_id: 'L',
      league_team_id: teamId,
      round_date: '2026-06-01',
      hole_number: hole,
      team_score: net + 1,
      team_net_score: net,
      is_partial: false,
      source_league_round_id: null,
      created_at: '',
      updated_at: '',
    });
    const cards = teamCardsFromTeamHoleScores(
      [
        row('alpha', 1, 3),
        row('alpha', 2, 4),
        row('bravo', 1, 4),
        row('bravo', 2, 3),
      ],
      [
        { id: 'alpha', displayName: 'Alpha' },
        { id: 'bravo', displayName: 'Bravo' },
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
    expect(board.skins?.holes[0].winnerId).toBe('alpha');
    expect(board.skins?.holes[1].winnerId).toBe('bravo');
    expect(board.stableford?.totals.alpha).toBe(3 + 2);
    expect(board.stableford?.totals.bravo).toBe(2 + 3);
  });

  test('9-hole Nassau collapses to a single overall bet', () => {
    const results = Array.from({ length: 9 }, (_, i) =>
      i < 5 ? ('W' as const) : ('H' as const)
    );
    const r = computeNassau(results, 9);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].key).toBe('overall');
    expect(r.segments[0].winner).toBe('p1');
    expect(r.segments[0].p1Wins).toBe(5);
    expect(r.segments[0].halved).toBe(4);
  });
});

test('scramble UI: enable Skins+Stableford with handicaps off', async ({ page }) => {
  acceptNativeDialogs(page);
  await loginAsSeedUser(page);
  await goToSocial(page);
  await selectGroupTab(page, seedGroupName);

  const name = uniqueTournamentName('SG Scramble');
  await openCreateTournament(page);
  await completeTournamentWizard(page, {
    format: 'scramble',
    name,
    sideGames: ['skins', 'stableford'],
    useHandicap: false,
    stopAtReview: true,
  });

  await expect(page.getByText('Review & Launch', { exact: true })).toBeVisible();
  await expect(page.getByText(/Side games:\s*Skins,\s*Stableford/i).first()).toBeVisible();
  await expect(page.getByText(/handicap.*off/i).first()).toBeVisible();

  await page.getByText('Launch Tournament', { exact: true }).click();
  await expect(page.getByText('My Groups', { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
  await selectGroupTab(page, seedGroupName);
  await expectTournamentListed(page, { name, format: 'scramble' });
});
