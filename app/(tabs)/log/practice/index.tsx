import { useFocusEffect } from '@react-navigation/native';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../../src/auth/AuthContext';
import { ContentWidth } from '../../../../src/components/ContentWidth';
import { IconDesktopOutline } from '../../../../src/components/SvgUiIcons';
import { useTranslation } from '../../../../src/i18n';
import { showAppAlert } from '../../../../src/lib/alertCompat';
import { colors } from '../../../../src/lib/constants';
import { PRACTICE_ANALYZER_ENABLED } from '../../../../src/lib/featureFlags';
import { googleOAuthAccessToken } from '../../../../src/lib/googleOAuthAccessToken';
import {
  listPracticeAnalyses,
  type PracticeAnalysisListItem,
} from '../../../../src/lib/practiceAnalysis';
import { useResponsive } from '../../../../src/lib/responsive';
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
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user } = useAuth();
  const supabaseOn = isSupabaseConfigured();

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

  const onImport = useCallback(() => {
    if (!supabaseOn) {
      showAppAlert(t('common.unavailable'), t('log.practice.index.unavailableBody'));
      return;
    }
    if (!user?.id) {
      if (Platform.OS === 'web') {
        const go =
          typeof window !== 'undefined' &&
          window.confirm(
            `${t('log.practice.index.signInRequiredTitle')}\n\n${t('log.practice.index.signInRequiredBody')}`
          );
        if (go) router.push('/(auth)/sign-in' as never);
      } else {
        Alert.alert(
          t('log.practice.index.signInRequiredTitle'),
          t('log.practice.index.signInRequiredBody'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.signIn'), onPress: () => router.push('/(auth)/sign-in' as never) },
          ]
        );
      }
      return;
    }
    router.push('/(tabs)/log/practice/import' as never);
  }, [supabaseOn, user?.id, router, t]);

  if (!PRACTICE_ANALYZER_ENABLED) {
    return <Redirect href={'/(tabs)/log/round' as never} />;
  }

  if (!supabaseOn) {
    return (
      <ContentWidth bg={colors.bg}>
        <View style={[styles.centered, { padding: gutter }]}>
          <Text style={styles.muted}>{t('matchChat.notConfigured')}</Text>
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
        <Text style={styles.lead}>{t('log.practice.index.lead')}</Text>

        {!user?.id ? (
          <View style={styles.signInCard}>
            <Text style={styles.signInTitle}>{t('log.practice.index.signInTitle')}</Text>
            <Text style={styles.signInSub}>{t('log.practice.index.signInSub')}</Text>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              onPress={() => router.push('/(auth)/sign-in' as never)}
            >
              <Text style={styles.primaryBtnTxt}>{t('common.signIn')}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
            onPress={onImport}
            accessibilityRole="button"
            accessibilityLabel={t('log.practice.index.importA11y')}
          >
            <IconDesktopOutline size={20} color={colors.accent} />
            <Text style={styles.actionBtnTxt}>{t('log.practice.index.importBtn')}</Text>
          </Pressable>
        )}

        <Text style={styles.sectionTitle}>{t('log.practice.index.recentSessions')}</Text>
        {!user?.id ? (
          <Text style={styles.empty}>{t('log.practice.index.signInForHistory')}</Text>
        ) : historyLoading ? (
          <ActivityIndicator color={colors.header} style={{ marginVertical: 16 }} />
        ) : historyErr ? (
          <Text style={styles.empty}>{historyErr}</Text>
        ) : history.length === 0 ? (
          <Text style={styles.empty}>{t('log.practice.index.emptyHistory')}</Text>
        ) : (
          history.map((row) => {
            const when = formatWhen(row.session_played_at ?? row.created_at);
            return (
              <Pressable
                key={row.id}
                style={({ pressed }) => [styles.historyCard, pressed && styles.pressed]}
                onPress={() => router.push(`/(tabs)/log/practice/${row.id}` as never)}
                accessibilityRole="button"
                accessibilityLabel={t('log.practice.index.openA11y', { when })}
              >
                <Text style={styles.historyTitle} numberOfLines={1}>
                  {row.detected_system?.trim() || t('log.practice.index.sessionFallback')}
                </Text>
                <Text style={styles.historyMeta}>
                  {when}
                  {row.status === 'processing'
                    ? t('log.practice.index.statusAnalyzing')
                    : row.status === 'failed'
                      ? t('log.practice.index.statusFailed')
                      : ''}
                </Text>
                {row.session_notes ? (
                  <Text style={styles.historySnippet} numberOfLines={2}>
                    {row.session_notes}
                  </Text>
                ) : row.takeaways[0] ? (
                  <Text style={styles.historySnippet} numberOfLines={2}>
                    {row.takeaways[0]}
                  </Text>
                ) : null}
                <Text style={styles.historyHint}>{t('log.practice.index.tapHint')}</Text>
              </Pressable>
            );
          })
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
  actionBtn: {
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
    marginBottom: 16,
  },
  actionBtnTxt: { fontSize: 15, fontWeight: '700', color: colors.accent },
  pressed: { opacity: 0.9 },
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
