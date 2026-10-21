/**
 * Builds `options.data` for supabase.auth.signUp.
 * Omits referral_code when blank so organic signups don't store an empty string.
 * Codes are lowercased for consistent partner matching in SQL.
 * Includes platform (ios|android|web) and referral_source (link|typed) when provided.
 */

import { normalizeReferralSource, type ReferralSource } from './referralSource';
import { normalizeSignupPlatform, type SignupPlatform } from './signupPlatform';

export function buildSignUpUserMetadata(
  displayName: string,
  referralCode?: string,
  platform?: string | null,
  referralSource?: string | null
): {
  display_name: string;
  referral_code?: string;
  platform?: SignupPlatform;
  referral_source?: ReferralSource;
} {
  const data: {
    display_name: string;
    referral_code?: string;
    platform?: SignupPlatform;
    referral_source?: ReferralSource;
  } = {
    display_name: displayName.trim() || 'Golfer',
  };
  const code = referralCode?.trim().toLowerCase();
  if (code) data.referral_code = code;
  const p = normalizeSignupPlatform(platform);
  if (p) data.platform = p;
  // Only attach source when there is a referral code.
  if (code) {
    const src = normalizeReferralSource(referralSource);
    if (src) data.referral_source = src;
  }
  return data;
}
