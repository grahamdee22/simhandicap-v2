import { useRouter } from 'expo-router';
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
import { showAppAlert } from '@/src/lib/alertCompat';
import { colors } from '@/src/lib/constants';
import { upsertMyProfile } from '@/src/lib/profiles';
import { supabase } from '@/src/lib/supabase';

export default function CompleteOauthProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refreshProfile, user } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    const dn = displayName.trim();
    if (!dn) {
      showAppAlert('Display name', 'Enter how you want to appear in SimCap.');
      return;
    }
    if (!user) {
      showAppAlert('Session', 'You are not signed in.');
      return;
    }
    setBusy(true);
    const { error: upErr } = await upsertMyProfile({ display_name: dn });
    if (upErr) {
      setBusy(false);
      showAppAlert('Could not save', upErr);
      return;
    }
    if (supabase) {
      const { error: metaErr } = await supabase.auth.updateUser({
        data: { display_name: dn },
      });
      if (metaErr) {
        setBusy(false);
        showAppAlert('Could not save', metaErr.message);
        return;
      }
    }
    await refreshProfile();
    setBusy(false);
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
          { paddingTop: 24, paddingBottom: insets.bottom + 28 },
        ]}
      >
        <Text style={styles.title}>Choose your display name</Text>
        <Text style={styles.sub}>
          This is how other players see you in matches and groups. You can change it later in settings.
        </Text>

        <Text style={styles.lbl}>Display name</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="e.g. Jordan P."
          placeholderTextColor={colors.subtle}
          autoCorrect
          autoCapitalize="words"
          textContentType="name"
        />

        <Pressable
          onPress={() => void onSubmit()}
          disabled={busy}
          style={[styles.primary, busy && styles.primaryDisabled]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryTxt}>Continue</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: 20, maxWidth: 480, width: '100%', alignSelf: 'center' },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  sub: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.muted,
    marginBottom: 28,
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
    marginBottom: 20,
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
});
