import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = Constants.expoConfig?.extra as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabasePublishableKey?: string;
} | undefined;

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra?.supabaseUrl ?? '';
/** Supports legacy anon key name and dashboard “publishable” key (`EXPO_PUBLIC_SUPABASE_KEY`). */
const anon =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_KEY ??
  extra?.supabaseAnonKey ??
  extra?.supabasePublishableKey ??
  '';

/** Web / SSR-safe: avoid `@react-native-async-storage/async-storage` (uses `window` at init). */
function webLocalStorageAdapter() {
  return {
    getItem: (key: string) => {
      if (typeof window === 'undefined') return Promise.resolve(null);
      try {
        return Promise.resolve(window.localStorage.getItem(key));
      } catch {
        return Promise.resolve(null);
      }
    },
    setItem: (key: string, value: string) => {
      if (typeof window === 'undefined') return Promise.resolve();
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* quota / private mode */
      }
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      if (typeof window === 'undefined') return Promise.resolve();
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      return Promise.resolve();
    },
  };
}

function getAuthStorage() {
  if (Platform.OS === 'web') {
    return webLocalStorageAdapter();
  }
  // Lazy require so the web bundle never loads AsyncStorage (fixes "window is not defined").
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-async-storage/async-storage').default;
}

/**
 * Supabase client is created when URL + key are configured.
 * Auth persistence: `localStorage` on web, AsyncStorage on iOS/Android.
 */
export const supabase: SupabaseClient | null =
  url && anon
    ? createClient(url, anon, {
        auth: {
          storage: getAuthStorage(),
          autoRefreshToken: true,
          persistSession: true,
          /** Native: Expo Router + callback screen handle OAuth URLs. Web: allow Supabase to read PKCE/hash from the page URL. */
          detectSessionInUrl: Platform.OS === 'web',
          /**
           * Web: PKCE (WebCrypto). Native: implicit avoids PKCE verifier generation issues (e.g. iOS Simulator).
           * Native still supports PKCE-style `?code=` redirects in the callback handler as a fallback.
           */
          flowType: Platform.OS === 'web' ? 'pkce' : 'implicit',
        },
      })
    : null;

export function isSupabaseConfigured(): boolean {
  return supabase != null;
}
