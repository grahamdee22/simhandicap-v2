import { useFocusEffect } from '@react-navigation/native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentWidth } from '../../../../src/components/ContentWidth';
import { confirmDestructive, showAppAlert } from '../../../../src/lib/alertCompat';
import { colors } from '../../../../src/lib/constants';
import { PRACTICE_ANALYZER_ENABLED } from '../../../../src/lib/featureFlags';
import { googleOAuthAccessToken } from '../../../../src/lib/googleOAuthAccessToken';
import {
  deletePracticeAnalysis,
  fetchPracticeAnalysis,
  formatMetricValue,
  mapPracticeAnalysisRow,
  metricLabel,
  type MappedPracticeAnalysis,
} from '../../../../src/lib/practiceAnalysis';
import { MIN_SHOTS_FOR_TAKEAWAY, type ClubSummary } from '../../../../src/lib/practiceCsv';
import { useResponsive } from '../../../../src/lib/responsive';
import { isSupabaseConfigured } from '../../../../src/lib/supabase';

const PRIMARY_METRICS = ['carry', 'total_distance', 'offline', 'ball_speed', 'club_speed', 'smash_factor'] as const;
const SECONDARY_METRICS = ['hla', 'vla', 'descent', 'peak_height', 'back_spin', 'side_spin', 'path', 'aoa', 'face_to_target', 'face_to_path'] as const;

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

function StatTile({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLbl} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.statVal} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function ClubCard({ club, tileFlex }: { club: ClubSummary; tileFlex: { flexBasis: `${number}%`; maxWidth: `${number}%` } }) {
  const metricsToShow = [...PRIMARY_METRICS, ...SECONDARY_METRICS].filter((key) => club.metrics[key]);
  return (
    <View style={styles.clubCard}>
      <View style={styles.clubHead}>
        <Text style={styles.clubTitle}>{club.club_label}</Text>
        <Text style={styles.clubCount}>
          {club.shot_count} shot{club.shot_count === 1 ? '' : 's'}
        </Text>
      </View>
      <View style={styles.statsWrap}>
        {metricsToShow.map((key) => {
          const stats = club.metrics[key];
          if (!stats) return null;
          const withStdev = key === 'carry' || key === 'offline';
          return (
            <View key={key} style={[styles.statWrap, tileFlex]}>
              <StatTile
                label={withStdev ? `${metricLabel(key)} ±` : metricLabel(key)}
                value={formatMetricValue(stats, { withStdev })}
              />
            </View>
          );
        })}
      </View>
      {club.qualifies_for_takeaway && club.takeaway ? (
        <Text style={styles.clubTakeaway}>{club.takeaway}</Text>
      ) : !club.qualifies_for_takeaway ? (
        <Text style={styles.clubSkip}>
          Stats only — {MIN_SHOTS_FOR_TAKEAWAY}+ shots of this club needed for a takeaway.
        </Text>
      ) : null}
    </View>
  );
}

export default function PracticeAnalysisDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const analysisId = typeof rawId === 'string' ? rawId : rawId?.[0] ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter, isWide, isVeryWide } = useResponsive();
  const supabaseOn = isSupabaseConfigured();
  const token = googleOAuthAccessToken ?? undefined;

  const [detail, setDetail] = useState<MappedPracticeAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!analysisId || !supabaseOn) {
      setLoading(false);
      setErr(!supabaseOn ? 'Supabase is not configured.' : 'Missing analysis.');
      return;
    }
    if (!silent) setLoading(true);
    setErr(null);
    const res = await fetchPracticeAnalysis(analysisId, token);
    if (res.error || !res.data) {
      setErr(res.error ?? 'Could not load analysis.');
      setDetail(null);
      setLoading(false);
      return;
    }
    setDetail(mapPracticeAnalysisRow(res.data));
    setLoading(false);
  }, [analysisId, supabaseOn, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    if (detail?.status !== 'processing') return;
    const t = setInterval(() => {
      void load(true);
    }, 2000);
    return () => clearInterval(t);
  }, [detail?.status, load]);

  const tileFlex = useMemo(() => {
    if (isVeryWide) return { flexBasis: '23%' as const, maxWidth: '24%' as const };
    if (isWide) return { flexBasis: '30%' as const, maxWidth: '32%' as const };
    return { flexBasis: '47%' as const, maxWidth: '48%' as const };
  }, [isWide, isVeryWide]);

  const onDelete = useCallback(async () => {
    if (!detail || deleting) return;
    const ok = await confirmDestructive(
      'Delete session?',
      'This removes the saved insights and the uploaded CSV. It does not affect your SimCap index.',
      'Delete'
    );
    if (!ok) return;
    setDeleting(true);
    const res = await deletePracticeAnalysis(detail.id, token);
    setDeleting(false);
    if (res.error) {
      showAppAlert('Could not delete', res.error);
      return;
    }
    router.replace('/(tabs)/log/practice' as never);
  }, [detail, deleting, token, router]);

  if (!PRACTICE_ANALYZER_ENABLED) {
    return <Redirect href={'/(tabs)/log/round' as never} />;
  }

  if (loading) {
    return (
      <ContentWidth bg={colors.bg}>
        <View style={[styles.centered, { padding: gutter }]}>
          <ActivityIndicator color={colors.header} />
        </View>
      </ContentWidth>
    );
  }

  if (err || !detail) {
    return (
      <ContentWidth bg={colors.bg}>
        <View style={[styles.centered, { padding: gutter }]}>
          <Text style={styles.muted}>{err ?? 'Analysis not found.'}</Text>
          <Pressable
            style={[styles.secondaryBtn, { marginTop: 16 }]}
            onPress={() => router.replace('/(tabs)/log/practice' as never)}
          >
            <Text style={styles.secondaryBtnTxt}>Back to Practice Analyzer</Text>
          </Pressable>
        </View>
      </ContentWidth>
    );
  }

  if (detail.status === 'processing') {
    return (
      <ContentWidth bg={colors.bg}>
        <View style={[styles.centered, { padding: gutter }]}>
          <ActivityIndicator color={colors.header} />
          <Text style={[styles.muted, { marginTop: 12 }]}>Analyzing this session…</Text>
        </View>
      </ContentWidth>
    );
  }

  const when = formatWhen(detail.sessionPlayedAt ?? detail.createdAt);

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
        <Text style={styles.eyebrow}>Practice analysis</Text>
        <Text style={styles.title}>{detail.platformLabel}</Text>
        <Text style={styles.meta}>
          {when}
          {detail.shotCount > 0 ? ` · ${detail.shotCount} shots` : ''}
        </Text>

        {detail.status === 'failed' ? (
          <Text style={styles.failed}>{detail.errorMessage ?? 'Analysis failed.'}</Text>
        ) : null}

        {detail.sessionNotes ? (
          <>
            <Text style={styles.sectionTitle}>Session summary</Text>
            <View style={styles.panel}>
              <Text style={styles.summaryTxt}>{detail.sessionNotes}</Text>
            </View>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>By club</Text>
        {detail.clubs.length === 0 ? (
          <Text style={styles.muted}>No club breakdown stored for this session.</Text>
        ) : (
          detail.clubs.map((club) => <ClubCard key={club.club} club={club} tileFlex={tileFlex} />)
        )}

        {detail.tips.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Tips for next session</Text>
            <View style={styles.panel}>
              {detail.tips.map((t, i) => (
                <View key={i} style={styles.tipRow}>
                  <View style={styles.tipNum}>
                    <Text style={styles.tipNumTxt}>{i + 1}</Text>
                  </View>
                  <Text style={styles.tipTxt}>{t}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
          onPress={() => router.replace('/(tabs)/log/practice' as never)}
        >
          <Text style={styles.primaryBtnTxt}>Import another</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed, deleting && styles.disabled]}
          onPress={() => void onDelete()}
          disabled={deleting}
        >
          {deleting ? (
            <ActivityIndicator color={colors.danger} />
          ) : (
            <Text style={styles.dangerBtnTxt}>Delete session</Text>
          )}
        </Pressable>
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0, width: '100%' },
  centered: { flex: 1, justifyContent: 'center', minHeight: 220, alignItems: 'center' },
  muted: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 21 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.ink, marginTop: 6 },
  meta: { fontSize: 12, color: colors.muted, marginTop: 4, marginBottom: 8 },
  failed: { fontSize: 13, color: colors.danger, lineHeight: 19, marginBottom: 12 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 8,
    marginBottom: 10,
  },
  summaryTxt: { fontSize: 14, color: colors.ink, lineHeight: 21 },
  clubCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    marginBottom: 10,
  },
  clubHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
    marginBottom: 10,
  },
  clubTitle: { fontSize: 16, fontWeight: '700', color: colors.ink },
  clubCount: { fontSize: 12, fontWeight: '600', color: colors.muted },
  statsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statWrap: { flexGrow: 1 },
  statCard: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
    minHeight: 72,
  },
  statLbl: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.subtle,
    marginBottom: 5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statVal: { fontSize: 16, fontWeight: '700', color: colors.ink },
  clubTakeaway: {
    marginTop: 12,
    fontSize: 14,
    color: colors.ink,
    lineHeight: 20,
  },
  clubSkip: {
    marginTop: 10,
    fontSize: 12,
    color: colors.subtle,
    lineHeight: 17,
  },
  panel: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    marginBottom: 8,
  },
  tipRow: { flexDirection: 'row', gap: 10, marginBottom: 12, alignItems: 'flex-start' },
  tipNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  tipNumTxt: { fontSize: 12, fontWeight: '700', color: colors.accent },
  tipTxt: { flex: 1, fontSize: 14, color: colors.ink, lineHeight: 20 },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: colors.header,
    borderRadius: 10,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    marginTop: 10,
    borderRadius: 10,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.danger,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  secondaryBtnTxt: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  dangerBtnTxt: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.5 },
});
