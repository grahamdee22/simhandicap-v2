/**
 * Optional RevenueCat wrapper. No-ops on web and when platform API keys are unset,
 * so the app behaves identically with or without RevenueCat configured.
 */

import { Platform } from 'react-native';
import type {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';

/** RevenueCat dashboard entitlement identifier (Oct 10 2026). Display name is "SimCap Pro". */
export const SIMCAP_PRO_ENTITLEMENT_ID = 'simcap_pro';

let purchasesConfigured = false;

type PurchasesSdk = {
  configure: (opts: { apiKey: string }) => void;
  logIn: (id: string) => Promise<unknown>;
  logOut: () => Promise<unknown>;
  getOfferings: () => Promise<{ current: PurchasesOffering | null }>;
  purchasePackage: (pkg: PurchasesPackage) => Promise<{ customerInfo: CustomerInfo }>;
  restorePurchases: () => Promise<CustomerInfo>;
  getCustomerInfo: () => Promise<CustomerInfo>;
  PURCHASES_ERROR_CODE: { PURCHASE_CANCELLED_ERROR: string };
};

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

function loadPurchases(): PurchasesSdk | null {
  if (Platform.OS === 'web') return null;
  try {
    // Lazy require so web never loads the native module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases') as {
      default: PurchasesSdk;
      PURCHASES_ERROR_CODE?: { PURCHASE_CANCELLED_ERROR: string };
    };
    const Purchases = mod.default;
    if (!Purchases.PURCHASES_ERROR_CODE && mod.PURCHASES_ERROR_CODE) {
      Purchases.PURCHASES_ERROR_CODE = mod.PURCHASES_ERROR_CODE;
    }
    return Purchases;
  } catch (e) {
    console.warn('[purchases] module unavailable', e);
    return null;
  }
}

function isUserCancelledPurchase(err: unknown, Purchases: PurchasesSdk): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; userCancelled?: boolean | null };
  if (e.userCancelled === true) return true;
  const cancelled = Purchases.PURCHASES_ERROR_CODE?.PURCHASE_CANCELLED_ERROR;
  return !!cancelled && e.code === cancelled;
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

/** Current/default offering, or null on web / unconfigured / error. Never throws. */
export async function getOfferings(): Promise<PurchasesOffering | null> {
  if (Platform.OS === 'web' || !purchasesConfigured) return null;
  const Purchases = loadPurchases();
  if (!Purchases) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? null;
  } catch (e) {
    console.warn('[purchases] getOfferings failed', e);
    return null;
  }
}

/** Purchase a package. Distinguishes user cancel from real failure. Never throws. */
export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<{ success: boolean; cancelled?: boolean; error?: string }> {
  if (Platform.OS === 'web') {
    return { success: false, error: 'Subscriptions are not available on web.' };
  }
  if (!purchasesConfigured) {
    return { success: false, error: 'Purchases are not configured.' };
  }
  const Purchases = loadPurchases();
  if (!Purchases) {
    return { success: false, error: 'Purchases module unavailable.' };
  }
  try {
    await Purchases.purchasePackage(pkg);
    return { success: true };
  } catch (e) {
    if (isUserCancelledPurchase(e, Purchases)) {
      return { success: false, cancelled: true };
    }
    const message = e instanceof Error ? e.message : 'Purchase failed.';
    console.warn('[purchases] purchasePackage failed', e);
    return { success: false, error: message };
  }
}

/** Restore prior purchases. Never throws. */
export async function restorePurchases(): Promise<{ success: boolean; error?: string }> {
  if (Platform.OS === 'web') {
    return { success: false, error: 'Subscriptions are not available on web.' };
  }
  if (!purchasesConfigured) {
    return { success: false, error: 'Purchases are not configured.' };
  }
  const Purchases = loadPurchases();
  if (!Purchases) {
    return { success: false, error: 'Purchases module unavailable.' };
  }
  try {
    await Purchases.restorePurchases();
    return { success: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Restore failed.';
    console.warn('[purchases] restorePurchases failed', e);
    return { success: false, error: message };
  }
}

/** Whether the `simcap_pro` entitlement is active. Never throws. */
export async function getIsProEntitled(): Promise<boolean> {
  if (Platform.OS === 'web' || !purchasesConfigured) return false;
  const Purchases = loadPurchases();
  if (!Purchases) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return !!info.entitlements.active[SIMCAP_PRO_ENTITLEMENT_ID];
  } catch (e) {
    console.warn('[purchases] getCustomerInfo failed', e);
    return false;
  }
}

export type { PurchasesOffering, PurchasesPackage };
