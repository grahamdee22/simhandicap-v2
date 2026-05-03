import { Link } from 'expo-router';
import { useState } from 'react';
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
import { AuthBrandBanner } from '@/src/components/AuthBrandBanner';
import { colors } from '@/src/lib/constants';
import { supabase } from '@/src/lib/supabase';

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSendReset = async () => {
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Enter your email.');
      return;
    }
    if (!supabase) {
      setError('Sign-in is not available (missing configuration).');
      return;
    }
    setBusy(true);
    // Supabase Dashboard → Auth → URL configuration: allow `https://app.sim-cap.com/reset-password` in Redirect URLs; set the same in the reset email template.
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: 'https://app.sim-cap.com/reset-password',
    });
    setBusy(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setSuccess(true);
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
        <AuthBrandBanner />

        {success ? (
          <View style={styles.successBlock}>
            <Text style={styles.successMessage}>Check your email — a reset link is on its way.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Reset your password</Text>
            <Text style={styles.subheading}>{"Enter your email and we'll send you a reset link"}</Text>

            <Text style={styles.lbl}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                if (error) setError(null);
              }}
              placeholder="you@example.com"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!busy}
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              onPress={onSendReset}
              disabled={busy}
              style={[styles.primary, busy && styles.primaryDisabled]}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryTxt}>Send reset link</Text>
              )}
            </Pressable>
          </>
        )}

        <View style={styles.backRow}>
          <Link href="/(auth)/sign-in" asChild>
            <Pressable accessibilityRole="link" hitSlop={8} style={({ pressed }) => [pressed && styles.backLinkPressed]}>
              <Text style={styles.backLink}>Back to sign in</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, maxWidth: 480, width: '100%', alignSelf: 'center' },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 4,
    marginBottom: 10,
    letterSpacing: -0.3,
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
  successBlock: { marginTop: 4 },
  successMessage: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  backRow: { marginTop: 28, alignItems: 'center' },
  backLink: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.header,
    textDecorationLine: 'underline',
  },
  backLinkPressed: { opacity: 0.65 },
});
