import type { AuthError } from '@supabase/supabase-js';

const OAUTH_LINKED_EMAIL_SIGN_IN =
  'This email is linked to a Google/Apple account. Please sign in with Google/Apple or reset your password to set up email login.';

/** True when GoTrue / Auth returns a message that usually means “OAuth-only, no password”. */
function isLikelyOAuthOnlyAccountMessage(lower: string): boolean {
  if (lower.includes('oauth')) return true;
  if (lower.includes('identity provider')) return true;
  if (lower.includes('third-party') || lower.includes('third party')) return true;
  if (lower.includes('no password') || lower.includes('password not set') || lower.includes('does not have a password'))
    return true;
  if (lower.includes('cannot sign in with password') || lower.includes('cannot authenticate with password'))
    return true;
  if (lower.includes('use the same provider') || lower.includes('same provider you used')) return true;
  if (lower.includes('external provider')) return true;
  return false;
}

/**
 * Maps `signInWithPassword` errors to clearer copy when the account is OAuth-linked
 * (Google / Apple) and password sign-in is not available.
 */
export function mapEmailPasswordSignInError(error: AuthError): string {
  const raw = (error.message ?? '').trim() || 'Could not sign in.';
  const lower = raw.toLowerCase();

  if (isLikelyOAuthOnlyAccountMessage(lower)) {
    return OAUTH_LINKED_EMAIL_SIGN_IN;
  }

  return raw;
}
