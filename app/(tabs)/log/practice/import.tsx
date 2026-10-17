import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../../src/auth/AuthContext';
import { ContentWidth } from '../../../../src/components/ContentWidth';
import i18n, { useTranslation } from '../../../../src/i18n';
import { colors } from '../../../../src/lib/constants';
import { PRACTICE_ANALYZER_ENABLED } from '../../../../src/lib/featureFlags';
import { googleOAuthAccessToken } from '../../../../src/lib/googleOAuthAccessToken';
import {
  fetchPracticeAnalysis,
  fetchPracticeImportCode,
  generatePracticeImportCode,
  subscribePracticeImport,
} from '../../../../src/lib/practiceAnalysis';
import { useResponsive } from '../../../../src/lib/responsive';
import { isSupabaseConfigured } from '../../../../src/lib/supabase';

type Phase = 'generating' | 'waiting' | 'received' | 'expired' | 'error';

function formatCode(code: string): string {
  const digits = code.replace(/\D/g, '').padStart(6, '0').slice(0, 6);
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}

function remainingLabel(expiresAt: string, nowMs: number): string {
  const ms = new Date(expiresAt).getTime() - nowMs;
  if (ms <= 0) return i18n.t('log.practice.import.expired');
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return i18n.t('log.practice.import.timeLeft', {
    min,
    sec: String(sec).padStart(2, '0'),
  });
}

export default function PracticeImportScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user } = useAuth();
  const supabaseOn = isSupabaseConfigured();
  const token = googleOAuthAccessToken ?? undefined;

  const [phase, setPhase] = useState<Phase>('generating');
  const [code, setCode] = useState<string | null>(null);
  const [codeId, setCodeId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const navigatingRef = useRef(false);

  const generate = useCallback(async () => {
    navigatingRef.current = false;
    setPhase('generating');
    setError(null);
    setCode(null);
    setCodeId(null);
    setExpiresAt(null);
    const res = await generatePracticeImportCode(token);
    if (!res.success) {
      setError(res.error);
      setPhase('error');
      return;
    }
    setCode(res.code);
    setCodeId(res.codeId);
    setExpiresAt(res.expiresAt);
    setPhase('waiting');
  }, [token]);

  useEffect(() => {
    void generate();
  }, [generate]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (phase !== 'waiting' || !expiresAt) return;
    if (new Date(expiresAt).getTime() <= nowMs) {
      setPhase('expired');
    }
  }, [phase, expiresAt, nowMs]);

  const checkStatus = useCallback(async () => {
    if (!codeId || navigatingRef.current) return;
    const res = await fetchPracticeImportCode(codeId, token);
    if (res.error || !res.data) return;
    if (res.data.status === 'expired') {
      setPhase('expired');
      return;
    }
    if (res.data.status !== 'consumed' || !res.data.analysis_id) return;
    setPhase('received');
    const analysisId = res.data.analysis_id;
    const analysis = await fetchPracticeAnalysis(analysisId, token);
    if (analysis.data?.status === 'failed') {
      setError(
        analysis.data.error_message ?? t('log.practice.import.analysisFailed')
      );
      setPhase('error');
      return;
    }
    if (analysis.data && analysis.data.status !== 'processing') {
      navigatingRef.current = true;
      router.replace(`/(tabs)/log/practice/${analysisId}` as never);
    }
  }, [codeId, token, router, t]);

  useEffect(() => {
    if ((phase !== 'waiting' && phase !== 'received') || !codeId || !user?.id) return;
    const unsub = subscribePracticeImport({
      userId: user.id,
      codeId,
      accessToken: token,
      onChange: () => {
        void checkStatus();
      },
    });
    const poll = setInterval(() => {
      void checkStatus();
    }, 2500);
    void checkStatus();
    return () => {
      unsub();
      clearInterval(poll);
    };
  }, [phase, codeId, user?.id, token, checkStatus]);

  if (!PRACTICE_ANALYZER_ENABLED) {
    return <Redirect href={'/(tabs)/log/round' as never} />;
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
        {phase === 'generating' ? (
          <View style={styles.card}>
            <ActivityIndicator color={colors.header} />
            <Text style={styles.loadingTxt}>{t('log.practice.import.generating')}</Text>
          </View>
        ) : null}

        {phase === 'waiting' || phase === 'received' ? (
          <View style={styles.card}>
            <Text style={styles.eyebrow}>{t('log.practice.import.eyebrow')}</Text>
            <Text
              style={styles.code}
              accessibilityLabel={t('log.practice.import.codeA11y', { code: code ?? '' })}
            >
              {code ? formatCode(code) : t('log.practice.import.codePlaceholder')}
            </Text>
            {expiresAt && phase === 'waiting' ? (
              <Text style={styles.timer}>{remainingLabel(expiresAt, nowMs)}</Text>
            ) : null}
            <Text style={styles.instructions}>{t('log.practice.import.instructions')}</Text>
            <View style={styles.waitRow}>
              <ActivityIndicator color={colors.header} />
              <Text style={styles.waitTxt}>
                {phase === 'received'
                  ? t('log.practice.import.analyzing')
                  : t('log.practice.import.waiting')}
              </Text>
            </View>
          </View>
        ) : null}

        {phase === 'expired' ? (
          <View style={styles.card}>
            <Text style={styles.eyebrow}>{t('log.practice.import.codeExpired')}</Text>
            <Text style={[styles.code, styles.codeExpired]}>
              {code ? formatCode(code) : t('log.practice.import.codePlaceholder')}
            </Text>
            <Text style={styles.instructions}>{t('log.practice.import.expiredBody')}</Text>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              onPress={() => void generate()}
            >
              <Text style={styles.primaryBtnTxt}>{t('log.practice.import.generateNew')}</Text>
            </Pressable>
          </View>
        ) : null}

        {phase === 'error' ? (
          <View style={styles.card}>
            <Text style={styles.errTitle}>{t('log.practice.import.errorTitle')}</Text>
            <Text style={styles.instructions}>{error ?? t('common.somethingWentWrong')}</Text>
            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              onPress={() => void generate()}
            >
              <Text style={styles.primaryBtnTxt}>{t('log.practice.import.tryAgain')}</Text>
            </Pressable>
          </View>
        ) : null}

        {!supabaseOn ? <Text style={styles.muted}>{t('matchChat.notConfigured')}</Text> : null}
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0, width: '100%' },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 20,
    alignItems: 'center',
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  code: {
    marginTop: 12,
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 4,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  codeExpired: { color: colors.subtle },
  timer: { marginTop: 6, fontSize: 13, fontWeight: '600', color: colors.accent },
  instructions: {
    marginTop: 16,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 21,
    textAlign: 'center',
  },
  waitRow: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  waitTxt: { fontSize: 14, fontWeight: '600', color: colors.ink },
  loadingTxt: { marginTop: 12, fontSize: 15, fontWeight: '700', color: colors.ink },
  errTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  muted: { marginTop: 16, fontSize: 13, color: colors.muted, textAlign: 'center' },
  primaryBtn: {
    marginTop: 18,
    alignSelf: 'stretch',
    backgroundColor: colors.header,
    borderRadius: 10,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.9 },
});
