import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session, User } from '@supabase/supabase-js';
import { usePathname, useRootNavigationState, useRouter, useSegments, type Href } from 'expo-router';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { applyProfileRowToStore, fetchMyProfile } from '../lib/profiles';
import { fetchMyRoundsForUser } from '../lib/rounds';
import {
  attachSocialGroupsRealtimeSync,
  backfillGroupCreatorsInStore,
  fetchInboundGroupInvitesIntoStore,
  fetchMySocialGroupsIntoStore,
  resolveSocialGroupsAccessToken,
} from '../lib/socialGroups';
import { clearOnboardingSeen, getOnboardingSeen, setOnboardingSeen } from '../lib/onboardingStorage';
import { clearGoogleOAuthAccessToken, googleOAuthAccessToken } from '../lib/googleOAuthAccessToken';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { mapEmailPasswordSignInError } from '../lib/emailPasswordSignInErrors';
import { shouldPromptOauthDisplayName } from '../lib/oauthDisplayNameGate';
import { rebindPersistToUser, useAppStore } from '../store/useAppStore';

/** Set by `AuthProvider`; used after native OAuth writes session to AsyncStorage so the guard sees a session immediately. */
export let injectOAuthSession: ((session: Session) => void) | null = null;

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  /** False until AsyncStorage onboarding flag has been read (blocks auth redirects). */
  onboardingReady: boolean;
  /** True after the user has completed or skipped the intro carousel (native only). */
  onboardingSeen: boolean;
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
  /** Persist onboarding seen and update in-memory gate (call before leaving onboarding). */
  completeOnboarding: () => Promise<void>;
  /** Dev: clear onboarding flag in storage + memory so onboarding can be shown again. */
  resetOnboardingForDev: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function syncProfileIntoStore(userId?: string, accessToken?: string): Promise<void> {
  const p = await fetchMyProfile(userId, accessToken);
  const { setDisplayName, setPreferredLogPlatform, syncGhinFromProfileIfChanged } = useAppStore.getState();
  applyProfileRowToStore(p, { setDisplayName, setPreferredLogPlatform, syncGhinFromProfileIfChanged });
}

/**
 * Load rounds / profile / groups for a signed-in user.
 * Always pass JWT when available so we never call `auth.getUser()` / `getSession()`
 * under gotrue's navigator lock (that deadlocks web splash after lock-steal recovery).
 */
async function hydrateSignedInUserData(
  userId: string,
  accessToken: string | undefined,
  isCancelled?: () => boolean
): Promise<void> {
  const token = googleOAuthAccessToken ?? accessToken;
  const remoteRounds = await fetchMyRoundsForUser(userId, token);
  if (isCancelled?.()) return;
  if (remoteRounds !== null) {
    useAppStore.getState().replaceRoundsFromRemote(remoteRounds);
  }
  await syncProfileIntoStore(userId, token);
  if (isCancelled?.()) return;
  // Prefer the session JWT; only fall back to getSession outside the auth-lock callback.
  const groupsToken =
    token ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
  if (isCancelled?.()) return;
  await fetchMySocialGroupsIntoStore(userId, groupsToken);
  if (isCancelled?.()) return;
  await backfillGroupCreatorsInStore(groupsToken);
  if (isCancelled?.()) return;
  await fetchInboundGroupInvitesIntoStore(userId, groupsToken);
  if (isCancelled?.()) return;
  useAppStore.getState().recomputeGroupsFromYou();
}

/** Expo Router may omit route groups from segments; pathname is usually `/sign-in`, `/sign-up`. */
function isAuthRoute(segments: string[], pathname: string): boolean {
  if (segments.includes('onboarding') || pathname.includes('/onboarding')) return true;
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
  if (p.includes('/auth/callback')) return true;
  if (p.includes('complete-oauth-profile')) return true;
  return false;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(configured);
  const [session, setSession] = useState<Session | null>(null);
  const [onboardingReady, setOnboardingReady] = useState(false);
  const [onboardingSeen, setOnboardingSeenState] = useState(false);
  const router = useRouter();
  const segments = useSegments();
  const pathname = usePathname();
  const navReady = useRootNavigationState()?.key != null;
  const profileDisplayName = useAppStore((s) => s.displayName);
  const hydrated = useAppStore((s) => s.hydrated);
  const needsOauthDisplayName =
    !!session?.user &&
    hydrated &&
    shouldPromptOauthDisplayName(session.user, profileDisplayName);

  const hasRedirectedToCompleteOauth = useRef(false);
  const signOutRedirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSessionRef = useRef<Session | null>(null);

  useEffect(() => {
    hasRedirectedToCompleteOauth.current = false;
  }, [session]);

  useEffect(() => {
    injectOAuthSession = (newSession) => {
      setSession(newSession);
    };
    return () => {
      injectOAuthSession = null;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      setOnboardingSeenState(true);
      setOnboardingReady(true);
      return;
    }
    let cancelled = false;
    void getOnboardingSeen().then((seen) => {
      if (!cancelled) {
        setOnboardingSeenState(seen);
        setOnboardingReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      if (Platform.OS === 'web') void useAppStore.persist.rehydrate();
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;

    (async () => {
      const { data } = await supabase!.auth.getSession();
      if (cancelled) return;
      await rebindPersistToUser(data.session?.user.id ?? null);
      if (cancelled) return;
      // Unblock splash as soon as we know the session — do not wait on remote hydrate.
      setSession(data.session);
      setLoading(false);
      if (data.session?.user) {
        void hydrateSignedInUserData(
          data.session.user.id,
          data.session.access_token,
          isCancelled
        );
      }
    })();

    const {
      data: { subscription },
    } = supabase!.auth.onAuthStateChange((event, next) => {
      // CRITICAL: do not await supabase.auth.* (or helpers that call getUser/getSession)
      // inside this callback. gotrue holds the auth lock and awaits subscribers — nesting
      // another lock-taking call deadlocks web init (splash forever after lock-steal warning).
      // https://supabase.com/docs/guides/troubleshooting/why-is-my-supabase-api-call-not-returning-PGzXw0
      setSession((prev) => {
        if (!next) return null;
        if (
          prev?.user?.id === next.user?.id &&
          prev?.access_token === next.access_token &&
          prev?.expires_at === next.expires_at
        ) {
          return prev;
        }
        return next;
      });

      const userId = next?.user?.id;
      const accessToken = next?.access_token;
      const syncProfile =
        event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED';

      // Defer all awaits off the lock callback stack.
      setTimeout(() => {
        if (cancelled) return;
        void (async () => {
          await rebindPersistToUser(userId ?? null);
          if (cancelled) return;
          if (syncProfile && userId) {
            await hydrateSignedInUserData(userId, accessToken, isCancelled);
          } else if (!userId) {
            useAppStore.getState().setInboundGroupInvites([]);
          }
        })();
      }, 0);
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
    const detach = attachSocialGroupsRealtimeSync(s.access_token, s.user.id);
    return detach;
  }, [configured, session?.user?.id, session?.access_token]);

  useEffect(() => {
    if (!navReady || !onboardingReady) return;
    if (configured && loading) return;
    const inAuth = isAuthRoute(segments, pathname);
    if (inAuth) {
      if (signOutRedirectTimer.current) {
        clearTimeout(signOutRedirectTimer.current);
        signOutRedirectTimer.current = null;
      }
    }
    const p = pathname.replace(/\/$/, '') || '/';
    const onPasswordReset = p.includes('reset-password');
    const onOAuthCallback = p.includes('/auth/callback');
    const segs = segments as readonly string[];
    const onCompleteOauth =
      p.includes('complete-oauth-profile') || segs.includes('complete-oauth-profile');
    const onOnboarding = segs.includes('onboarding') || p.includes('/onboarding');
    const hadSession = prevSessionRef.current != null;

    if (!session && !inAuth && !onOAuthCallback) {
      if (signOutRedirectTimer.current) return;
      const target = !onboardingSeen ? '/(auth)/onboarding' : '/(auth)/sign-in';
      const runRedirect = () => {
        signOutRedirectTimer.current = null;
        useAppStore.getState().setDisplayName('');
        router.replace(target as Href);
      };
      if (hadSession) {
        signOutRedirectTimer.current = setTimeout(runRedirect, 300);
      } else {
        runRedirect();
      }
    } else if (!session && onboardingSeen && onOnboarding) {
      router.replace('/(auth)/sign-in');
    } else if (!session && onCompleteOauth) {
      router.replace('/(auth)/sign-in');
    } else if (
      session &&
      needsOauthDisplayName &&
      !onCompleteOauth &&
      !inAuth &&
      !hasRedirectedToCompleteOauth.current
    ) {
      hasRedirectedToCompleteOauth.current = true;
      router.replace('/(auth)/complete-oauth-profile' as Href);
    } else if (session && inAuth && !onPasswordReset) {
      if (!needsOauthDisplayName && !onOAuthCallback && (onboardingSeen || !onOnboarding)) {
        router.replace('/');
      }
    }

    prevSessionRef.current = session;

    return () => {
      if (signOutRedirectTimer.current) clearTimeout(signOutRedirectTimer.current);
    };
  }, [
    configured,
    loading,
    session,
    segments,
    pathname,
    navReady,
    router,
    onboardingReady,
    onboardingSeen,
    needsOauthDisplayName,
    hydrated,
  ]);

  const completeOnboarding = useCallback(async () => {
    await setOnboardingSeen();
    setOnboardingSeenState(true);
  }, []);

  const resetOnboardingForDev = useCallback(async () => {
    await clearOnboardingSeen();
    setOnboardingSeenState(false);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: 'Supabase is not configured' };
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return error ? { error: mapEmailPasswordSignInError(error) } : {};
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
    const userId = session?.user?.id;
    const wipeLocalSessionArtifacts = async () => {
      clearGoogleOAuthAccessToken();
      try {
        await AsyncStorage.removeItem('supabase.auth.token');
      } catch {
        /* ignore */
      }
      if (userId) {
        try {
          await AsyncStorage.removeItem(`simhandicap-u-${userId}`);
        } catch {
          /* ignore */
        }
      }
      try {
        await AsyncStorage.removeItem('simhandicap-guest');
      } catch {
        /* ignore */
      }
    };

    if (!supabase) {
      await wipeLocalSessionArtifacts();
      return;
    }
    const SIGN_OUT_MS = 20000;
    try {
      await Promise.race([
        supabase.auth.signOut(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`signOut timed out after ${SIGN_OUT_MS}ms`)), SIGN_OUT_MS)
        ),
      ]);
    } catch {
      /** Unblock a wedged client: clear local session even if the server round-trip never completes. */
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        /* ignore */
      }
    }
    await wipeLocalSessionArtifacts();
  }, [session]);

  const refreshProfile = useCallback(async () => {
    if (!configured || !session) return;
    await hydrateSignedInUserData(
      session.user.id,
      googleOAuthAccessToken ?? session.access_token
    );
  }, [configured, session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured,
      loading,
      onboardingReady,
      onboardingSeen,
      session,
      user: session?.user ?? null,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      completeOnboarding,
      resetOnboardingForDev,
    }),
    [
      configured,
      loading,
      onboardingReady,
      onboardingSeen,
      session,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      completeOnboarding,
      resetOnboardingForDev,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
