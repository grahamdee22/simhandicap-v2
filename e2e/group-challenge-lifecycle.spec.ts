/**
 * Group Challenges end-to-end against app.sim-cap.com.
 * Requires: npm run seed:group-challenge-qa (Walter dual-admin on QA A/B).
 */
import { expect, test } from '@playwright/test';
import { seedUser, uniqueChallengeName } from './fixtures';
import { loginAsSeedUser } from './helpers/auth';
import {
  acceptChallenge,
  activateChallenge,
  beginGroupChallengeTest,
  chooseVerifiedVerification,
  createAndSendCasualChallenge,
  enableGroupChallengeToggle,
  expectDualMemberPendingUi,
  logCasualChallengeRound,
  pickOpponentGroup,
  pickRosterByNames,
  qaChallengeCompanionsA,
  qaChallengeCompanionsB,
  qaChallengeGroupA,
  qaChallengeGroupB,
  saveChallengedRoster,
} from './helpers/groupChallenges';
import {
  clickContinue,
  goToSocial,
  openCreateTournament,
  pickCoursePebble,
  selectGroupTab,
} from './helpers/tournaments';

test.describe.configure({ mode: 'serial' });

test('group challenge: create → dual UI → accept → roster → activate → casual round Counted', async ({
  page,
}) => {
  beginGroupChallengeTest(page);
  await loginAsSeedUser(page);

  const name = uniqueChallengeName();
  await createAndSendCasualChallenge(page, { name });

  // Dual-member pending UI (Walter is admin of A and B).
  await expectDualMemberPendingUi(page, {
    sentGroup: qaChallengeGroupA,
    otherGroup: qaChallengeGroupB,
  });

  await acceptChallenge(page);

  // Challenged roster — 5 B companions (Walter stays on A only).
  await saveChallengedRoster(page, [...qaChallengeCompanionsB]);
  // Both sides 5/5 without reload (stale-UI regression).
  await expect(page.getByText(/5\/5 players/i)).toHaveCount(2, { timeout: 30_000 });

  await activateChallenge(page);

  await logCasualChallengeRound(page, 84);
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
});

test('group challenge: Verified mode shows screenshot copy (upload left as gap)', async ({
  page,
}) => {
  beginGroupChallengeTest(page);
  await loginAsSeedUser(page);
  await goToSocial(page);
  await selectGroupTab(page, qaChallengeGroupA);
  await openCreateTournament(page);

  const name = `${uniqueChallengeName()} Verified`;
  await page.getByPlaceholder(/Facility Cup|Spring League/).fill(name);
  await enableGroupChallengeToggle(page);
  await clickContinue(page);
  await pickOpponentGroup(page, qaChallengeGroupB);
  await clickContinue(page);
  await pickRosterByNames(page, [seedUser.displayName, ...qaChallengeCompanionsA.slice(0, 4)]);
  await clickContinue(page);

  await pickCoursePebble(page);
  await chooseVerifiedVerification(page);
  await expect(
    page.getByText(/Scorecard evidence \+ admin approval/i).first()
  ).toBeVisible();
  await clickContinue(page);

  await expect(page.getByText(/5v5 · Verified · 18 holes/i).first()).toBeVisible({
    timeout: 20_000,
  });
  // Stop before send — Verified screenshot upload/approval is a documented automation gap.
});
