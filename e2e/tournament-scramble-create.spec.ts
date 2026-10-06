import { test } from '@playwright/test';
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

test('scramble: create wizard completes', async ({ page }) => {
  acceptNativeDialogs(page);
  await loginAsSeedUser(page);
  await goToSocial(page);
  await selectGroupTab(page, seedGroupName);

  const name = uniqueTournamentName('Scramble');
  await openCreateTournament(page);
  await completeTournamentWizard(page, { format: 'scramble', name });

  await selectGroupTab(page, seedGroupName);
  await expectTournamentListed(page, { name, format: 'scramble' });
});
