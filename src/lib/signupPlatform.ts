/**
 * Normalize client Platform.OS into the profiles.signup_platform check values.
 */

export type SignupPlatform = 'ios' | 'android' | 'web';

export function normalizeSignupPlatform(
  raw: string | null | undefined
): SignupPlatform | null {
  const v = raw?.trim().toLowerCase();
  if (v === 'ios' || v === 'android' || v === 'web') return v;
  return null;
}
