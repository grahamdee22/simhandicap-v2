/**
 * Shared fixtures for Playwright smoke tests against app.sim-cap.com.
 * Credentials match scripts/seed-test-data.js (FULL_SEED profiles).
 */

export const seedUser = {
  email: 'walter-white@seed.simcap.test',
  password: 'Seed-847291!',
  displayName: 'Walter White',
} as const;

/** Seeded group with all 10 profiles — enough members for Scramble / Best Ball. */
export const seedGroupName = 'Basement Boys';

export const seedGroupCandidates = [
  'Basement Boys',
  'The Scratch Pad',
  'Pacific Simmers',
] as const;

export function uniqueTournamentName(formatLabel: string): string {
  return `E2E ${formatLabel} ${Date.now()}`;
}

export function uniqueGroupName(): string {
  return `E2E Delete Test ${Date.now()}`;
}
