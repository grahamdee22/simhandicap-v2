import type { User } from '@supabase/supabase-js';

const OAUTH_PROVIDERS = new Set(['google', 'apple']);

export function userHasOAuthIdentity(user: User | null | undefined): boolean {
  if (!user) return false;
  const providers = user.app_metadata?.providers;
  if (Array.isArray(providers) && providers.some((p) => OAUTH_PROVIDERS.has(p))) {
    return true;
  }
  return user.identities?.some((i) => OAUTH_PROVIDERS.has(i.provider)) ?? false;
}

/**
 * OAuth users who still have the auto-generated default profile name must set a display name
 * before entering the app (Apple/Google may not supply `display_name` in user metadata).
 */
export function shouldPromptOauthDisplayName(
  user: User | null | undefined,
  profileDisplayNameFromStore: string
): boolean {
  if (!userHasOAuthIdentity(user)) return false;
  const dn = profileDisplayNameFromStore.trim();
  return dn === '' || dn === 'Golfer';
}
