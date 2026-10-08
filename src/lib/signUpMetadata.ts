/**
 * Builds `options.data` for supabase.auth.signUp.
 * Omits referral_code when blank so organic signups don't store an empty string.
 * Codes are lowercased for consistent partner matching in SQL.
 */
export function buildSignUpUserMetadata(
  displayName: string,
  referralCode?: string
): { display_name: string; referral_code?: string } {
  const data: { display_name: string; referral_code?: string } = {
    display_name: displayName.trim() || 'Golfer',
  };
  const code = referralCode?.trim().toLowerCase();
  if (code) data.referral_code = code;
  return data;
}
