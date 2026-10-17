import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { OAuthSignInButtons } from '@/src/components/OAuthSignInButtons';
import { useTranslation } from '@/src/i18n';
import { showAppAlert } from '@/src/lib/alertCompat';
import { colors } from '@/src/lib/constants';
import { REFERRAL_CODE_FIELD_ENABLED } from '@/src/lib/featureFlags';
import {
  getPendingReferralCode,
  normalizeReferralCode,
  setPendingReferralCode,
} from '@/src/lib/pendingReferralCode';

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default function SignUpScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ ref?: string | string[]; referral?: string | string[] }>();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [busy, setBusy] = useState(false);

  // Prefill from deep-link ?ref= / pending stash so OAuth (and the visible field) see the code.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fromParams = normalizeReferralCode(
        firstParam(params.ref) ?? firstParam(params.referral)
      );
      if (fromParams) {
        await setPendingReferralCode(fromParams);
        if (!cancelled) setReferralCode(fromParams);
        return;
      }
      const pending = await getPendingReferralCode();
      if (!cancelled && pending) setReferralCode(pending);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.ref, params.referral]);

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      showAppAlert(t('auth.signUp.alertTitle'), t('auth.signUp.enterEmailPassword'));
      return;
    }
    if (password.length < 6) {
      showAppAlert(t('auth.signUp.alertTitle'), t('common.passwordMinLength'));
      return;
    }
    setBusy(true);
    const { error, sessionCreated } = await signUp(email, password, displayName, referralCode);
    setBusy(false);
    if (error) {
      showAppAlert(t('auth.signUp.alertTitle'), error);
      return;
    }
    if (sessionCreated) {
      router.replace('/');
      return;
    }
    showAppAlert(t('auth.signUp.checkEmailTitle'), t('auth.signUp.checkEmailBody'), {
      onOk: () => router.replace('/(auth)/sign-in'),
    });
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
          <Text style={styles.contextTxt}>{t('auth.signUp.context')}</Text>
        </View>

        {/* Shared above OAuth + email so a typed (or deep-linked) code is present when OAuth is tapped. */}
        {REFERRAL_CODE_FIELD_ENABLED && (
          <>
            <Text style={styles.lbl}>{t('auth.signUp.referralCode')}</Text>
            <TextInput
              style={styles.input}
              value={referralCode}
              onChangeText={setReferralCode}
              placeholder={t('auth.signUp.referralPlaceholder')}
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </>
        )}

        <OAuthSignInButtons
          dividerLabel={t('auth.signUp.orCreateWithEmail')}
          referralCode={referralCode}
        />

        <Text style={styles.lbl}>{t('auth.signUp.displayName')}</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={t('auth.signUp.displayNamePlaceholder')}
          placeholderTextColor={colors.subtle}
          autoCorrect
        />

        <Text style={styles.lbl}>{t('common.email')}</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder={t('common.emailPlaceholder')}
          placeholderTextColor={colors.subtle}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
        />

        <Text style={styles.lbl}>{t('common.password')}</Text>
        <TextInput
          style={styles.inputTightBottom}
          value={password}
          onChangeText={setPassword}
          placeholder={t('common.passwordMinPlaceholder')}
          placeholderTextColor={colors.subtle}
          secureTextEntry
          textContentType="newPassword"
        />
        <Text style={styles.passwordNote}>{t('auth.signUp.passwordNote')}</Text>

        <Pressable
          onPress={onSubmit}
          disabled={busy}
          style={[styles.primary, busy && styles.primaryDisabled]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryTxt}>{t('common.createAccount')}</Text>
          )}
        </Pressable>

        <View style={styles.footer}>
          <Text style={styles.footerLine}>{t('auth.signUp.alreadyHaveAccount')}</Text>
          <Link href="/(auth)/sign-in" asChild>
            <Pressable style={styles.footerLink}>
              <Text style={styles.footerLinkTxt}>{t('auth.signUp.signInLink')}</Text>
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
