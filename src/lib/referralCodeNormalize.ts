/** Normalize like email signup metadata (trim + lowercase). Blank → null. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  const code = raw?.trim().toLowerCase();
  return code ? code : null;
}

/**
 * Pull `ref` / `referral` / `referral_code` from a URL query string (or hash query).
 * Used for shared referral deep links.
 */
export function parseReferralCodeFromUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const fromSearch =
      u.searchParams.get('ref') ??
      u.searchParams.get('referral') ??
      u.searchParams.get('referral_code');
    const fromSearchNorm = normalizeReferralCode(fromSearch);
    if (fromSearchNorm) return fromSearchNorm;

    const hash = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash;
    if (hash) {
      const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash;
      const sp = new URLSearchParams(hashQuery);
      return normalizeReferralCode(
        sp.get('ref') ?? sp.get('referral') ?? sp.get('referral_code')
      );
    }
    return null;
  } catch {
    const qIdx = url.indexOf('?');
    if (qIdx < 0) return null;
    const q = url.slice(qIdx + 1).split('#')[0];
    const sp = new URLSearchParams(q);
    return normalizeReferralCode(
      sp.get('ref') ?? sp.get('referral') ?? sp.get('referral_code')
    );
  }
}
