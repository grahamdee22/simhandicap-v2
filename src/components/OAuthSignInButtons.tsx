import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { showAppAlert } from '@/src/lib/alertCompat';
import { colors } from '@/src/lib/constants';
import { signInWithOAuthProvider } from '@/src/lib/oauthSignIn';

type Props = {
  /** Shown in the divider between OAuth and email/password (e.g. "or use email"). */
  dividerLabel: string;
};

export function OAuthSignInButtons({ dividerLabel }: Props) {
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);

  const run = async (provider: 'apple' | 'google') => {
    setBusy(provider);
    const { error } = await signInWithOAuthProvider(provider);
    setBusy(null);
    if (error) {
      showAppAlert('Sign in', error);
    }
  };

  return (
    <View style={styles.block}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue with Apple"
        disabled={busy !== null}
        onPress={() => void run('apple')}
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
            <Text style={styles.oauthTxt}>Continue with Apple</Text>
          </>
        )}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
        disabled={busy !== null}
        onPress={() => void run('google')}
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
            <Text style={styles.oauthTxt}>Continue with Google</Text>
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
