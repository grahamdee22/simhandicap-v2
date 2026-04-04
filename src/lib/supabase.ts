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
          detectSessionInUrl: false,
        },
      })
    : null;

export function isSupabaseConfigured(): boolean {
  return supabase != null;
}
