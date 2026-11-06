/**
 * First Android open after a Play install: read Install Referrer, log an event row,
 * and (for campaign utm_source) stash into pendingReferralCode for null-only profile patch.
 *
 * Requires a native Android build with expo-application (not Expo Go / web).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { setPendingReferralCode, setPendingReferralSource } from './pendingReferralCode';
import {
  aliasPlayChannel,
  isCampaignPlayChannel,
  parseChannelFromPlayInstallReferrer,
} from './playInstallReferrer';

export const ANDROID_INSTALL_REFERRER_CAPTURED_KEY = '@simcap/android_install_referrer_captured';
export const ANDROID_INSTALLATION_ID_KEY = '@simcap/android_installation_id';

/** One in-flight capture per JS runtime. A second effect cannot pass the flag check before the first await. */
let captureInFlight: Promise<{ ran: boolean; channel: string | null; reason?: string }> | null = null;

function newInstallationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getOrCreateInstallationId(): Promise<string> {
  try {
    const existing = (await AsyncStorage.getItem(ANDROID_INSTALLATION_ID_KEY))?.trim();
    if (existing) return existing;
  } catch {
    /* generate a new id below */
  }
  const id = newInstallationId();
  try {
    await AsyncStorage.setItem(ANDROID_INSTALLATION_ID_KEY, id);
  } catch {
    /* the in-memory id still dedupes this process; the server unique index covers a retry that keeps it */
  }
  return id;
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

async function insertReferrerEvent(args: {
  referrerRaw: string;
  parsedChannel: string | null;
  installationId: string;
}): Promise<void> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) return;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/insert_android_install_referrer_event`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_referrer_raw: args.referrerRaw,
        p_parsed_channel: args.parsedChannel,
        p_installation_id: args.installationId,
      }),
    });
    // 409 is a duplicate installation_id. The unique index already kept the first row.
    if (!res.ok && res.status !== 409) {
      console.warn('[android-install-referrer] insert failed', res.status);
    }
  } catch (e) {
    console.warn('[android-install-referrer] insert failed', e);
  }
}

/**
 * Idempotent: one log per install.
 * The captured flag is written before the Play call. Previously it was written
 * after getInstallReferrerAsync, so a second launch during that wait both inserted.
 * installation_id is the server-side backstop if the flag write is missed.
 * Safe to call on web/iOS (no-op).
 */
export function captureAndroidInstallReferrerOnce(): Promise<{
  ran: boolean;
  channel: string | null;
  reason?: string;
}> {
  if (Platform.OS !== 'android') {
    return Promise.resolve({ ran: false, channel: null, reason: 'not_android' });
  }
  if (!captureInFlight) {
    captureInFlight = captureAndroidInstallReferrerBody();
  }
  return captureInFlight;
}

async function captureAndroidInstallReferrerBody(): Promise<{
  ran: boolean;
  channel: string | null;
  reason?: string;
}> {
  try {
    const already = await AsyncStorage.getItem(ANDROID_INSTALL_REFERRER_CAPTURED_KEY);
    if (already) return { ran: false, channel: null, reason: 'already_captured' };
  } catch {
    /* continue — better to attempt once than skip forever if storage fails */
  }

  // Claim this install before the slow Play call. The old code set this flag only
  // after getInstallReferrerAsync returned, so a second launch during that wait logged again.
  try {
    await AsyncStorage.setItem(ANDROID_INSTALL_REFERRER_CAPTURED_KEY, '1');
  } catch {
    /* ignore — installation_id still dedupes the insert */
  }
  const installationId = await getOrCreateInstallationId();

  let referrerRaw: string | null = null;
  try {
    // Dynamic import so web/iOS bundles don't require the native module at load time.
    const Application = await import('expo-application');
    referrerRaw = await Application.getInstallReferrerAsync();
  } catch (e) {
    console.warn('[android-install-referrer] getInstallReferrerAsync failed', e);
    return { ran: true, channel: null, reason: 'referrer_unavailable' };
  }

  if (!referrerRaw?.trim()) {
    return { ran: true, channel: null, reason: 'empty_referrer' };
  }

  // Keep raw token for ORGANIC_UTM_SOURCES check (simcap-google ≠ google).
  const parsedChannel = parseChannelFromPlayInstallReferrer(referrerRaw);
  const channel = aliasPlayChannel(parsedChannel);
  await insertReferrerEvent({ referrerRaw, parsedChannel: channel, installationId });

  if (isCampaignPlayChannel(parsedChannel)) {
    await setPendingReferralCode(channel);
    await setPendingReferralSource('link');
    return { ran: true, channel };
  }

  return { ran: true, channel, reason: 'organic_or_no_utm_source' };
}
