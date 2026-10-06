import { expect, test } from '@playwright/test';
import { uniqueGroupName } from './fixtures';
import { loginAsSeedUser } from './helpers/auth';
import { acceptNativeDialogs, goToSocial } from './helpers/tournaments';

test('group delete: confirm dialog then group is gone', async ({ page }) => {
  acceptNativeDialogs(page);
  await loginAsSeedUser(page);
  await goToSocial(page);

  const name = uniqueGroupName();

  await page.getByRole('button', { name: 'Create a new group', exact: true }).click();
  await expect(page.getByText('New group', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Group name').fill(name);
  await page.getByText('Create', { exact: true }).click();

  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByText(name, { exact: true }).first().click();

  await page.getByLabel(`Delete ${name}`).click();
  // dialog.accept() already registered via acceptNativeDialogs

  await expect(page.getByText(name, { exact: true })).toHaveCount(0, { timeout: 30_000 });
});
