import { expect, test } from '@playwright/test';
import { uniqueGroupName, uniqueTournamentName } from './fixtures';
import { loginAsSeedUser } from './helpers/auth';
import {
  acceptNativeDialogs,
  completeTournamentWizard,
  expectTournamentListed,
  goToSocial,
  openCreateTournament,
  selectGroupTab,
} from './helpers/tournaments';

test('stroke play: create, log round, appear in standings', async ({ page }) => {
  acceptNativeDialogs(page);
  await loginAsSeedUser(page);
  await goToSocial(page);

  // Fresh group avoids date-overlap with leftover E2E tournaments on seed crews.
  // Stroke only needs the creator — team formats still use Basement Boys.
  const groupName = uniqueGroupName().replace('Delete Test', 'Stroke Group');
  await page.getByRole('button', { name: 'Create a new group', exact: true }).click();
  await expect(page.getByText('New group', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Group name').fill(groupName);
  await page.getByText('Create', { exact: true }).click();
  await expect(page.getByText(groupName, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await selectGroupTab(page, groupName);

  const tournamentName = uniqueTournamentName('Stroke');
  await openCreateTournament(page);
  await completeTournamentWizard(page, { format: 'stroke', name: tournamentName });

  await selectGroupTab(page, groupName);
  await expectTournamentListed(page, {
    name: tournamentName,
    format: 'stroke',
    requireActiveToday: true,
  });

  await page.getByText('Log a round', { exact: true }).first().click();
  await expect(page.getByText('Save round', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  // Social chrome stays mounted on web — tournament name can appear twice.
  await expect(page.getByText(tournamentName, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByText('Save round', { exact: true }).click();

  // Save replaces the tab with Round analysis — wait for it, then switch back via the tab.
  await expect(page.getByRole('heading', { name: 'Round analysis' })).toBeVisible({
    timeout: 30_000,
  });
  await goToSocial(page);
  await selectGroupTab(page, groupName);
  await expect(page.getByText(tournamentName, { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByText(tournamentName, { exact: true }).first().click({ force: true });

  await expect(page.getByText(/Walter White/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/No scores yet/i)).toHaveCount(0);
});
