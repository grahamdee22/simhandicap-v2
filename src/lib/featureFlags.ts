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
 * Non-English locales (es/ko) in the language picker + device-locale auto-detect.
 * Off = English only until translations have native-speaker review. Locale files stay in the repo.
 */
export const TRANSLATED_LANGUAGES_ENABLED = false;
