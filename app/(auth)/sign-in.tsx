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

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      showAppAlert('Sign in', 'Enter your email and password.');
      return;
    }
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) {
      showAppAlert('Sign in', error);
      return;
    }
    router.replace('/');
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
        <AuthBrandBanner variant="signIn" />

        <Text style={styles.sectionTitle}>Sign in to your account</Text>

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
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.subtle}
          secureTextEntry
          textContentType="password"
        />

        <Pressable
          onPress={onSubmit}
          disabled={busy}
          style={[styles.primary, busy && styles.primaryDisabled]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryTxt}>Sign in</Text>
          )}
        </Pressable>

        <View style={styles.footer}>
          <Text style={styles.footerLine}>New here? Create an account</Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable style={styles.footerCta}>
              <Text style={styles.footerCtaTxt}>Create an account</Text>
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
    marginTop: 20,
    marginBottom: 22,
    letterSpacing: -0.3,
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
  primary: {
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryDisabled: { opacity: 0.7 },
  primaryTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  footer: {
    marginTop: 28,
    alignItems: 'center',
    gap: 12,
  },
  footerLine: {
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 22,
  },
  footerCta: {
    width: '100%',
    maxWidth: 320,
    borderWidth: 2,
    borderColor: colors.sage,
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  footerCtaTxt: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 16,
  },
});
