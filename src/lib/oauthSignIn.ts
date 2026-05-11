import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Provider, Session } from '@supabase/supabase-js';
import { router, type Href } from 'expo-router';
import { injectOAuthSession } from '@/src/auth/AuthContext';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { supabase } from './supabase';

void WebBrowser.maybeCompleteAuthSession();

export function getOAuthRedirectUri(): string {
  if (Platform.OS === 'web') {
    return 'https://app.sim-cap.com/auth/callback';
  }
  return 'simcap://auth/callback';
}

/** Parse implicit OAuth redirect: tokens and errors in URL hash or query (same shape as password recovery links). */
export function parseOAuthImplicitSessionFromUrl(url: string): {
  access_token: string | null;
  refresh_token: string | null;
  error: string | null;
  error_description: string | null;
} {
  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx + 1) : '';
  const qIdx = url.indexOf('?');
  const queryOnly =
    qIdx >= 0 && (hashIdx < 0 || qIdx < hashIdx) ? url.slice(qIdx + 1).split('#')[0] : '';
  const sp = new URLSearchParams(hash || queryOnly);
  return {
    access_token: sp.get('access_token'),
    refresh_token: sp.get('refresh_token'),
    error: sp.get('error'),
    error_description: sp.get('error_description'),
  };
}

export function parseOAuthCallbackUrl(href: string): {
  code: string | null;
  error: string | null;
  error_description: string | null;
} {
  try {
    const u = new URL(href);
    return {
      code: u.searchParams.get('code'),
      error: u.searchParams.get('error'),
      error_description: u.searchParams.get('error_description'),
    };
  } catch {
    const q = href.includes('?') ? href.split('?').slice(1).join('?') : '';
    const params = new URLSearchParams(q);
    return {
      code: params.get('code'),
      error: params.get('error'),
      error_description: params.get('error_description'),
    };
  }
}

export async function signInWithOAuthProvider(provider: Provider): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured' };
  const redirectTo = getOAuthRedirectUri();

  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return { error: 'Web sign-in is unavailable' };
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });
    if (error) return { error: error.message };
    if (data.url) window.location.assign(data.url);
    return {};
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) return { error: error.message };
  if (!data?.url) return { error: 'Could not start sign in' };

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, {
    preferEphemeralSession: true,
  });

  if (result.type === 'dismiss' || result.type === 'cancel') {
    return {};
  }
  if (result.type !== 'success' || !('url' in result) || !result.url) {
    return { error: 'Sign in was not completed' };
  }

  const parsed = parseOAuthCallbackUrl(result.url);
  const implicit = parseOAuthImplicitSessionFromUrl(result.url);
  const oauthErr = parsed.error ?? implicit.error;
  if (oauthErr) {
    return { error: parsed.error_description ?? implicit.error_description ?? oauthErr };
  }

  if (implicit.access_token && implicit.refresh_token) {
    const client = supabase;
    const { data: userData, error: userErr } = await client.auth.getUser(implicit.access_token);
    if (userErr || !userData?.user) {
      return { error: userErr?.message ?? 'Could not validate session token' };
    }

    const storageKey = 'supabase.auth.token';
    const sessionData = JSON.stringify({
      access_token: implicit.access_token,
      refresh_token: implicit.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: 'bearer',
      user: userData.user,
    });
    await AsyncStorage.setItem(storageKey, sessionData);

    const fakeSession = {
      access_token: implicit.access_token,
      refresh_token: implicit.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      expires_in: 3600,
      token_type: 'bearer',
      user: userData.user,
    };
    if (injectOAuthSession) {
      injectOAuthSession(fakeSession as Session);
    }

    await client.auth.initialize();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const extra = Constants.expoConfig?.extra as
      | {
          supabaseUrl?: string;
          supabaseAnonKey?: string;
          supabasePublishableKey?: string;
        }
      | undefined;

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra?.supabaseUrl ?? '';
    const supabaseAnonKey =
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_KEY ??
      extra?.supabaseAnonKey ??
      extra?.supabasePublishableKey ??
      '';

    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${userData.user.id}&select=id&limit=1`,
      {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${implicit.access_token}`,
        },
      }
    );
    const profileRows = await profileRes.json();
    const hasProfile = Array.isArray(profileRows) && profileRows.length > 0;

    if (hasProfile) {
      router.replace('/(tabs)' as Href);
    } else {
      router.replace('/(auth)/onboarding' as Href);
    }
    return {};
  }

  if (parsed.code) {
    const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(parsed.code);
    if (exchangeErr) return { error: exchangeErr.message };
    return {};
  }

  return { error: 'Missing authorization code or session tokens' };
}
