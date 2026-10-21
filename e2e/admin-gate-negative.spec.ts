import { expect, test } from '@playwright/test';
import { loginAsSeedUser } from './helpers/auth';
import { goToContactFromProfile } from './helpers/customCourses';

test('admin gate (negative): Contact hides Manage link; direct route shows Admin only', async ({
  page,
}) => {
  await loginAsSeedUser(page);
  await goToContactFromProfile(page);

  await expect(page.getByText('Manage custom courses', { exact: true })).toHaveCount(0);

  await page.goto('/admin-custom-courses');
  await expect(page.getByText('Admin only.', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Repeated custom names', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Edit & promote tees', { exact: true })).toHaveCount(0);
});
