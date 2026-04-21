import * as Linking from 'expo-linking';
import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/auth/AuthContext';
import { AuthBrandBanner } from '@/src/components/AuthBrandBanner';
import { colors } from '@/src/lib/constants';
import { supabase } from '@/src/lib/supabase';

type LinkPhase = 'pending' | 'ready' | 'error';

/** Parse Supabase recovery tokens from `simcap://reset-password#...` or query string. */
function parseAuthTokensFromUrl(url: string): { access_token: string; refresh_token: string } | null {
  const hashIdx = url.indexOf('#');
  const hash = hashIdx >= 0 ? url.slice(hashIdx + 1) : '';
  const qIdx = url.indexOf('?');
  const queryOnly =
    qIdx >= 0 && (hashIdx < 0 || qIdx < hashIdx) ? url.slice(qIdx + 1).split('#')[0] : '';
  const params = new URLSearchParams(hash || queryOnly);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();
  const [linkPhase, setLinkPhase] = useState<LinkPhase>('pending');
  const [linkError, setLinkError] = useState<string | null>(null);
  const sessionFromLinkRef = useRef(false);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const applyRecoveryUrl = useCallback(async (url: string) => {
    if (!supabase) {
      setLinkError('Sign-in is not available (missing configuration).');
      setLinkPhase('error');
      return;
    }
    if (sessionFromLinkRef.current) return;
    const tokens = parseAuthTokensFromUrl(url);
    if (!tokens) return;

    sessionFromLinkRef.current = true;
    const { error } = await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    if (error) {
      sessionFromLinkRef.current = false;
      setLinkError(error.message);
      setLinkPhase('error');
      return;
    }
    setLinkPhase('ready');
  }, []);

  useEffect(() => {
    let alive = true;
    const tryConsume = async (url: string | null) => {
      if (!alive || !url) return;
      await applyRecoveryUrl(url);
    };

    void (async () => {
      const initial = await Linking.getInitialURL();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const href = window.location.href;
        if (href.includes('access_token=') && href.includes('refresh_token=')) {
          await tryConsume(href);
        } else if (initial) {
          await tryConsume(initial);
        }
      } else if (initial) {
        await tryConsume(initial);
      }
    })();

    const sub = Linking.addEventListener('url', ({ url }) => {
      void tryConsume(url);
    });

    const timeout = setTimeout(() => {
      if (!alive || sessionFromLinkRef.current) return;
      setLinkError('This reset link is invalid or expired. Request a new one from sign-in.');
      setLinkPhase('error');
    }, 15000);

    return () => {
      alive = false;
      clearTimeout(timeout);
      sub.remove();
    };
  }, [applyRecoveryUrl]);

  const onSubmit = async () => {
    setFormError(null);
    if (!supabase) {
      setFormError('Sign-in is not available (missing configuration).');
      return;
    }
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setFormError('Passwords do not match.');
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setSuccess(true);
    await signOut();
    setTimeout(() => {
      router.replace('/(auth)/sign-in' as Href);
    }, 1800);
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: Math.max(20, insets.top + 12),
            paddingBottom: insets.bottom + 28,
          },
        ]}
      >
        <AuthBrandBanner variant="signIn" />

        {linkPhase === 'pending' ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator size="large" color={colors.header} />
            <Text style={styles.pendingTxt}>Opening your reset link…</Text>
          </View>
        ) : linkPhase === 'error' ? (
          <View style={styles.centerBlock}>
            <Text style={styles.sectionTitle}>Could not open link</Text>
            <Text style={styles.errorText}>{linkError ?? 'Something went wrong.'}</Text>
          </View>
        ) : success ? (
          <View style={styles.centerBlock}>
            <Text style={styles.successMessage}>Password updated! You can now sign in.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Choose a new password</Text>
            <Text style={styles.subheading}>Enter and confirm your new password below.</Text>

            <Text style={styles.lbl}>New password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (formError) setFormError(null);
              }}
              placeholder="At least 6 characters"
              placeholderTextColor={colors.subtle}
              secureTextEntry
              textContentType="newPassword"
              editable={!busy}
            />

            <Text style={styles.lbl}>Confirm password</Text>
            <TextInput
              style={styles.input}
              value={confirm}
              onChangeText={(t) => {
                setConfirm(t);
                if (formError) setFormError(null);
              }}
              placeholder="Re-enter password"
              placeholderTextColor={colors.subtle}
              secureTextEntry
              textContentType="newPassword"
              editable={!busy}
            />

            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

            <Pressable
              onPress={onSubmit}
              disabled={busy}
              style={[styles.primary, busy && styles.primaryDisabled]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryTxt}>Update password</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, maxWidth: 480, width: '100%', alignSelf: 'center' },
  centerBlock: { marginTop: 24, alignItems: 'center', gap: 16 },
  pendingTxt: { fontSize: 16, fontWeight: '600', color: colors.subtle, textAlign: 'center' },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 4,
    marginBottom: 10,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  subheading: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.subtle,
    lineHeight: 22,
    marginBottom: 22,
  },
  lbl: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.subtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  input: {
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.danger,
    marginBottom: 12,
    lineHeight: 20,
    textAlign: 'center',
  },
  primary: {
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryDisabled: { opacity: 0.7 },
  primaryTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  successMessage: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: 26,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
});
