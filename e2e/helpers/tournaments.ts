import { expect, type Page } from '@playwright/test';
import { seedGroupCandidates, seedGroupName } from '../fixtures';

/** Accept any native window.alert / confirm that the web build still uses. */
export function acceptNativeDialogs(page: Page): void {
  page.on('dialog', (dialog) => {
    void dialog.accept();
  });
}

export async function goToSocial(page: Page): Promise<void> {
  // Direct navigation is more reliable than tab clicks: after Save round the app opens
  // Round analysis, and a full-screen layer often intercepts the Social tab Pressable.
  await page.goto('/groups');
  await expect(page.getByRole('heading', { name: 'My Groups' })).toBeVisible({ timeout: 30_000 });
}

export async function selectGroupTab(page: Page, groupName: string): Promise<void> {
  await page.getByText(groupName, { exact: true }).first().click();
  await expect(page.getByText(groupName, { exact: true }).first()).toBeVisible();
}

/**
 * Prefer a seed group with no live tournament so a new one can start today
 * (needed for Log a Round opt-in). Falls back to Basement Boys.
 */
export async function selectGroupForActiveCreate(page: Page): Promise<string> {
  for (const name of seedGroupCandidates) {
    await selectGroupTab(page, name);
    const createBtn = page.getByText('Create Tournament', { exact: true });
    if (await createBtn.isVisible().catch(() => false)) {
      return name;
    }
  }
  await selectGroupTab(page, seedGroupName);
  return seedGroupName;
}

export async function openCreateTournament(page: Page): Promise<void> {
  const create = page.getByText('Create Tournament', { exact: true });
  const schedule = page.getByText('Schedule next tournament', { exact: true });
  if (await create.isVisible().catch(() => false)) {
    await create.click();
  } else {
    await schedule.click();
  }
  await expect(page.getByText('Basic info', { exact: true })).toBeVisible({ timeout: 30_000 });
}

export async function clickContinue(page: Page): Promise<void> {
  // Prefer the primary Continue on the current wizard step (last exact match).
  await page.getByText('Continue', { exact: true }).last().click();
}

export async function pickCoursePebble(page: Page): Promise<void> {
  const choose = page.getByRole('button', { name: 'Choose course', exact: true });
  if (await choose.isVisible().catch(() => false)) {
    await choose.click();
  } else {
    await page.getByText('Choose course', { exact: true }).click();
  }
  const search = page.getByPlaceholder('Search courses');
  await expect(search).toBeVisible();
  // Scope to the course modal sheet. Home/Social stay mounted behind the wizard on
  // web and also contain "Pebble Beach Golf Links" (recent rounds) — unscoped
  // getByText / tabindex filters click those instead of the picker row.
  const sheet = page
    .locator('div')
    .filter({ has: search })
    .filter({ hasText: 'Course' })
    .last();
  await search.fill('Pebble');
  const row = sheet.getByText('Pebble Beach Golf Links', { exact: true });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.getByText('Choose a course to continue.')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(/📍/).first()).toBeVisible();
}

const WHEEL_ROW = 40;

/** Snap one web date-wheel column via RN ScrollView's onMomentumScrollEnd. */
async function snapDateWheel(
  page: Page,
  kind: 'month' | 'day' | 'year',
  index: number
): Promise<void> {
  const result = await page.evaluate(
    ({ kind, index, WHEEL_ROW }) => {
      const doneBtn = Array.from(document.querySelectorAll('*')).find((el) =>
        Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent === 'Done')
      );
      if (!doneBtn) return 'no Done';
      let root: HTMLElement | null = doneBtn as HTMLElement;
      for (let i = 0; i < 10 && root; i++) {
        if (root.innerText?.includes('January') && root.innerText?.includes('2018')) break;
        root = root.parentElement;
      }
      if (!root) return 'no root';
      const scrollers = Array.from(root.querySelectorAll('div')).filter(
        (el) =>
          el.scrollHeight > el.clientHeight + 40 &&
          getComputedStyle(el).overflowY === 'auto'
      );
      const el =
        kind === 'month'
          ? scrollers.find(
              (s) => s.innerText.includes('January') && s.innerText.includes('December')
            )
          : kind === 'year'
            ? scrollers.find((s) => s.innerText.includes('2018'))
            : scrollers.find(
                (s) =>
                  /^\d/.test(s.innerText.trim()) &&
                  !s.innerText.includes('January') &&
                  !s.innerText.includes('2018')
              );
      if (!el) return `missing ${kind}`;
      const yPos = index * WHEEL_ROW;
      el.scrollTop = yPos;
      const fiberKey = Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
      const fiber = fiberKey ? (el as unknown as Record<string, unknown>)[fiberKey] : null;
      const evt = {
        nativeEvent: {
          contentOffset: { x: 0, y: yPos },
          contentSize: { width: el.clientWidth, height: el.scrollHeight },
          layoutMeasurement: { width: el.clientWidth, height: el.clientHeight },
        },
        persist() {},
        stopPropagation() {},
        preventDefault() {},
      };
      let f = fiber as { memoizedProps?: { onMomentumScrollEnd?: (e: unknown) => void }; pendingProps?: { onMomentumScrollEnd?: (e: unknown) => void }; return?: unknown } | null;
      for (let i = 0; i < 12 && f; i++) {
        const p = f.memoizedProps || f.pendingProps;
        if (p?.onMomentumScrollEnd) {
          p.onMomentumScrollEnd(evt);
          return 'ok';
        }
        f = f.return as typeof f;
      }
      return `no handler ${kind}`;
    },
    { kind, index, WHEEL_ROW }
  );
  if (result !== 'ok') {
    throw new Error(`Date wheel snap failed (${kind}): ${result}`);
  }
}

/**
 * Set Start/End date fields on the Settings step via the web wheel picker.
 * ymd values are local calendar dates as YYYY-MM-DD.
 */
export async function setTournamentDateRange(
  page: Page,
  startYmd: string,
  endYmd: string
): Promise<void> {
  async function setOne(which: 'start' | 'end', ymd: string): Promise<void> {
    const [y, m, d] = ymd.split('-').map(Number);
    const btns = page.getByRole('button', { name: /\w{3} \d{1,2}, \d{4}/ });
    await btns.nth(which === 'start' ? 0 : 1).click();
    await expect(page.getByText('Done', { exact: true })).toBeVisible();
    // Year → month → day so the day column remounts for the chosen month first.
    await snapDateWheel(page, 'year', y - 2018);
    await page.waitForTimeout(100);
    await snapDateWheel(page, 'month', m - 1);
    await page.waitForTimeout(150);
    await snapDateWheel(page, 'day', d - 1);
    await page.waitForTimeout(100);
    await page.getByText('Done', { exact: true }).click();
    await expect(page.getByText('Done', { exact: true })).toHaveCount(0);
  }
  await setOne('start', startYmd);
  await setOne('end', endYmd);
}

type FormatKey = 'stroke' | 'match_play' | 'scramble' | 'best_ball';

const FORMAT_TITLE: Record<FormatKey, string> = {
  stroke: 'Stroke Play',
  match_play: 'Match Play',
  scramble: 'Scramble',
  best_ball: 'Best Ball',
};

const FORMAT_BADGE: Record<FormatKey, string> = {
  stroke: 'Stroke Play',
  match_play: 'Match Play',
  scramble: 'Scramble',
  best_ball: 'Best Ball',
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function ymdUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Unique future window per call. `attempt` shifts by a week so overlap retries
 * land on a fresh range (Basement Boys accumulates leftover E2E schedules).
 */
function futureRangeForFormat(
  format: Exclude<FormatKey, 'stroke'>,
  attempt = 0
): {
  startYmd: string;
  endYmd: string;
} {
  const year = new Date().getFullYear() + 1;
  const formatBump = { best_ball: 0, match_play: 70, scramble: 140 }[format];
  const dayOffset = (Math.floor(Date.now() / 1000) + formatBump + attempt * 10) % 280;
  const start = new Date(Date.UTC(year, 0, 1 + dayOffset));
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return { startYmd: ymdUTC(start), endYmd: ymdUTC(end) };
}

/**
 * Walk the create-tournament wizard for the given format (18 holes).
 * Caller must already be on Basic info and have dialog auto-accept registered.
 *
 * Create-only formats (match / scramble / best ball) are scheduled into a unique
 * future window so repeated suite runs don't trip the group's date-overlap gate.
 * Stroke keeps the app defaults (active today) for Log a Round opt-in.
 */
export async function completeTournamentWizard(
  page: Page,
  opts: { format: FormatKey; name: string }
): Promise<void> {
  await page.getByPlaceholder('Spring League').fill(opts.name);
  // Format title may also appear in Social chrome still mounted behind the wizard on web.
  await page
    .getByText(FORMAT_TITLE[opts.format], { exact: true })
    .last()
    .click();
  await clickContinue(page);

  // Players
  await expect(page.getByText("Who's playing?", { exact: true })).toBeVisible();
  await clickContinue(page);

  if (opts.format === 'scramble' || opts.format === 'best_ball') {
    // Team size
    await expect(page.getByText('Players per team', { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });
    await clickContinue(page);
  }

  // Settings
  await expect(page.getByText('Settings', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByText('18 holes', { exact: true }).click().catch(() => undefined);
  await pickCoursePebble(page);
  if (opts.format !== 'stroke') {
    let placed = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const range = futureRangeForFormat(opts.format, attempt);
      await setTournamentDateRange(page, range.startYmd, range.endYmd);
      if ((await page.getByText(/These dates overlap/i).count()) === 0) {
        placed = true;
        break;
      }
    }
    if (!placed) {
      throw new Error(
        `Could not find a non-overlapping date range for ${opts.format} after 10 attempts`
      );
    }
  } else {
    await expect(page.getByText(/These dates overlap/i)).toHaveCount(0);
  }
  await clickContinue(page);

  if (opts.format === 'scramble' || opts.format === 'best_ball') {
    await expect(page.getByText('Assign Teams', { exact: true })).toBeVisible();
    await page.getByText('Auto-assign teams', { exact: true }).click();
    await clickContinue(page);
  }

  await expect(page.getByText('Review & Launch', { exact: true })).toBeVisible();
  await page.getByText('Launch Tournament', { exact: true }).click();

  // Success alert auto-accepted; land back on Social / groups
  await expect(page.getByText('My Groups', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
}

/** Assert the tournament name is visible as the live card or under Coming up. */
export async function expectTournamentListed(
  page: Page,
  opts: { name: string; format: FormatKey; requireActiveToday?: boolean }
): Promise<'active' | 'scheduled'> {
  await expect(page.getByText(opts.name, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  // Live cards use a standalone format label; Coming up embeds it as "Scramble · Jan 1 – …".
  await expect(
    page.getByText(new RegExp(FORMAT_BADGE[opts.format])).first()
  ).toBeVisible();

  const comingUp = page.getByText('Coming up', { exact: true });
  const isScheduled =
    (await comingUp.isVisible().catch(() => false)) &&
    (await page
      .locator('text=Coming up')
      .locator('..')
      .getByText(opts.name, { exact: true })
      .isVisible()
      .catch(() => false));

  if (opts.requireActiveToday && isScheduled) {
    throw new Error(
      `Tournament "${opts.name}" was queued under Coming up (future dates) — cannot opt rounds in while another tournament is already active for this group.`
    );
  }

  return isScheduled ? 'scheduled' : 'active';
}
