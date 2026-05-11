import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Provider, Session, User } from '@supabase/supabase-js';
import { router, type Href } from 'expo-router';
import { injectOAuthSession } from '@/src/auth/AuthContext';
import Constants from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { applyProfileRowToStore, fetchMyProfile } from '@/src/lib/profiles';
import { fetchMyRoundsForUser } from '@/src/lib/rounds';
import { fetchInboundGroupInvitesIntoStore, fetchMySocialGroupsIntoStore } from '@/src/lib/socialGroups';
import { rebindPersistToUser, useAppStore } from '@/src/store/useAppStore';
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

/**
 * Native (Google implicit + Apple ID token): persist session, inject auth state, sync store, navigate.
 * Matches the working Google OAuth post-token flow (no in-memory Supabase session until storage + inject).
 */
async function persistNativeOAuthSessionAndNavigate(
  accessToken: string,
  refreshToken: string,
  user: User,
  options?: { appleDebugLogs?: boolean }
): Promise<{ error?: string }> {
  const client = supabase!;
  const storageKey = 'supabase.auth.token';
  const sessionData = JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user,
  });
  await AsyncStorage.setItem(storageKey, sessionData);

  const fakeSession = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user,
  };
  if (injectOAuthSession) {
    injectOAuthSession(fakeSession as Session);
  }

  await rebindPersistToUser(user.id);

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

  const remoteRounds = await fetchMyRoundsForUser(user.id, accessToken);
  if (options?.appleDebugLogs) {
    console.log('[apple] remoteRounds:', remoteRounds?.length ?? 'null');
  }
  if (remoteRounds !== null) {
    useAppStore.getState().replaceRoundsFromRemote(remoteRounds);
  }

  const profile = await fetchMyProfile(user.id, accessToken);
  if (options?.appleDebugLogs) {
    console.log('[apple] profile display_name:', profile?.display_name ?? 'null');
  }
  const { setDisplayName, setPreferredLogPlatform, syncGhinFromProfileIfChanged } = useAppStore.getState();
  applyProfileRowToStore(profile, {
    setDisplayName,
    setPreferredLogPlatform,
    syncGhinFromProfileIfChanged,
  });

  const currentDisplayName = useAppStore.getState().displayName;
  if (!currentDisplayName || currentDisplayName === 'Golfer' || currentDisplayName.includes('@')) {
    const emailPrefix = (user.email ?? '').split('@')[0];
    if (emailPrefix) {
      useAppStore.getState().setDisplayName(emailPrefix);
      if (supabaseUrl && supabaseAnonKey) {
        await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
          method: 'PATCH',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ display_name: emailPrefix }),
        });
      }
    }
  }

  await fetchMySocialGroupsIntoStore(user.id);
  await fetchInboundGroupInvitesIntoStore(user.id);
  useAppStore.getState().recomputeGroupsFromYou();

  const profileRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=id&limit=1`,
    {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
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

export async function signInWithApple(): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured' };
  if (Platform.OS !== 'ios') {
    return { error: 'Apple Sign In is only available on iOS' };
  }

  try {
    const available = await AppleAuthentication.isAvailableAsync();
    if (!available) {
      return { error: 'Apple Sign In is not available on this device' };
    }

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    const identityToken = credential.identityToken;
    console.log('[apple] credential received, identityToken present:', !!identityToken);
    if (!identityToken) {
      return { error: 'Apple did not return an identity token' };
    }

    let data: Awaited<ReturnType<typeof supabase.auth.signInWithIdToken>>['data'];
    let error: Awaited<ReturnType<typeof supabase.auth.signInWithIdToken>>['error'];
    try {
      const result = await Promise.race([
        supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
      ]);
      data = result.data;
      error = result.error;
    } catch {
      console.log('[apple] timed out');
      return { error: 'Apple Sign In timed out' };
    }

    console.log(
      '[apple] signInWithIdToken result - user:',
      data?.session?.user?.email,
      'error:',
      error
    );
    if (error) {
      return { error: error.message };
    }
    const session = data.session;
    if (!session?.access_token || !session.user) {
      return { error: 'Apple sign-in did not return a session' };
    }
    const accessToken = session.access_token;
    const refreshToken = session.refresh_token;
    if (!refreshToken) {
      return { error: 'Apple sign-in did not return a refresh token' };
    }
    console.log('[apple] access_token present:', !!accessToken);

    return persistNativeOAuthSessionAndNavigate(accessToken, refreshToken, session.user, {
      appleDebugLogs: true,
    });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === 'ERR_REQUEST_CANCELED') {
      return {};
    }
    return { error: e instanceof Error ? e.message : 'Apple Sign In failed' };
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

  if (provider !== 'google') {
    return { error: 'Use Apple Sign In on iOS' };
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

    return persistNativeOAuthSessionAndNavigate(
      implicit.access_token,
      implicit.refresh_token,
      userData.user
    );
  }

  if (parsed.code) {
    const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(parsed.code);
    if (exchangeErr) return { error: exchangeErr.message };
    return {};
  }

  return { error: 'Missing authorization code or session tokens' };
}
