import { expect, test } from '@playwright/test';
import { uniqueCustomCourseName } from './fixtures';
import { loginAsSeedUser } from './helpers/auth';
import {
  goToLogRound,
  openCoursePicker,
  searchCoursePicker,
} from './helpers/customCourses';

test('custom course: create with Par/113 disclosure, then re-search finds custom (no duplicate)', async ({
  page,
}) => {
  const courseName = uniqueCustomCourseName();
  const teeName = 'White';
  const par = 71;

  await loginAsSeedUser(page);
  await goToLogRound(page);

  await openCoursePicker(page);
  await searchCoursePicker(page, courseName);

  await expect(page.getByText('No courses match that search.', { exact: true })).toBeVisible();
  await expect(page.getByText('Add a new course', { exact: true })).toBeVisible();

  await page.getByText('Add a new course', { exact: true }).click();
  await expect(page.getByText('Tee 1', { exact: true })).toBeVisible({ timeout: 15_000 });

  // Name is prefilled from the search query; set tee + par, leave CR/Slope blank.
  const nameField = page.getByPlaceholder('e.g. Muni AI — Coastal Dunes');
  await expect(nameField).toHaveValue(courseName);
  await page.getByPlaceholder('White / Blue / Championship').fill(teeName);
  await page.getByPlaceholder('72', { exact: true }).fill(String(par));

  await expect(
    page.getByText(`Will use Par ${par} as Course Rating and Slope 113 (WHS unrated default).`, {
      exact: true,
    })
  ).toBeVisible();

  await page.getByText('Save course', { exact: true }).click();

  // Back on Log a Round with the new custom course selected — posting disclosure.
  await expect(
    page.getByText(new RegExp(`Par ${par} as Course Rating and a Slope of 113`))
  ).toBeVisible({ timeout: 20_000 });

  await openCoursePicker(page, courseName);
  await searchCoursePicker(page, courseName);

  await expect(page.getByText(courseName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Custom', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('No courses match that search.', { exact: true })).toHaveCount(0);
  // Primary “Add a new course” CTA only appears when there are zero matches (or after dismiss).
  await expect(page.getByText('Add a new course', { exact: true })).toHaveCount(0);
});
