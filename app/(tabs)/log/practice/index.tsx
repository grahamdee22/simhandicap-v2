import { useFocusEffect } from '@react-navigation/native';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../../src/auth/AuthContext';
import { ContentWidth } from '../../../../src/components/ContentWidth';
import { IconCameraOutline, IconImageOutline } from '../../../../src/components/SvgUiIcons';
import { showAppAlert } from '../../../../src/lib/alertCompat';
import { colors } from '../../../../src/lib/constants';
import { PRACTICE_ANALYZER_ENABLED } from '../../../../src/lib/featureFlags';
import { googleOAuthAccessToken } from '../../../../src/lib/googleOAuthAccessToken';
import {
  invokeAnalyzePractice,
  listPracticeAnalyses,
  uploadPracticeAnalysisImage,
  type PracticeAnalysisListItem,
} from '../../../../src/lib/practiceAnalysis';
import { useResponsive } from '../../../../src/lib/responsive';
import { settingsScreenshotPickerOptions } from '../../../../src/lib/settingsScreenshotPicker';
import { isSupabaseConfigured } from '../../../../src/lib/supabase';

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function PracticeAnalyzerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter, isWide } = useResponsive();
  const { user } = useAuth();
  const supabaseOn = isSupabaseConfigured();

  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Analyzing…');
  const [history, setHistory] = useState<PracticeAnalysisListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyErr, setHistoryErr] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!supabaseOn || !user?.id) {
      setHistory([]);
      setHistoryLoading(false);
      setHistoryErr(null);
      return;
    }
    setHistoryLoading(true);
    setHistoryErr(null);
    const res = await listPracticeAnalyses({
      accessToken: googleOAuthAccessToken ?? undefined,
    });
    if (res.error) {
      setHistoryErr(res.error);
      setHistory([]);
    } else {
      setHistory(res.data);
    }
    setHistoryLoading(false);
  }, [supabaseOn, user?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
    }, [loadHistory])
  );

  const runAnalyze = useCallback(
    async (localUri: string) => {
      if (!user?.id) return;
      setBusy(true);
      setBusyLabel('Uploading photo…');
      setPreviewUri(localUri);

      const token = googleOAuthAccessToken ?? undefined;
      const up = await uploadPracticeAnalysisImage({
        userId: user.id,
        localUri,
        accessToken: token,
      });
      if ('error' in up) {
        setBusy(false);
        showAppAlert('Upload failed', up.error);
        return;
      }

      setBusyLabel('Reading your stats…');
      const analyzed = await invokeAnalyzePractice({
        imagePath: up.path,
        imageUrl: up.signedUrl,
        accessToken: token,
      });
      setBusy(false);
      if (!analyzed.success) {
        showAppAlert('Analysis failed', analyzed.error);
        return;
      }

      setPreviewUri(null);
      await loadHistory();
      router.push(`/(tabs)/log/practice/${analyzed.analysisId}` as never);
    },
    [user?.id, loadHistory, router]
  );

  const pick = useCallback(
    async (source: 'camera' | 'library') => {
      if (busy) return;
      if (!supabaseOn) {
        showAppAlert('Unavailable', 'Supabase is not configured for Practice Analyzer.');
        return;
      }
      if (!user?.id) {
        if (Platform.OS === 'web') {
          const go = typeof window !== 'undefined' && window.confirm('Sign in required\n\nSign in to analyze practice screenshots and save history.');
          if (go) router.push('/(auth)/sign-in' as never);
        } else {
          Alert.alert('Sign in required', 'Sign in to analyze practice screenshots and save history.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign in', onPress: () => router.push('/(auth)/sign-in' as never) },
          ]);
        }
        return;
      }

      const pickerOpts = settingsScreenshotPickerOptions();

      if (source === 'camera') {
        if (Platform.OS === 'web') {
          showAppAlert('Camera', 'Use Upload Photo on web, or open the app on your phone to take a photo.');
          return;
        }
        let camPerm = await ImagePicker.getCameraPermissionsAsync();
        if (!camPerm.granted) camPerm = await ImagePicker.requestCameraPermissionsAsync();
        if (!camPerm.granted) {
          showAppAlert('Camera access needed', 'Allow camera access to photograph your practice stats screen.');
          return;
        }
      } else if (Platform.OS !== 'web') {
        let perm = await ImagePicker.getMediaLibraryPermissionsAsync(false);
        if (!perm.granted) perm = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
        if (!perm.granted) {
          showAppAlert('Photos access needed', 'Allow photo library access to upload your practice stats screen.');
          return;
        }
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(pickerOpts)
          : await ImagePicker.launchImageLibraryAsync(pickerOpts);
      if (result.canceled || !result.assets[0]) return;
      await runAnalyze(result.assets[0].uri);
    },
    [busy, supabaseOn, user?.id, router, runAnalyze]
  );

  const onChooseSource = useCallback(() => {
    if (Platform.OS === 'web') {
      void pick('library');
      return;
    }
    Alert.alert('Practice stats photo', 'Take a new photo or upload a screenshot from your sim.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take Photo', onPress: () => void pick('camera') },
      { text: 'Upload Photo', onPress: () => void pick('library') },
    ]);
  }, [pick]);

  if (!PRACTICE_ANALYZER_ENABLED) {
    return <Redirect href={'/(tabs)/log/round' as never} />;
  }

  if (!supabaseOn) {
    return (
      <ContentWidth bg={colors.bg}>
        <View style={[styles.centered, { padding: gutter }]}>
          <Text style={styles.muted}>Supabase is not configured.</Text>
        </View>
      </ContentWidth>
    );
  }

  return (
    <ContentWidth bg={colors.bg}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: 16,
          paddingBottom: insets.bottom + 28,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lead}>
          Photograph or upload your simulator practice/range stats screen. We&apos;ll extract the visible numbers and
          turn them into takeaways and tips — this never affects your SimCap index.
        </Text>

        {!user?.id ? (
          <View style={styles.signInCard}>
            <Text style={styles.signInTitle}>Sign in to analyze practice</Text>
            <Text style={styles.signInSub}>
              Practice Analyzer needs an account so your photos and history stay private to you.
            </Text>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              onPress={() => router.push('/(auth)/sign-in' as never)}
            >
              <Text style={styles.primaryBtnTxt}>Sign in</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={[styles.actionsRow, isWide && styles.actionsRowWide]}>
              <Pressable
                style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed, busy && styles.disabled]}
                onPress={() => void pick('camera')}
                disabled={busy || Platform.OS === 'web'}
                accessibilityRole="button"
                accessibilityLabel="Take photo of practice stats"
              >
                <IconCameraOutline size={20} color={colors.accent} />
                <Text style={styles.actionBtnTxt}>Take Photo</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed, busy && styles.disabled]}
                onPress={() => void pick('library')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Upload practice stats photo"
              >
                <IconImageOutline size={20} color={colors.accent} />
                <Text style={styles.actionBtnTxt}>Upload Photo</Text>
              </Pressable>
            </View>

            {Platform.OS === 'web' ? (
              <Text style={styles.webHint}>On web, use Upload Photo. Camera capture works in the native app.</Text>
            ) : (
              <Pressable onPress={onChooseSource} disabled={busy} hitSlop={8}>
                <Text style={styles.altHint}>Or choose from a single prompt</Text>
              </Pressable>
            )}

            {busy ? (
              <View style={styles.loadingCard}>
                {previewUri ? <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="cover" /> : null}
                <ActivityIndicator color={colors.header} style={{ marginTop: previewUri ? 14 : 0 }} />
                <Text style={styles.loadingTxt}>{busyLabel}</Text>
                <Text style={styles.loadingSub}>This usually takes a few seconds.</Text>
              </View>
            ) : null}
          </>
        )}

        <Text style={styles.sectionTitle}>Recent analyses</Text>
        {!user?.id ? (
          <Text style={styles.empty}>Sign in to see your practice history.</Text>
        ) : historyLoading ? (
          <ActivityIndicator color={colors.header} style={{ marginVertical: 16 }} />
        ) : historyErr ? (
          <Text style={styles.empty}>{historyErr}</Text>
        ) : history.length === 0 ? (
          <Text style={styles.empty}>No practice analyses yet. Upload a stats screen to get started.</Text>
        ) : (
          history.map((row) => (
            <Pressable
              key={row.id}
              style={({ pressed }) => [styles.historyCard, pressed && styles.pressed]}
              onPress={() => router.push(`/(tabs)/log/practice/${row.id}` as never)}
              accessibilityRole="button"
              accessibilityLabel={`Open practice analysis from ${formatWhen(row.created_at)}`}
            >
              <Text style={styles.historyTitle} numberOfLines={1}>
                {row.detected_system?.trim() || 'Practice session'}
              </Text>
              <Text style={styles.historyMeta}>{formatWhen(row.created_at)}</Text>
              {row.takeaways[0] ? (
                <Text style={styles.historySnippet} numberOfLines={2}>
                  {row.takeaways[0]}
                </Text>
              ) : null}
              <Text style={styles.historyHint}>Tap for full analysis</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0, width: '100%' },
  centered: { flex: 1, justifyContent: 'center', minHeight: 200 },
  muted: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 21 },
  lead: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 16 },
  signInCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.accentSoft,
    padding: 16,
    marginBottom: 20,
  },
  signInTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  signInSub: { fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 19, marginBottom: 14 },
  primaryBtn: {
    backgroundColor: colors.header,
    borderRadius: 10,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  actionsRow: { flexDirection: 'column', gap: 10, marginBottom: 8 },
  actionsRowWide: { flexDirection: 'row' },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.sage,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 14,
  },
  actionBtnTxt: { fontSize: 15, fontWeight: '700', color: colors.accent },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.9 },
  webHint: { fontSize: 12, color: colors.subtle, marginBottom: 12, lineHeight: 17 },
  altHint: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.sage,
    marginBottom: 12,
    textAlign: 'center',
  },
  loadingCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 16,
    alignItems: 'center',
    marginBottom: 18,
  },
  preview: {
    width: '100%',
    height: 160,
    borderRadius: 10,
    backgroundColor: colors.border,
  },
  loadingTxt: { marginTop: 12, fontSize: 15, fontWeight: '700', color: colors.ink },
  loadingSub: { marginTop: 4, fontSize: 12, color: colors.muted },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 8,
    marginBottom: 10,
  },
  empty: { fontSize: 14, color: colors.subtle, lineHeight: 20, paddingVertical: 8 },
  historyCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  historyTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  historyMeta: { fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 17 },
  historySnippet: { fontSize: 12, color: colors.subtle, marginTop: 6, lineHeight: 17 },
  historyHint: { fontSize: 11, fontWeight: '600', color: colors.accent, marginTop: 10 },
});
