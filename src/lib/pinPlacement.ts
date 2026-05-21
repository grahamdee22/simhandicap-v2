/**
 * Pin placement labels: GSPro uses Thu–Sun; other sims use Easy/Medium/Hard (stored as thu/fri/sun).
 */

import type { PlatformId } from './constants';
import type { PinDay } from './handicap';

export function isGsProPlatform(platform: PlatformId | string | null | undefined): boolean {
  return platform === 'GSPro';
}

export type PinOption = { key: PinDay; label: string; sublabel?: string };

/** Pin picker options for a simulator platform. */
export function pinOptionsForPlatform(platform: PlatformId): PinOption[] {
  if (isGsProPlatform(platform)) {
    return [
      { key: 'thu', label: 'Thu', sublabel: 'Round 1' },
      { key: 'fri', label: 'Fri', sublabel: 'Round 2' },
      { key: 'sat', label: 'Sat', sublabel: 'Round 3' },
      { key: 'sun', label: 'Sun', sublabel: 'Round 4' },
    ];
  }
  return [
    { key: 'thu', label: 'Easy' },
    { key: 'fri', label: 'Medium' },
    { key: 'sun', label: 'Hard' },
  ];
}

/** Short label for chips, filters, and round meta. */
export function pinDisplayLabel(pin: PinDay, platform?: PlatformId | string | null): string {
  if (isGsProPlatform(platform)) {
    const m: Record<PinDay, string> = { thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
    return m[pin];
  }
  const m: Record<PinDay, string> = { thu: 'Easy', fri: 'Medium', sat: 'Sat', sun: 'Hard' };
  return m[pin];
}

/** Longer label for round detail screens. */
export function pinDetailLabel(pin: PinDay, platform?: PlatformId | string | null): string {
  if (isGsProPlatform(platform)) {
    const m: Record<PinDay, string> = {
      thu: 'Thursday · R1',
      fri: 'Friday · R2',
      sat: 'Saturday · R3',
      sun: 'Sunday · R4',
    };
    return m[pin];
  }
  const m: Record<PinDay, string> = {
    thu: 'Easy',
    fri: 'Medium',
    sat: 'Sat',
    sun: 'Hard',
  };
  return m[pin];
}

/** Filter chips on Analyze (non-GSPro omits Sat-only legacy bucket). */
export function pinFilterOptions(platformFilter: PlatformId | null): { key: PinDay | null; label: string }[] {
  const all = { key: null as PinDay | null, label: 'All' };
  if (platformFilter && isGsProPlatform(platformFilter)) {
    return [
      all,
      { key: 'thu', label: 'Thu' },
      { key: 'fri', label: 'Fri' },
      { key: 'sat', label: 'Sat' },
      { key: 'sun', label: 'Sun' },
    ];
  }
  return [
    all,
    { key: 'thu', label: 'Easy' },
    { key: 'fri', label: 'Medium' },
    { key: 'sun', label: 'Hard' },
    { key: 'sat', label: 'Sat' },
  ];
}
