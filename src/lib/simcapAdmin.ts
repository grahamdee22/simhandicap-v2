import type { User } from '@supabase/supabase-js';

/** Support inbox — also accepted as an admin login email when used. */
export const SIMCAP_SUPPORT_EMAIL = 'simcapadmin@gmail.com';

/**
 * Extra admin login emails (comma-separated), e.g. Graham's personal Google/Apple account.
 * Set at build time: EXPO_PUBLIC_ADMIN_EMAILS=you@example.com
 */
function envAdminEmails(): string[] {
  const raw = process.env.EXPO_PUBLIC_ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const BUILTIN_ADMIN_EMAILS = [SIMCAP_SUPPORT_EMAIL] as const;

export function adminEmailAllowlist(): string[] {
  return [...new Set([...BUILTIN_ADMIN_EMAILS, ...envAdminEmails()])];
}

/** Collect every email claim on the Supabase user (primary + OAuth identities). */
export function emailsFromAuthUser(user: User | null | undefined): string[] {
  if (!user) return [];
  const out = new Set<string>();
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.add(v.trim().toLowerCase());
  };
  push(user.email);
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  push(meta?.email);
  push(meta?.preferred_username);
  for (const identity of user.identities ?? []) {
    const data = identity.identity_data as Record<string, unknown> | undefined;
    push(data?.email);
  }
  return [...out];
}

export function isSimCapAdminFromUser(user: User | null | undefined): boolean {
  const allow = new Set(adminEmailAllowlist());
  return emailsFromAuthUser(user).some((e) => allow.has(e));
}

/**
 * Authoritative admin check: email allowlist (client) OR profiles.is_app_admin (RPC).
 * Prefer this for gating UI; promote/delete RPCs stay server-side via the same helper.
 */
export async function fetchIsSimCapAdmin(user?: User | null): Promise<boolean> {
  if (isSimCapAdminFromUser(user)) return true;
  const { supabase } = await import('./supabase');
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('is_simcap_admin');
  if (error) {
    console.warn('[simcapAdmin] is_simcap_admin', error.message);
    return false;
  }
  return data === true;
}
