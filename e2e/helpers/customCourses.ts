import { expect, type Page } from '@playwright/test';

/** Open standalone Log a Round. */
export async function goToLogRound(page: Page): Promise<void> {
  await page.goto('/log/round');
  await expect(page.getByText('Course', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

/**
 * Open the course typeahead modal from the Log a Round course pill.
 * Pass `currentCourseName` when the pill no longer shows the default Pebble Beach.
 */
export async function openCoursePicker(page: Page, currentCourseName?: string): Promise<void> {
  const label = currentCourseName ?? 'Pebble Beach Golf Links';
  await page.getByText(label, { exact: true }).first().click();
  await expect(page.getByPlaceholder('Search by course name')).toBeVisible({ timeout: 15_000 });
}

export async function searchCoursePicker(page: Page, query: string): Promise<void> {
  const search = page.getByPlaceholder('Search by course name');
  await expect(search).toBeVisible();
  await search.fill(query);
}

/** Profile → Contact us / Feedback. */
export async function goToContactFromProfile(page: Page): Promise<void> {
  await page.goto('/profile');
  await expect(page.getByText('Contact us / Feedback', { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByLabel('Contact us and send feedback').click();
  await expect(page.getByText(/Bugs, ideas/i).first()).toBeVisible({ timeout: 15_000 });
}
