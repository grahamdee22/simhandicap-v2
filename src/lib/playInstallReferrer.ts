/**
 * Google Play Install Referrer → channel label (Option B: utm_source=<channel>).
 * Same lowercase convention as iOS ct= and profiles.referral_code / ?ref=.
 */

import { normalizeReferralCode } from './referralCodeNormalize';

/** Play organic / non-campaign sources — never stash as pending referral. */
const ORGANIC_UTM_SOURCES = new Set([
  'google-play',
  'google',
  'organic',
  '(not%20set)',
  '(not set)',
  'not_set',
]);

/**
 * Parse `utm_source` from a Play Install Referrer string.
 * Accepts raw query (`utm_source=kevin&utm_medium=…`), a full URL, or a single token.
 */
export function parseChannelFromPlayInstallReferrer(
  referrerRaw: string | null | undefined
): string | null {
  if (referrerRaw == null) return null;
  let raw = referrerRaw.trim();
  if (!raw) return null;

  // Play may deliver still-percent-encoded referrer strings.
  if (/%[0-9a-f]{2}/i.test(raw)) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* keep raw */
    }
  }

  try {
    // Absolute URL (rare from the API; useful in tests / deep links)
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      const direct = normalizeReferralCode(u.searchParams.get('utm_source'));
      if (direct) return direct;
      const nested = u.searchParams.get('referrer');
      if (nested) return parseChannelFromPlayInstallReferrer(nested);
      return null;
    }
  } catch {
    /* fall through */
  }

  // Query string (with or without leading ?)
  const q = raw.startsWith('?') ? raw.slice(1) : raw;
  try {
    const sp = new URLSearchParams(q);
    if (sp.has('utm_source')) {
      return normalizeReferralCode(sp.get('utm_source'));
    }
  } catch {
    /* fall through */
  }

  const m = /(?:^|[?&])utm_source=([^&]*)/i.exec(raw);
  if (m) {
    try {
      return normalizeReferralCode(decodeURIComponent(m[1]));
    } catch {
      return normalizeReferralCode(m[1]);
    }
  }

  return null;
}

/** True when utm_source should be treated as a marketing channel (not Play organic). */
export function isCampaignPlayChannel(channel: string | null | undefined): boolean {
  const c = normalizeReferralCode(channel);
  if (!c) return false;
  return !ORGANIC_UTM_SOURCES.has(c);
}
