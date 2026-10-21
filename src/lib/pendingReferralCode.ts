/**
 * Pending referral + signup_platform attribution for OAuth (and deep-link) signups.
 *
 * Email/password signup already passes referral_code / platform via signUp metadata → handle_new_user().
 * OAuth (Google/Apple) has no path to set raw_user_meta_data before the trigger fires, so we
 * stash values locally and write them once the profile row exists — only when still null.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  normalizeReferralCode,
  parseReferralCodeFromUrl,
} from './referralCodeNormalize';
import { normalizeReferralSource, type ReferralSource } from './referralSource';
import { normalizeSignupPlatform, type SignupPlatform } from './signupPlatform';

export { normalizeReferralCode, parseReferralCodeFromUrl } from './referralCodeNormalize';
export { normalizeReferralSource } from './referralSource';
export type { ReferralSource } from './referralSource';
export { normalizeSignupPlatform } from './signupPlatform';
export type { SignupPlatform } from './signupPlatform';

export const PENDING_REFERRAL_CODE_KEY = '@simcap/pending_referral_code';
export const PENDING_REFERRAL_SOURCE_KEY = '@simcap/pending_referral_source';
export const PENDING_SIGNUP_PLATFORM_KEY = '@simcap/pending_signup_platform';

export async function getPendingReferralCode(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_REFERRAL_CODE_KEY);
    return normalizeReferralCode(raw);
  } catch {
    return null;
  }
}

/** Stores a pending code (overwrites). No-op if blank after normalize. */
export async function setPendingReferralCode(raw: string | null | undefined): Promise<void> {
  const code = normalizeReferralCode(raw);
  if (!code) return;
  try {
    await AsyncStorage.setItem(PENDING_REFERRAL_CODE_KEY, code);
  } catch {
    /* ignore */
  }
}

export async function clearPendingReferralCode(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
  } catch {
    /* ignore */
  }
}

/** If URL carries a referral param, persist it (source=link) for a later OAuth (or email) signup. */
export async function captureReferralCodeFromUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const code = parseReferralCodeFromUrl(url);
  if (code) {
    await setPendingReferralCode(code);
    await setPendingReferralSource('link');
  }
  return code;
}

export async function getPendingReferralSource(): Promise<ReferralSource | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_REFERRAL_SOURCE_KEY);
    return normalizeReferralSource(raw);
  } catch {
    return null;
  }
}

/** Stores pending referral_source (overwrites). No-op if not link|typed. */
export async function setPendingReferralSource(raw: string | null | undefined): Promise<void> {
  const source = normalizeReferralSource(raw);
  if (!source) return;
  try {
    await AsyncStorage.setItem(PENDING_REFERRAL_SOURCE_KEY, source);
  } catch {
    /* ignore */
  }
}

export async function clearPendingReferralSource(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_REFERRAL_SOURCE_KEY);
  } catch {
    /* ignore */
  }
}

function getSupabaseRestConfig(): { supabaseUrl: string; supabaseAnonKey: string } {
  const extra = Constants.expoConfig?.extra as
    | { supabaseUrl?: string; supabaseAnonKey?: string; supabasePublishableKey?: string }
    | undefined;
  return {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra?.supabaseUrl ?? '',
    supabaseAnonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_KEY ??
      extra?.supabaseAnonKey ??
      extra?.supabasePublishableKey ??
      '',
  };
}

/**
 * One-time client write: if a pending code exists and profiles.referral_code is still null,
 * set it. Never overwrites a non-null value. Clears pending after a successful write or when
 * the column is already set (so we don't keep retrying forever).
 */
export async function applyPendingReferralCodeIfNeeded(
  userId: string,
  accessToken: string
): Promise<{ applied: boolean; reason?: string }> {
  const pending = await getPendingReferralCode();
  if (!pending) return { applied: false, reason: 'no_pending' };

  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { applied: false, reason: 'not_configured' };
  }

  const selectUrl = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=referral_code,referral_source&limit=1`;
  const selectRes = await fetch(selectUrl, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!selectRes.ok) {
    return { applied: false, reason: 'select_failed' };
  }
  const rows = (await selectRes.json()) as Array<{
    referral_code: string | null;
    referral_source: string | null;
  }>;
  if (!Array.isArray(rows) || rows.length === 0) {
    // Profile row not ready yet — keep pending for a later hydrate.
    return { applied: false, reason: 'no_profile' };
  }

  const existing = normalizeReferralCode(rows[0]?.referral_code ?? null);
  if (existing) {
    await clearPendingReferralCode();
    return { applied: false, reason: 'already_set' };
  }

  const pendingSource = await getPendingReferralSource();
  const body: { referral_code: string; referral_source?: ReferralSource } = {
    referral_code: pending,
  };
  if (pendingSource) body.referral_source = pendingSource;

  const patchRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&referral_code=is.null`,
    {
      method: 'PATCH',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    }
  );
  if (!patchRes.ok) {
    return { applied: false, reason: 'patch_failed' };
  }

  await clearPendingReferralCode();
  if (pendingSource) await clearPendingReferralSource();
  return { applied: true };
}

/**
 * One-time client write: if pending referral_source exists and profiles.referral_source is null,
 * set it. Never overwrites. Used when code was already written but source was pending.
 */
export async function applyPendingReferralSourceIfNeeded(
  userId: string,
  accessToken: string
): Promise<{ applied: boolean; reason?: string }> {
  const pending = await getPendingReferralSource();
  if (!pending) return { applied: false, reason: 'no_pending' };

  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { applied: false, reason: 'not_configured' };
  }

  const selectUrl = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=referral_source&limit=1`;
  const selectRes = await fetch(selectUrl, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!selectRes.ok) {
    return { applied: false, reason: 'select_failed' };
  }
  const rows = (await selectRes.json()) as Array<{ referral_source: string | null }>;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { applied: false, reason: 'no_profile' };
  }

  const existing = normalizeReferralSource(rows[0]?.referral_source ?? null);
  if (existing) {
    await clearPendingReferralSource();
    return { applied: false, reason: 'already_set' };
  }

  const patchRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&referral_source=is.null`,
    {
      method: 'PATCH',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ referral_source: pending }),
    }
  );
  if (!patchRes.ok) {
    return { applied: false, reason: 'patch_failed' };
  }

  await clearPendingReferralSource();
  return { applied: true };
}

export async function getPendingSignupPlatform(): Promise<SignupPlatform | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_SIGNUP_PLATFORM_KEY);
    return normalizeSignupPlatform(raw);
  } catch {
    return null;
  }
}

/** Stores pending platform (overwrites). No-op if not ios/android/web. */
export async function setPendingSignupPlatform(raw: string | null | undefined): Promise<void> {
  const platform = normalizeSignupPlatform(raw);
  if (!platform) return;
  try {
    await AsyncStorage.setItem(PENDING_SIGNUP_PLATFORM_KEY, platform);
  } catch {
    /* ignore */
  }
}

export async function clearPendingSignupPlatform(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_SIGNUP_PLATFORM_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * One-time client write: if a pending platform exists and profiles.signup_platform is still null,
 * set it. Never overwrites a non-null value.
 */
export async function applyPendingSignupPlatformIfNeeded(
  userId: string,
  accessToken: string
): Promise<{ applied: boolean; reason?: string }> {
  const pending = await getPendingSignupPlatform();
  if (!pending) return { applied: false, reason: 'no_pending' };

  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { applied: false, reason: 'not_configured' };
  }

  const selectUrl = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=signup_platform&limit=1`;
  const selectRes = await fetch(selectUrl, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!selectRes.ok) {
    return { applied: false, reason: 'select_failed' };
  }
  const rows = (await selectRes.json()) as Array<{ signup_platform: string | null }>;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { applied: false, reason: 'no_profile' };
  }

  const existing = normalizeSignupPlatform(rows[0]?.signup_platform ?? null);
  if (existing) {
    await clearPendingSignupPlatform();
    return { applied: false, reason: 'already_set' };
  }

  const patchRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&signup_platform=is.null`,
    {
      method: 'PATCH',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ signup_platform: pending }),
    }
  );
  if (!patchRes.ok) {
    return { applied: false, reason: 'patch_failed' };
  }

  await clearPendingSignupPlatform();
  return { applied: true };
}

/** Apply pending referral_code, referral_source, and signup_platform (null-only) after OAuth / hydrate. */
export async function applyPendingSignupAttributionIfNeeded(
  userId: string,
  accessToken: string
): Promise<void> {
  await applyPendingReferralCodeIfNeeded(userId, accessToken);
  await applyPendingReferralSourceIfNeeded(userId, accessToken);
  await applyPendingSignupPlatformIfNeeded(userId, accessToken);
}
