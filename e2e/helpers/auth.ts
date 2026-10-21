import { expect, type Page } from '@playwright/test';
import { seedAdminUser, seedUser } from '../fixtures';

export type SeedCredentials = {
  email: string;
  password: string;
};

/** Sign in with email/password and wait until a main tab is visible. */
export async function loginAs(page: Page, user: SeedCredentials): Promise<void> {
  await page.goto('/sign-in');
  await page.getByPlaceholder('you@example.com').fill(user.email);
  await page.getByPlaceholder('Password', { exact: true }).fill(user.password);
  // RN Web Pressable often has no role="button" — click the exact label text.
  await page.getByText('Sign in', { exact: true }).click();
  await expect(page.getByText('Social', { exact: true }).first()).toBeVisible({ timeout: 45_000 });
}

/** Sign in with the default non-admin seed account (Walter White). */
export async function loginAsSeedUser(page: Page): Promise<void> {
  await loginAs(page, seedUser);
}

/** Sign in with the admin seed account (is_app_admin = true). */
export async function loginAsSeedAdmin(page: Page): Promise<void> {
  await loginAs(page, seedAdminUser);
}
