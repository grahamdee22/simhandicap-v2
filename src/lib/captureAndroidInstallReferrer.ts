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
  isCampaignPlayChannel,
  parseChannelFromPlayInstallReferrer,
} from './playInstallReferrer';

export const ANDROID_INSTALL_REFERRER_CAPTURED_KEY = '@simcap/android_install_referrer_captured';

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
}): Promise<void> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/android_install_referrer_events`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        referrer_raw: args.referrerRaw,
        parsed_channel: args.parsedChannel,
        platform: 'android',
      }),
    });
  } catch (e) {
    console.warn('[android-install-referrer] insert failed', e);
  }
}

/**
 * Idempotent: runs at most once per install (AsyncStorage flag).
 * Safe to call on web/iOS (no-op).
 */
export async function captureAndroidInstallReferrerOnce(): Promise<{
  ran: boolean;
  channel: string | null;
  reason?: string;
}> {
  if (Platform.OS !== 'android') {
    return { ran: false, channel: null, reason: 'not_android' };
  }

  try {
    const already = await AsyncStorage.getItem(ANDROID_INSTALL_REFERRER_CAPTURED_KEY);
    if (already) return { ran: false, channel: null, reason: 'already_captured' };
  } catch {
    /* continue — better to attempt once than skip forever if storage fails */
  }

  let referrerRaw: string | null = null;
  try {
    // Dynamic import so web/iOS bundles don't require the native module at load time.
    const Application = await import('expo-application');
    referrerRaw = await Application.getInstallReferrerAsync();
  } catch (e) {
    console.warn('[android-install-referrer] getInstallReferrerAsync failed', e);
    // Mark captured so we don't hammer a broken Play Store / emulator on every launch.
    try {
      await AsyncStorage.setItem(ANDROID_INSTALL_REFERRER_CAPTURED_KEY, '1');
    } catch {
      /* ignore */
    }
    return { ran: true, channel: null, reason: 'referrer_unavailable' };
  }

  try {
    await AsyncStorage.setItem(ANDROID_INSTALL_REFERRER_CAPTURED_KEY, '1');
  } catch {
    /* ignore */
  }

  if (!referrerRaw?.trim()) {
    return { ran: true, channel: null, reason: 'empty_referrer' };
  }

  const parsedChannel = parseChannelFromPlayInstallReferrer(referrerRaw);
  await insertReferrerEvent({ referrerRaw, parsedChannel });

  if (isCampaignPlayChannel(parsedChannel)) {
    await setPendingReferralCode(parsedChannel);
    await setPendingReferralSource('link');
    return { ran: true, channel: parsedChannel };
  }

  return { ran: true, channel: parsedChannel, reason: 'organic_or_no_utm_source' };
}
