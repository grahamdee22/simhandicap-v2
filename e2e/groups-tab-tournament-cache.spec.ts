/**
 * Social page: Tournament section must re-key when switching group tabs
 * (regression for Oct 27 2026 stale-cache bug).
 */
import { expect, test } from '@playwright/test';
import { seedGroupName } from './fixtures';
import { loginAsSeedUser } from './helpers/auth';
import {
  beginGroupChallengeTest,
  expectTournamentSectionMatchesTab,
  qaChallengeCompanionsA,
  qaChallengeCompanionsB,
  qaChallengeGroupA,
  qaChallengeGroupB,
  tournamentSectionSnippet,
} from './helpers/groupChallenges';
import { goToSocial, selectGroupTab } from './helpers/tournaments';

/** Non-generic tournament-body markers (league / season / challenge titles). */
function distinctiveMarkers(snippet: string): string[] {
  const skip =
    /^(Create Tournament|Schedule next tournament|No active tournament|Coming up|Group Challenges|View challenge|Start a season|See full standings|Season standings|days left)$/i;
  return snippet
    .split(/\n|·/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10 && !skip.test(s))
    .slice(0, 12);
}

test('social group tabs: Tournament section updates for each selected group', async ({
  page,
}) => {
  beginGroupChallengeTest(page);
  await loginAsSeedUser(page);
  await goToSocial(page);

  // Member probe: "(you)" suffix is fine — exact:false in helper.
  const basement = await expectTournamentSectionMatchesTab(
    page,
    seedGroupName,
    'Walter'
  );
  const basementMarkers = distinctiveMarkers(basement);

  await selectGroupTab(page, qaChallengeGroupA);
  await expect(page.getByText(qaChallengeCompanionsA[0], { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
  const groupA = await tournamentSectionSnippet(page);
  expect(groupA.length).toBeGreaterThan(10);

  // Previous group's distinctive tournament titles must not bleed through.
  for (const marker of basementMarkers) {
    if (
      !groupA.includes(marker) &&
      /E2E|League|Cup|Season|Challenge|Stroke|Scramble|Match/i.test(marker)
    ) {
      expect(
        groupA,
        `stale marker from Basement Boys still visible on QA A: ${marker}`
      ).not.toContain(marker);
    }
  }

  await selectGroupTab(page, qaChallengeGroupB);
  await expect(page.getByText(qaChallengeCompanionsB[0], { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
  const groupB = await tournamentSectionSnippet(page);
  expect(groupB.length).toBeGreaterThan(10);

  const aMarkers = distinctiveMarkers(groupA).filter((m) =>
    /E2E|QA|Challenge|Season|Cup/i.test(m)
  );
  for (const marker of aMarkers) {
    if (!groupB.includes(marker)) {
      expect(groupB, `stale marker from QA A still visible on QA B: ${marker}`).not.toContain(
        marker
      );
    }
  }

  // Third → first again: Basement content returns (member list + tournament body).
  const basementAgain = await expectTournamentSectionMatchesTab(
    page,
    seedGroupName,
    'Walter'
  );
  expect(basementAgain.length).toBeGreaterThan(10);
});
