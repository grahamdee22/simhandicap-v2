/**
 * Shared fixtures for Playwright smoke tests against app.sim-cap.com.
 * Credentials match scripts/seed-test-data.js (FULL_SEED profiles + admin seed).
 */

export const seedUser = {
  email: 'walter-white@seed.simcap.test',
  password: 'Seed-847291!',
  displayName: 'Walter White',
} as const;

/**
 * Distinct admin seed — profiles.is_app_admin = true.
 * Created by ensureAdminSeedProfile() in scripts/seed-test-data.js.
 */
export const seedAdminUser = {
  email: 'simcap-admin-seed@seed.simcap.test',
  password: 'Seed-999001!',
  displayName: 'SimCap Admin Seed',
} as const;

/** Seeded group with all 10 profiles — enough members for Scramble / Best Ball. */
export const seedGroupName = 'Basement Boys';

export const seedGroupCandidates = [
  'Basement Boys',
  'The Scratch Pad',
  'Pacific Simmers',
] as const;

/**
 * Group Challenge QA crews (scripts/seed-group-challenge-qa.js).
 * Walter White is dual admin of both for Playwright; companions fill 5v5 rosters.
 */
export const qaChallengeGroupA = 'QA Group Challenge A';
export const qaChallengeGroupB = 'QA Group Challenge B';

/** Challenging-side companions (eligible for A's roster with Walter). */
export const qaChallengeCompanionsA = [
  'QA GCA Alpha',
  'QA GCA Bravo',
  'QA GCA Charlie',
  'QA GCA Delta',
  'QA GCA Eagle',
] as const;

/** Challenged-side companions (B roster — exclude Walter to satisfy one-side-only). */
export const qaChallengeCompanionsB = [
  'QA GCB Echo',
  'QA GCB Foxtrot',
  'QA GCB Golf',
  'QA GCB Hotel',
  'QA GCB India',
] as const;

export function uniqueChallengeName(): string {
  return `E2E Challenge ${Date.now()}`;
}

export function uniqueTournamentName(formatLabel: string): string {
  return `E2E ${formatLabel} ${Date.now()}`;
}

export function uniqueGroupName(): string {
  return `E2E Delete Test ${Date.now()}`;
}

/** Fictional course name that will not match curated/community libraries. */
export function uniqueCustomCourseName(): string {
  return `E2E Zzyzx Dunes ${Date.now()}`;
}
