/**
 * Product feature toggles. Keep code/routes in place when disabling — flip to re-enable.
 */

/** Practice Analyzer CSV import (center-tab coaching flow). Off = no entry points; routes redirect away. */
export const PRACTICE_ANALYZER_ENABLED = false;

/** Referral code field at signup (partner attribution, e.g. Kevin). Off = field hidden; signUp still accepts/stores a code if passed programmatically. */
export const REFERRAL_CODE_FIELD_ENABLED = true;

/** SimCap Pro paywall + purchase flow. Off = no entry points; screen/route unreachable. */
export const PAYWALL_ENABLED = false;

/**
 * Non-English locales enabled for the language picker + device-locale auto-detect.
 * English is always on. Locale JSON for disabled codes stays in the repo but is inert.
 *
 * Default ship set: Spanish only (Korean waits on native-speaker / Golfzon-term review).
 *
 * Override at build time without a code change:
 *   EXPO_PUBLIC_ENABLED_TRANSLATED_LANGUAGES=es
 *   EXPO_PUBLIC_ENABLED_TRANSLATED_LANGUAGES=es,ko
 *   EXPO_PUBLIC_ENABLED_TRANSLATED_LANGUAGES=   (empty = English only)
 */
const DEFAULT_ENABLED_TRANSLATED_LANGUAGES = ['es'] as const;

function parseEnabledTranslatedLanguages(): readonly string[] {
  const raw = process.env.EXPO_PUBLIC_ENABLED_TRANSLATED_LANGUAGES;
  if (raw !== undefined) {
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && s !== 'en');
  }
  return DEFAULT_ENABLED_TRANSLATED_LANGUAGES;
}

export const ENABLED_TRANSLATED_LANGUAGES: readonly string[] = parseEnabledTranslatedLanguages();
