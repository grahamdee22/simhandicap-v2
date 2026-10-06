/**
 * Playwright smoke tests target the deployed web preview (https://app.sim-cap.com).
 *
 * These are NOT a replacement for TestFlight / native checks. React Native Web does not
 * perfectly mirror native rendering or native dialog behavior — this suite only gives
 * confidence about the web layer (wizard flows, auth, list updates, web confirmations).
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  use: {
    baseURL: 'https://app.sim-cap.com',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
