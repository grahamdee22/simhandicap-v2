import { expect, test } from '@playwright/test';
import { loginAsSeedAdmin } from './helpers/auth';
import { goToContactFromProfile } from './helpers/customCourses';

test('admin gate (positive): Contact shows Manage custom courses and admin page loads', async ({
  page,
}) => {
  await loginAsSeedAdmin(page);
  await goToContactFromProfile(page);

  const manage = page.getByText('Manage custom courses', { exact: true });
  await expect(manage).toBeVisible({ timeout: 20_000 });
  await manage.click();

  await expect(page.getByText('Admin only.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Custom courses', { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Repeated custom names', { exact: true })).toBeVisible();
  await expect(page.getByText('Edit & promote tees', { exact: true })).toBeVisible();
});
