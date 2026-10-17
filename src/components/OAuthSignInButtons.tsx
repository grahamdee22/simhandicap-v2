import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '@/src/i18n';
import { showAppAlert } from '@/src/lib/alertCompat';
import { colors } from '@/src/lib/constants';
import { signInWithApple, signInWithOAuthProvider } from '@/src/lib/oauthSignIn';
import { setPendingReferralCode } from '@/src/lib/pendingReferralCode';

type Props = {
  /** Shown in the divider between OAuth and email/password (e.g. "or use email"). */
  dividerLabel: string;
  /**
   * Optional referral code from the sign-up screen input. Stashed before OAuth redirect so it
   * can be written to profiles.referral_code after the session is live (OAuth cannot pass
   * signup metadata into handle_new_user the way email signUp does).
   */
  referralCode?: string;
};

export function OAuthSignInButtons({ dividerLabel, referralCode }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);

  const stashReferralThen = async (run: () => Promise<{ error?: string }>) => {
    if (referralCode?.trim()) {
      await setPendingReferralCode(referralCode);
    }
    return run();
  };

  const runApple = async () => {
    setBusy('apple');
    const { error } = await stashReferralThen(() => signInWithApple());
    setBusy(null);
    if (error) {
      showAppAlert(t('auth.oauth.alertTitle'), error);
    }
  };

  const runGoogle = async () => {
    setBusy('google');
    const { error } = await stashReferralThen(() => signInWithOAuthProvider('google'));
    setBusy(null);
    if (error) {
      showAppAlert(t('auth.oauth.alertTitle'), error);
    }
  };

  return (
    <View style={styles.block}>
      {Platform.OS === 'ios' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('auth.oauth.continueWithApple')}
          disabled={busy !== null}
          onPress={() => void runApple()}
          style={({ pressed }) => [
            styles.oauthBtn,
            busy !== null && styles.oauthBtnDisabled,
            pressed && busy === null && styles.oauthBtnPressed,
          ]}
        >
          {busy === 'apple' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="logo-apple" size={22} color="#fff" style={styles.icon} />
              <Text style={styles.oauthTxt}>{t('auth.oauth.continueWithApple')}</Text>
            </>
          )}
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('auth.oauth.continueWithGoogle')}
        disabled={busy !== null}
        onPress={() => void runGoogle()}
        style={({ pressed }) => [
          styles.oauthBtn,
          busy !== null && styles.oauthBtnDisabled,
          pressed && busy === null && styles.oauthBtnPressed,
        ]}
      >
        {busy === 'google' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="logo-google" size={20} color="#fff" style={styles.icon} />
            <Text style={styles.oauthTxt}>{t('auth.oauth.continueWithGoogle')}</Text>
          </>
        )}
      </Pressable>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerTxt}>{dividerLabel}</Text>
        <View style={styles.dividerLine} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { width: '100%' },
  oauthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12,
    width: '100%',
  },
  oauthBtnDisabled: { opacity: 0.7 },
  oauthBtnPressed: { opacity: 0.92 },
  icon: { marginRight: 10 },
  oauthTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.pillBorder,
  },
  dividerTxt: {
    marginHorizontal: 12,
    fontSize: 11,
    fontWeight: '600',
    color: colors.subtle,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
