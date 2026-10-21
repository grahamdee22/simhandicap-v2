/**
 * Resolve final referral_code + referral_source when both a link-based pending
 * channel and a signup-form field value may be present.
 *
 * Precedence:
 * 1. Typed "kevin" (any case) always wins → source typed
 * 2. Any other non-empty typed value + link pending → keep link, ignore typed
 * 3. Typed value, no link → use typed as-is, source typed
 * 4. Empty field + link → use link, source link
 */

import { normalizeReferralCode } from './referralCodeNormalize';
import type { ReferralSource } from './referralSource';

export type ResolvedReferralAttribution = {
  code: string;
  source: ReferralSource;
};

export function resolveReferralAttribution(args: {
  /** Current signup-form field value (may be link-prefilled or user-edited). */
  fieldValue: string | null | undefined;
  /** Code captured from deep link / Play Install Referrer (if any). */
  linkCode: string | null | undefined;
}): ResolvedReferralAttribution | null {
  const field = normalizeReferralCode(args.fieldValue);
  const link = normalizeReferralCode(args.linkCode);

  // 1. Field is kevin:
  //    - over a different link channel (or no link) → typed kevin wins
  //    - unchanged kevin link prefill → stay link
  if (field === 'kevin') {
    if (link === 'kevin') {
      return { code: 'kevin', source: 'link' };
    }
    return { code: 'kevin', source: 'typed' };
  }

  // Unchanged prefill (field still equals link) → link.
  if (field && link && field === link) {
    return { code: link, source: 'link' };
  }

  // 2. Non-kevin typed value while a link channel exists → keep the link.
  if (field && link) {
    return { code: link, source: 'link' };
  }

  // 3. Typed only (organic / no link pending).
  if (field) {
    return { code: field, source: 'typed' };
  }

  // 4. Nothing typed → pending link.
  if (link) {
    return { code: link, source: 'link' };
  }

  return null;
}
