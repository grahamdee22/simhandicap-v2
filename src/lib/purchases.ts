/**
 * Optional RevenueCat wrapper. No-ops on web and when platform API keys are unset,
 * so the app behaves identically with or without RevenueCat configured.
 */

import { Platform } from 'react-native';

let purchasesConfigured = false;

function platformApiKey(): string | null {
  if (Platform.OS === 'ios') {
    const k = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim();
    return k || null;
  }
  if (Platform.OS === 'android') {
    const k = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim();
    return k || null;
  }
  return null;
}

function loadPurchases(): { configure: (opts: { apiKey: string }) => void; logIn: (id: string) => Promise<unknown>; logOut: () => Promise<unknown> } | null {
  if (Platform.OS === 'web') return null;
  try {
    // Lazy require so web never loads the native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases') as { default: {
      configure: (opts: { apiKey: string }) => void;
      logIn: (id: string) => Promise<unknown>;
      logOut: () => Promise<unknown>;
    } };
    return mod.default;
  } catch (e) {
    console.warn('[purchases] module unavailable', e);
    return null;
  }
}

/** Call once at app startup. Safe when keys are missing or on web. */
export function initPurchasesIfConfigured(): void {
  if (Platform.OS === 'web') return;
  if (purchasesConfigured) return;
  const apiKey = platformApiKey();
  if (!apiKey) return;
  const Purchases = loadPurchases();
  if (!Purchases) return;
  try {
    Purchases.configure({ apiKey });
    purchasesConfigured = true;
  } catch (e) {
    console.warn('[purchases] configure failed', e);
    purchasesConfigured = false;
  }
}

/** Link RevenueCat app_user_id to the Supabase user id. Never throws. */
export async function identifyPurchasesUser(userId: string): Promise<void> {
  if (Platform.OS === 'web' || !purchasesConfigured || !userId) return;
  const Purchases = loadPurchases();
  if (!Purchases) return;
  try {
    await Purchases.logIn(userId);
  } catch (e) {
    console.warn('[purchases] logIn failed', e);
  }
}

/** Clear RevenueCat identity on sign-out. Never throws. */
export async function resetPurchasesUser(): Promise<void> {
  if (Platform.OS === 'web' || !purchasesConfigured) return;
  const Purchases = loadPurchases();
  if (!Purchases) return;
  try {
    await Purchases.logOut();
  } catch (e) {
    console.warn('[purchases] logOut failed', e);
  }
}
