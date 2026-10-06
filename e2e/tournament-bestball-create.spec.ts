import { test } from '@playwright/test';
import { uniqueTournamentName } from './fixtures';
import { loginAsSeedUser } from './helpers/auth';
import {
  acceptNativeDialogs,
  completeTournamentWizard,
  expectTournamentListed,
  goToSocial,
  openCreateTournament,
  selectGroupTab,
} from './helpers/tournaments';

test('best ball: create wizard completes', async ({ page }) => {
  acceptNativeDialogs(page);
  await loginAsSeedUser(page);
  await goToSocial(page);
  // Dedicated seed group so suite formats don't all stack schedules on Basement Boys.
  await selectGroupTab(page, 'The Scratch Pad');

  const name = uniqueTournamentName('Best Ball');
  await openCreateTournament(page);
  await completeTournamentWizard(page, { format: 'best_ball', name });

  await selectGroupTab(page, 'The Scratch Pad');
  await expectTournamentListed(page, { name, format: 'best_ball' });
});
