/**
 * How a referral_code was captured: tracking link vs typed on the signup form.
 */

export type ReferralSource = 'link' | 'typed';

export function normalizeReferralSource(
  raw: string | null | undefined
): ReferralSource | null {
  const v = raw?.trim().toLowerCase();
  if (v === 'link' || v === 'typed') return v;
  return null;
}
