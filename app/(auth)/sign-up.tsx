import { Link, useRouter } from 'expo-router';
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
import { useAuth } from '@/src/auth/AuthContext';
import { AuthBrandBanner } from '@/src/components/AuthBrandBanner';
import { showAppAlert } from '@/src/lib/alertCompat';
import { colors } from '@/src/lib/constants';

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      showAppAlert('Create account', 'Enter email and password.');
      return;
    }
    if (password.length < 6) {
      showAppAlert('Create account', 'Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    const { error, sessionCreated } = await signUp(email, password, displayName);
    setBusy(false);
    if (error) {
      showAppAlert('Create account', error);
      return;
    }
    if (sessionCreated) {
      router.replace('/');
      return;
    }
    showAppAlert(
      'Check your email',
      'We sent a confirmation link if your project requires email verification. You can sign in once your account is active.',
      { onOk: () => router.replace('/(auth)/sign-in') }
    );
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
          { paddingTop: 16, paddingBottom: insets.bottom + 28 },
        ]}
      >
        <AuthBrandBanner />

        <View style={styles.contextBox}>
          <Text style={styles.contextTxt}>
            SimCap tracks your simulator golf handicap and lets you challenge other players to live head-to-head
            matches. Free, and takes 2 minutes to set up.
          </Text>
        </View>

        <Text style={styles.lbl}>Display name</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="e.g. Jordan P."
          placeholderTextColor={colors.subtle}
          autoCorrect
        />

        <Text style={styles.lbl}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.subtle}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
        />

        <Text style={styles.lbl}>Password</Text>
        <TextInput
          style={styles.inputTightBottom}
          value={password}
          onChangeText={setPassword}
          placeholder="At least 6 characters"
          placeholderTextColor={colors.subtle}
          secureTextEntry
          textContentType="newPassword"
        />
        <Text style={styles.passwordNote}>Use a simple password — just don't make it 1234.</Text>

        <Pressable
          onPress={onSubmit}
          disabled={busy}
          style={[styles.primary, busy && styles.primaryDisabled]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryTxt}>Create account</Text>
          )}
        </Pressable>

        <View style={styles.footer}>
          <Text style={styles.footerLine}>Already have an account?</Text>
          <Link href="/(auth)/sign-in" asChild>
            <Pressable style={styles.footerLink}>
              <Text style={styles.footerLinkTxt}>Sign in</Text>
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
  contextBox: {
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginTop: 18,
    marginBottom: 22,
    borderLeftWidth: 4,
    borderLeftColor: colors.sage,
  },
  contextTxt: {
    fontSize: 15,
    lineHeight: 23,
    color: colors.ink,
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
  inputTightBottom: {
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 10,
  },
  passwordNote: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
    fontStyle: 'italic',
    marginBottom: 18,
  },
  primary: {
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryDisabled: { opacity: 0.7 },
  primaryTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  footer: {
    marginTop: 26,
    alignItems: 'center',
    gap: 10,
  },
  footerLine: {
    fontSize: 15,
    color: colors.muted,
  },
  footerLink: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  footerLinkTxt: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 16,
    textDecorationLine: 'underline',
  },
});
