import { expect, type Page } from '@playwright/test';
import { seedUser } from '../fixtures';

/** Sign in with a seeded account and wait until a main tab is visible. */
export async function loginAsSeedUser(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByPlaceholder('you@example.com').fill(seedUser.email);
  await page.getByPlaceholder('Password', { exact: true }).fill(seedUser.password);
  // RN Web Pressable often has no role="button" — click the exact label text.
  await page.getByText('Sign in', { exact: true }).click();
  await expect(page.getByText('Social', { exact: true }).first()).toBeVisible({ timeout: 45_000 });
}
