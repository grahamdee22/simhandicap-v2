import type { Session, User } from '@supabase/supabase-js';
import { usePathname, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { applyProfileRowToStore, fetchMyProfile } from '../lib/profiles';
import { fetchMyRoundsForUser } from '../lib/rounds';
import {
  attachSocialGroupsRealtimeSync,
  fetchInboundGroupInvitesIntoStore,
  fetchMySocialGroupsIntoStore,
} from '../lib/socialGroups';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { rebindPersistToUser, useAppStore } from '../store/useAppStore';

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (
    email: string,
    password: string,
    displayName: string
  ) => Promise<{ error?: string; sessionCreated?: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function syncProfileIntoStore(): Promise<void> {
  const p = await fetchMyProfile();
  const { setDisplayName, setPreferredLogPlatform, syncGhinFromProfileIfChanged } = useAppStore.getState();
  applyProfileRowToStore(p, { setDisplayName, setPreferredLogPlatform, syncGhinFromProfileIfChanged });
}

/** Expo Router may omit route groups from segments; pathname is usually `/sign-in`, `/sign-up`. */
function isAuthRoute(segments: string[], pathname: string): boolean {
  if (segments[0] === '(auth)' || segments.includes('(auth)')) return true;
  if (
    segments.includes('sign-in') ||
    segments.includes('sign-up') ||
    segments.includes('forgot-password') ||
    segments.includes('reset-password')
  )
    return true;
  const p = pathname.replace(/\/$/, '') || '/';
  if (p === '/sign-in' || p === '/sign-up' || p === '/forgot-password' || p === '/reset-password') return true;
  if (
    p.endsWith('/sign-in') ||
    p.endsWith('/sign-up') ||
    p.endsWith('/forgot-password') ||
    p.endsWith('/reset-password')
  )
    return true;
  return false;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState<Session | null>(null);
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const navReady = useRootNavigationState()?.key != null;

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      if (Platform.OS === 'web') void useAppStore.persist.rehydrate();
      return;
    }

    let cancelled = false;

    (async () => {
      const { data } = await supabase!.auth.getSession();
      if (cancelled) return;
      await rebindPersistToUser(data.session?.user.id ?? null);
      if (data.session?.user) {
        const remoteRounds = await fetchMyRoundsForUser();
        if (remoteRounds !== null) {
          useAppStore.getState().replaceRoundsFromRemote(remoteRounds);
        }
        await syncProfileIntoStore();
        await fetchMySocialGroupsIntoStore();
        await fetchInboundGroupInvitesIntoStore();
        useAppStore.getState().recomputeGroupsFromYou();
      }
      setSession(data.session);
      setLoading(false);
    })();

    const {
      data: { subscription },
    } = supabase!.auth.onAuthStateChange(async (event, next) => {
      await rebindPersistToUser(next?.user.id ?? null);
      const syncProfile =
        event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED';
      if (syncProfile && next?.user) {
        const remoteRounds = await fetchMyRoundsForUser();
        if (remoteRounds !== null) {
          useAppStore.getState().replaceRoundsFromRemote(remoteRounds);
        }
        await syncProfileIntoStore();
        await fetchMySocialGroupsIntoStore();
        await fetchInboundGroupInvitesIntoStore();
        useAppStore.getState().recomputeGroupsFromYou();
      } else if (!next?.user) {
        useAppStore.getState().setInboundGroupInvites([]);
      }
      setSession(next);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [configured]);

  useEffect(() => {
    if (!configured || !session?.user) {
      return;
    }
    const s = session;
    const detach = attachSocialGroupsRealtimeSync(s.access_token);
    return detach;
  }, [configured, session?.user?.id, session?.access_token]);

  useEffect(() => {
    if (!configured || loading || !navReady) return;
    const inAuth = isAuthRoute(segments, pathname);
    const p = pathname.replace(/\/$/, '') || '/';
    const onPasswordReset = p.includes('reset-password');
    if (!session && !inAuth) {
      router.replace('/(auth)/sign-in');
    } else if (session && inAuth && !onPasswordReset) {
      router.replace('/');
    }
  }, [configured, loading, session, segments, pathname, navReady, router]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: 'Supabase is not configured' };
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return error ? { error: error.message } : {};
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    if (!supabase) return { error: 'Supabase is not configured' };
    const dn = displayName.trim() || 'Golfer';
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: dn } },
    });
    if (error) return { error: error.message };
    return { sessionCreated: !!data.session };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const SIGN_OUT_MS = 20000;
    try {
      await Promise.race([
        supabase.auth.signOut(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`signOut timed out after ${SIGN_OUT_MS}ms`)), SIGN_OUT_MS)
        ),
      ]);
    } catch (e) {
      console.warn('[auth] signOut: error or timeout', e instanceof Error ? e.message : e);
      /** Unblock a wedged client: clear local session even if the server round-trip never completes. */
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch (e2) {
        console.warn('[auth] signOut: local fallback failed', e2 instanceof Error ? e2.message : e2);
      }
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!configured || !session) return;
    const remoteRounds = await fetchMyRoundsForUser();
    if (remoteRounds !== null) {
      useAppStore.getState().replaceRoundsFromRemote(remoteRounds);
    }
    await syncProfileIntoStore();
    await fetchMySocialGroupsIntoStore();
    await fetchInboundGroupInvitesIntoStore();
    useAppStore.getState().recomputeGroupsFromYou();
  }, [configured, session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured,
      loading,
      session,
      user: session?.user ?? null,
      signIn,
      signUp,
      signOut,
      refreshProfile,
    }),
    [configured, loading, session, signIn, signUp, signOut, refreshProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
