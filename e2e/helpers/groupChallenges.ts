import { expect, type Page } from '@playwright/test';
import {
  qaChallengeCompanionsA,
  qaChallengeCompanionsB,
  qaChallengeGroupA,
  qaChallengeGroupB,
  seedUser,
} from '../fixtures';
import {
  acceptNativeDialogs,
  clickContinue,
  goToSocial,
  openCreateTournament,
  pickCoursePebble,
  selectGroupTab,
} from './tournaments';

export {
  qaChallengeCompanionsA,
  qaChallengeCompanionsB,
  qaChallengeGroupA,
  qaChallengeGroupB,
};

/** Toggle RN Web Switch for "Challenge another group". */
export async function enableGroupChallengeToggle(page: Page): Promise<void> {
  const byLabel = page.getByLabel('Challenge another group');
  if (await byLabel.isVisible().catch(() => false)) {
    await byLabel.click();
    return;
  }
  const sw = page.getByRole('switch').first();
  await expect(sw).toBeVisible({ timeout: 15_000 });
  await sw.click();
}

export async function pickOpponentGroup(page: Page, opponentName: string): Promise<void> {
  const head = page.getByText('Opposing group', { exact: true });
  await expect(head).toBeVisible({ timeout: 20_000 });
  // Scope to the create wizard — Social group tabs with the same name stay mounted behind.
  const sheet = page
    .locator('div')
    .filter({ has: head })
    .filter({ has: page.getByPlaceholder('Group name or ID') })
    .last();
  const input = sheet.getByPlaceholder('Group name or ID');
  await input.fill(opponentName);
  // Blur so the TextInput overlay doesn't eat the result-row click.
  await input.evaluate((el) => (el as HTMLInputElement).blur());
  const row = sheet
    .getByText(opponentName, { exact: true })
    .filter({ hasNot: page.getByPlaceholder('Group name or ID') })
    .last();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click({ force: true });
  // Selection is the checked result row (no separate summary card).
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(
    sheet.getByText(opponentName, { exact: true }).first()
  ).toBeVisible();
}

/**
 * Click roster rows by display name (challenge create wizard or detail picker).
 * Scoped under a heading so Social member lists mounted behind don't intercept.
 */
export async function pickRosterByNames(
  page: Page,
  names: string[],
  opts?: { scopeHeading?: string | RegExp }
): Promise<void> {
  const heading = opts?.scopeHeading ?? /Your roster \(5 players\)|Pick your roster|Who's playing\?/;
  const head = page.getByText(heading).first();
  await expect(head).toBeVisible({ timeout: 20_000 });
  const sheet = page
    .locator('div')
    .filter({ has: head })
    .filter({ has: page.getByText(/\d+ of \d+ selected|Continue/) })
    .last();

  for (const name of names) {
    // " (you)" suffix may appear for the signed-in user.
    const row = sheet.getByText(new RegExp(`^${escapeRegExp(name)}( \\(you\\))?$`)).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click({ force: true });
  }
  await expect(
    sheet.getByText(new RegExp(`${names.length} of ${names.length} selected`))
  ).toBeVisible({ timeout: 10_000 });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function chooseCasualVerification(page: Page): Promise<void> {
  await expect(page.getByText('Verification', { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.getByText('Casual', { exact: true }).last().click();
}

export async function chooseVerifiedVerification(page: Page): Promise<void> {
  await expect(page.getByText('Verification', { exact: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await page.getByText('Verified', { exact: true }).last().click();
}

/**
 * Full create+send wizard from Social, starting on the challenging group tab.
 * Lands on the challenge detail page after the success alert.
 */
export async function createAndSendCasualChallenge(
  page: Page,
  opts: {
    name: string;
    fromGroup?: string;
    toGroup?: string;
    /** Roster on the challenging side (must be exactly 5). Defaults: Walter + 4 A companions. */
    challengingRoster?: string[];
  }
): Promise<void> {
  const fromGroup = opts.fromGroup ?? qaChallengeGroupA;
  const toGroup = opts.toGroup ?? qaChallengeGroupB;
  const challengingRoster =
    opts.challengingRoster ?? [seedUser.displayName, ...qaChallengeCompanionsA.slice(0, 4)];

  await goToSocial(page);
  await selectGroupTab(page, fromGroup);
  await openCreateTournament(page);

  await page.getByPlaceholder(/Facility Cup|Spring League/).fill(opts.name);
  await enableGroupChallengeToggle(page);
  await expect(
    page.getByText(/Format is fixed to net Stroke Play/i).first()
  ).toBeVisible();
  await clickContinue(page);

  await pickOpponentGroup(page, toGroup);
  await clickContinue(page);

  await expect(page.getByText(/Your roster \(5 players\)/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await pickRosterByNames(page, challengingRoster);
  await clickContinue(page);

  await expect(page.getByText('Settings', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByText('18 holes', { exact: true }).click().catch(() => undefined);
  await pickCoursePebble(page);
  await chooseCasualVerification(page);
  await clickContinue(page);

  await expect(page.getByText('Review & send challenge', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/5v5 · Casual · 18 holes/i).first()).toBeVisible();
  await expect(page.getByText(`vs. ${toGroup}`, { exact: true }).first()).toBeVisible();
  await page.getByText('Send challenge', { exact: true }).click();

  // Success alert auto-accepted → detail screen
  await expect(page.getByText('Pending', { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(opts.name, { exact: true }).first()).toBeVisible();
}

/** Dual-member pending assertions (sender waiting + Respond for challenged). */
export async function expectDualMemberPendingUi(
  page: Page,
  opts: { sentGroup: string; otherGroup: string }
): Promise<void> {
  await expect(
    page.getByText(
      new RegExp(
        `${escapeRegExp(opts.sentGroup)} sent this challenge\\. Waiting for ${escapeRegExp(opts.otherGroup)}`,
        'i'
      )
    )
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText(`Respond for ${opts.otherGroup}`, { exact: true })
  ).toBeVisible();
  await expect(page.getByText('Accept', { exact: true })).toBeVisible();
  await expect(page.getByText('Decline', { exact: true })).toBeVisible();
}

export async function acceptChallenge(page: Page): Promise<void> {
  await page.getByText('Accept', { exact: true }).click();
  await expect(page.getByText('Accepted', { exact: true }).first()).toBeVisible({
    timeout: 45_000,
  });
}

/** Challenged-side roster picker on the detail screen. */
export async function saveChallengedRoster(page: Page, names: string[]): Promise<void> {
  await pickRosterByNames(page, names, { scopeHeading: 'Pick your roster' });
  await page.getByText('Save roster', { exact: true }).click();
  // Stale-UI regression: 5/5 must appear without a manual reload.
  await expect(page.getByText(/5\/5 players/i).first()).toBeVisible({ timeout: 45_000 });
}

export async function activateChallenge(page: Page): Promise<void> {
  await expect(page.getByText('Activate challenge', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByText('Activate challenge', { exact: true }).click();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible({
    timeout: 45_000,
  });
  // Handicap snapshot locked — numeric index line without reload.
  await expect(page.getByText(/Index \d+(\.\d+)? \(/i).first()).toBeVisible({
    timeout: 30_000,
  });
}

export async function logCasualChallengeRound(page: Page, score = 82): Promise<void> {
  await page.getByText('Log challenge round', { exact: true }).click();
  await expect(page.getByText('Submit challenge round', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  // Course default tee is auto-selected when the challenge leaves tee unlocked —
  // avoid clicking tee labels via /White/ regex (matches "Walter White" behind).
  const grossInput = page.getByLabel('Gross score');
  await grossInput.scrollIntoViewIfNeeded();
  await grossInput.fill(String(score));
  await page.getByText('Submit challenge round', { exact: true }).click();
  // Alert → back to detail; Counted badge (not Verified) + live counts, no reload.
  await expect(page.getByText('Counted', { exact: true }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/1 of 5 scores counting/i).first()).toBeVisible();
  await expect(page.getByText('No rounds submitted yet.')).toHaveCount(0);
}

/** Read Tournament section body text under the Tournaments heading (Social page). */
export async function tournamentSectionSnippet(page: Page): Promise<string> {
  await expect(page.getByRole('heading', { name: 'Tournaments' }).first()).toBeVisible({
    timeout: 30_000,
  });
  // Wait out fetch spinner for uncached groups.
  await page
    .getByRole('progressbar')
    .first()
    .waitFor({ state: 'hidden', timeout: 20_000 })
    .catch(() => undefined);
  await page.waitForTimeout(800);

  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('*'));
    const title = nodes.find(
      (el) =>
        el.childNodes.length > 0 &&
        Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && (n.textContent || '').trim() === 'Tournaments'
        ) &&
        (el.textContent || '').trim() === 'Tournaments'
    ) as HTMLElement | undefined;
    if (!title) return '';
    let wrap: HTMLElement | null = title;
    for (let i = 0; i < 8 && wrap; i++) {
      const sibling = wrap.nextElementSibling as HTMLElement | null;
      if (sibling?.innerText && sibling.innerText.trim().length > 5) {
        return sibling.innerText.replace(/\s+/g, ' ').trim().slice(0, 1200);
      }
      wrap = wrap.parentElement;
    }
    return '';
  });
}

export async function expectTournamentSectionMatchesTab(
  page: Page,
  groupName: string,
  memberProbe: string
): Promise<string> {
  await selectGroupTab(page, groupName);
  await expect(page.getByText(memberProbe, { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
  const snippet = await tournamentSectionSnippet(page);
  expect(snippet.length).toBeGreaterThan(10);
  return snippet;
}

/** Wire dialogs + Social entry for Group Challenge specs. */
export async function beginGroupChallengeTest(page: Page): Promise<void> {
  acceptNativeDialogs(page);
}
