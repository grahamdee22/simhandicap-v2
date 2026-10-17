/**
 * Pending referral attribution for OAuth (and deep-link) signups.
 *
 * Email/password signup already passes referral_code via signUp metadata → handle_new_user().
 * OAuth (Google/Apple) has no path to set raw_user_meta_data before the trigger fires, so we
 * stash the code locally and write it once the profile row exists — only when still null.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  normalizeReferralCode,
  parseReferralCodeFromUrl,
} from './referralCodeNormalize';

export { normalizeReferralCode, parseReferralCodeFromUrl } from './referralCodeNormalize';

export const PENDING_REFERRAL_CODE_KEY = '@simcap/pending_referral_code';

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

/** If URL carries a referral param, persist it for a later OAuth (or email) signup. */
export async function captureReferralCodeFromUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  const code = parseReferralCodeFromUrl(url);
  if (code) await setPendingReferralCode(code);
  return code;
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

  const selectUrl = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=referral_code&limit=1`;
  const selectRes = await fetch(selectUrl, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!selectRes.ok) {
    return { applied: false, reason: 'select_failed' };
  }
  const rows = (await selectRes.json()) as Array<{ referral_code: string | null }>;
  if (!Array.isArray(rows) || rows.length === 0) {
    // Profile row not ready yet — keep pending for a later hydrate.
    return { applied: false, reason: 'no_profile' };
  }

  const existing = normalizeReferralCode(rows[0]?.referral_code ?? null);
  if (existing) {
    await clearPendingReferralCode();
    return { applied: false, reason: 'already_set' };
  }

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
      body: JSON.stringify({ referral_code: pending }),
    }
  );
  if (!patchRes.ok) {
    return { applied: false, reason: 'patch_failed' };
  }

  await clearPendingReferralCode();
  return { applied: true };
}
