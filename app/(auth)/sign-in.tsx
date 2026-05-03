import { Link, useRouter, type Href } from 'expo-router';
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
          {
            paddingTop: Math.max(20, insets.top + 12),
            paddingBottom: insets.bottom + 28,
          },
        ]}
      >
        <AuthBrandBanner />

        <View style={styles.signUpPrompt}>
          <Text style={styles.signUpPromptText}>New here? </Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable accessibilityRole="link" hitSlop={8} style={({ pressed }) => [pressed && styles.signUpLinkPressed]}>
              <Text style={styles.signUpLink}>Create an account</Text>
            </Pressable>
          </Link>
        </View>

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

        <View style={styles.forgotRow}>
          <Link href={'/(auth)/forgot-password' as Href} asChild>
            <Pressable accessibilityRole="link" hitSlop={8} style={({ pressed }) => [pressed && styles.forgotLinkPressed]}>
              <Text style={styles.forgotLink}>Forgot password?</Text>
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
  signUpPrompt: {
    marginTop: 20,
    marginBottom: 28,
    paddingVertical: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: '100%',
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
  },
  signUpPromptText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.ink,
    lineHeight: 24,
  },
  signUpLink: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.header,
    textDecorationLine: 'underline',
    lineHeight: 24,
  },
  signUpLinkPressed: { opacity: 0.65 },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 4,
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
  forgotRow: { marginTop: 16, alignItems: 'center' },
  forgotLink: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.header,
    textDecorationLine: 'underline',
  },
  forgotLinkPressed: { opacity: 0.65 },
});
