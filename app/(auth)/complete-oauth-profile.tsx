import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useRouter, type Href } from 'expo-router';
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
import { showAppAlert } from '@/src/lib/alertCompat';
import { colors } from '@/src/lib/constants';
import { useAppStore } from '@/src/store/useAppStore';

export default function CompleteOauthProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    const dn = displayName.trim();
    if (!dn) {
      showAppAlert('Display name', 'Enter how you want to appear in SimCap.');
      return;
    }
    const raw = await AsyncStorage.getItem('supabase.auth.token');
    const storedSession = raw ? (JSON.parse(raw) as { access_token?: string; user?: { id?: string } }) : null;
    const accessToken = storedSession?.access_token;
    const userId = storedSession?.user?.id;
    if (!accessToken || !userId) {
      showAppAlert('Session', 'You are not signed in.');
      return;
    }
    setBusy(true);
    const extra = Constants.expoConfig?.extra as
      | { supabaseUrl?: string; supabaseAnonKey?: string; supabasePublishableKey?: string }
      | undefined;
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra?.supabaseUrl ?? '';
    const supabaseAnonKey =
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_KEY ??
      extra?.supabaseAnonKey ??
      extra?.supabasePublishableKey ??
      '';

    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ display_name: dn }),
    });
    if (!res.ok) {
      setBusy(false);
      let msg = res.statusText;
      try {
        const body = await res.text();
        if (body) msg = body;
      } catch {
        /* ignore */
      }
      showAppAlert('Could not save', msg);
      return;
    }
    useAppStore.getState().setDisplayName(dn);
    setBusy(false);
    router.replace('/(tabs)' as Href);
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
