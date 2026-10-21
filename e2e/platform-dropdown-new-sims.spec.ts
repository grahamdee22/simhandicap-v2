import { expect, test } from '@playwright/test';
import { loginAsSeedUser } from './helpers/auth';
import { goToLogRound } from './helpers/customCourses';

const NEW_PLATFORMS = [
  'Muni Golf',
  'Shot Forge',
  'Pure Play',
  'Foresight Premier+',
] as const;

test('log round platform dropdown includes Muni Golf, Shot Forge, Pure Play, Foresight Premier+', async ({
  page,
}) => {
  await loginAsSeedUser(page);
  await goToLogRound(page);

  // Open simulator-software picker (first ▾ is platform; course is second).
  await page.getByText('▾').first().click();
  await expect(page.getByText('Platform', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  for (const name of NEW_PLATFORMS) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  // Select one to confirm the option is interactive, not just decorative text.
  await page.getByText('Muni Golf', { exact: true }).click();
  await expect(page.getByText('Muni Golf', { exact: true }).first()).toBeVisible();
});
