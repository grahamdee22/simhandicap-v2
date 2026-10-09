/**
 * Product feature toggles. Keep code/routes in place when disabling — flip to re-enable.
 */

/** Practice Analyzer CSV import (center-tab coaching flow). Off = no entry points; routes redirect away. */
export const PRACTICE_ANALYZER_ENABLED = false;

/** Referral code field at signup (partner attribution, e.g. Kevin). Off = field hidden; signUp still accepts/stores a code if passed programmatically. */
export const REFERRAL_CODE_FIELD_ENABLED = false;
