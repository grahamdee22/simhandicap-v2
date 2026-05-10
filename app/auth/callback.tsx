import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/src/lib/constants';
import {
  parseOAuthCallbackUrl,
  parseOAuthImplicitSessionFromUrl,
} from '@/src/lib/oauthSignIn';
import { fetchMyProfile } from '@/src/lib/profiles';
import { isSupabaseConfigured, supabase } from '@/src/lib/supabase';

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default function AuthOAuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string | string[];
    error?: string | string[];
    error_description?: string | string[];
  }>();
  const [message, setMessage] = useState<string | null>(null);
  /** Session exchange succeeded and we navigated away (or unrecoverable error shown). */
  const finished = useRef(false);
  const inFlight = useRef(false);

  const tryConsumeOAuthUrl = useCallback(
    async (href: string | null) => {
      console.log('[callback] tryConsumeOAuthUrl called with href:', href);
      if (!href || finished.current || inFlight.current) return;
      if (!isSupabaseConfigured() || !supabase) {
        finished.current = true;
        setMessage('Supabase is not configured.');
        return;
      }
      const client = supabase;

      let parsed = parseOAuthCallbackUrl(href);
      const implicit = parseOAuthImplicitSessionFromUrl(href);
      console.log('[callback] parsed:', parsed);
      const paramCode = firstParam(params.code);
      const paramErr = firstParam(params.error);
      const paramErrDesc = firstParam(params.error_description);
      if (!parsed.code && paramCode) {
        parsed = {
          code: paramCode,
          error: parsed.error ?? paramErr ?? null,
          error_description: parsed.error_description ?? paramErrDesc ?? null,
        };
      } else if (!parsed.error && paramErr) {
        parsed = {
          ...parsed,
          error: paramErr ?? null,
          error_description: (paramErrDesc ?? parsed.error_description) ?? null,
        };
      }

      console.log('[callback] final code:', parsed.code, 'error:', parsed.error);

      const oauthError = parsed.error ?? implicit.error;
      const oauthErrorDesc = parsed.error_description ?? implicit.error_description;
      if (oauthError) {
        finished.current = true;
        setMessage(oauthErrorDesc ?? oauthError);
        return;
      }

      if (implicit.access_token && implicit.refresh_token) {
        inFlight.current = true;
        console.log('[callback] calling setSession (implicit)...');
        const { error: sessionErr } = await client.auth.setSession({
          access_token: implicit.access_token,
          refresh_token: implicit.refresh_token,
        });
        console.log('[callback] setSession result - error:', sessionErr);
        inFlight.current = false;

        if (sessionErr) {
          finished.current = true;
          setMessage(sessionErr.message);
          return;
        }

        finished.current = true;
        const profile = await fetchMyProfile();
        if (profile) {
          router.replace('/(tabs)' as Href);
        } else {
          router.replace('/(auth)/onboarding' as Href);
        }
        return;
      }

      if (!parsed.code) {
        return;
      }

      inFlight.current = true;
      console.log('[callback] calling exchangeCodeForSession...');
      const { error: exchangeErr } = await client.auth.exchangeCodeForSession(parsed.code);
      console.log('[callback] exchange result - error:', exchangeErr);
      inFlight.current = false;

      if (exchangeErr) {
        finished.current = true;
        setMessage(exchangeErr.message);
        return;
      }

      finished.current = true;
      const profile = await fetchMyProfile();
      if (profile) {
        router.replace('/(tabs)' as Href);
      } else {
        router.replace('/(auth)/onboarding' as Href);
      }
    },
    [params.code, params.error, params.error_description, router]
  );

  useEffect(() => {
    if (finished.current) return;
    if (!isSupabaseConfigured() || !supabase) {
      finished.current = true;
      setMessage('Supabase is not configured.');
      return;
    }

    let alive = true;

    const runInitial = async () => {
      const paramCode = firstParam(params.code);
      const paramErr = firstParam(params.error);
      const paramErrDesc = firstParam(params.error_description);

      let href: string | null = null;
      if (paramCode) {
        const q = new URLSearchParams();
        q.set('code', paramCode);
        if (paramErr) q.set('error', paramErr);
        if (paramErrDesc) q.set('error_description', paramErrDesc);
        href = `simcap://auth/callback?${q.toString()}`;
      } else if (Platform.OS === 'web' && typeof window !== 'undefined') {
        href = window.location.href;
      } else {
        href = await Linking.getInitialURL();
      }

      if (!alive) return;
      console.log('[callback] runInitial href:', href);
      await tryConsumeOAuthUrl(href);

      if (!alive || finished.current) return;
      const parsed = href ? parseOAuthCallbackUrl(href) : { code: null, error: null, error_description: null };
      const implicit = href ? parseOAuthImplicitSessionFromUrl(href) : null;
      const code = paramCode ?? parsed.code;
      const err = paramErr ?? parsed.error ?? implicit?.error;
      const hasImplicitTokens = !!(implicit?.access_token && implicit?.refresh_token);
      if (href && !code && !err && !hasImplicitTokens) {
        finished.current = true;
        setMessage('Missing authorization code.');
      }
    };

    void runInitial();

    const sub = Linking.addEventListener('url', ({ url }) => {
      console.log('[callback] Linking event url:', url);
      void tryConsumeOAuthUrl(url);
    });

    return () => {
      alive = false;
      sub.remove();
    };
  }, [params.code, params.error, params.error_description, tryConsumeOAuthUrl]);

  return (
    <View style={styles.wrap}>
      {message ? (
        <>
          <Text style={styles.title}>Sign in</Text>
          <Text style={styles.body}>{message}</Text>
          <Pressable onPress={() => router.replace('/(auth)/sign-in')} style={styles.btn}>
            <Text style={styles.btnTxt}>Back to sign in</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.title}>Signing you in…</Text>
          <ActivityIndicator size="large" color={colors.header} style={styles.spinner} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    paddingHorizontal: 24,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 24,
  },
  spinner: { marginTop: 16 },
  btn: {
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
