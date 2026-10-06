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

test('match play: create wizard completes', async ({ page }) => {
  acceptNativeDialogs(page);
  await loginAsSeedUser(page);
  await goToSocial(page);
  await selectGroupTab(page, 'Pacific Simmers');

  const name = uniqueTournamentName('Match Play');
  await openCreateTournament(page);
  await completeTournamentWizard(page, { format: 'match_play', name });

  await selectGroupTab(page, 'Pacific Simmers');
  await expectTournamentListed(page, { name, format: 'match_play' });
});
