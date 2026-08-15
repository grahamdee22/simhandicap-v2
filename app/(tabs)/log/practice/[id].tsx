import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { googleOAuthAccessToken } from '../../../../src/lib/googleOAuthAccessToken';
import {
  createPracticeAnalysisSignedUrl,
  deletePracticeAnalysis,
  fetchPracticeAnalysis,
  mapPracticeAnalysisRow,
} from '../../../../src/lib/practiceAnalysis';
import {
  formatPracticeStatDisplay,
  type NormalizedPracticeAnalysis,
  type PracticeShotRow,
  type PracticeStatValue,
} from '../../../../src/lib/practiceAnalysisNormalize';
import { useResponsive } from '../../../../src/lib/responsive';
import { isSupabaseConfigured } from '../../../../src/lib/supabase';

type DetailState = NormalizedPracticeAnalysis & {
  id: string;
  imagePath: string;
  createdAt: string;
};

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

function StatTile({ stat, wide }: { stat: PracticeStatValue; wide?: boolean }) {
  return (
    <View style={[styles.statCard, wide && styles.statCardWide]}>
      <Text style={styles.statLbl} numberOfLines={2}>
        {stat.label}
      </Text>
      <Text style={styles.statVal} numberOfLines={2}>
        {formatPracticeStatDisplay(stat)}
      </Text>
    </View>
  );
}

function ShotBlock({ shot, index }: { shot: PracticeShotRow; index: number }) {
  const title =
    [shot.shot, shot.club].filter(Boolean).join(' · ') || `Shot ${index + 1}`;
  return (
    <View style={styles.shotCard}>
      <Text style={styles.shotTitle}>{title}</Text>
      {shot.stats.map((s, i) => (
        <View key={`${s.label}-${i}`} style={styles.shotRow}>
          <Text style={styles.shotLbl}>{s.label}</Text>
          <Text style={styles.shotVal}>{formatPracticeStatDisplay(s)}</Text>
        </View>
      ))}
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

  const [detail, setDetail] = useState<DetailState | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!analysisId || !supabaseOn) {
      setLoading(false);
      setErr(!supabaseOn ? 'Supabase is not configured.' : 'Missing analysis.');
      return;
    }
    setLoading(true);
    setErr(null);
    const res = await fetchPracticeAnalysis(analysisId, token);
    if (res.error || !res.data) {
      setErr(res.error ?? 'Could not load analysis.');
      setDetail(null);
      setLoading(false);
      return;
    }
    const mapped = mapPracticeAnalysisRow(res.data);
    setDetail(mapped);
    const signed = await createPracticeAnalysisSignedUrl(mapped.imagePath, token);
    setImageUrl(signed.url);
    setLoading(false);
  }, [analysisId, supabaseOn, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const tileFlex = useMemo(() => {
    if (isVeryWide) return { flexBasis: '23%' as const, maxWidth: '24%' as const };
    if (isWide) return { flexBasis: '30%' as const, maxWidth: '32%' as const };
    return { flexBasis: '47%' as const, maxWidth: '48%' as const };
  }, [isWide, isVeryWide]);

  const onDelete = useCallback(async () => {
    if (!detail || deleting) return;
    const ok = await confirmDestructive(
      'Delete analysis?',
      'This removes the saved insights and the uploaded photo. It does not affect your SimCap index.',
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
        <Text style={styles.title}>{detail.detectedSystem?.trim() || 'Practice session'}</Text>
        <Text style={styles.meta}>{formatWhen(detail.createdAt)}</Text>
        {detail.sessionNotes ? <Text style={styles.sessionNotes}>{detail.sessionNotes}</Text> : null}

        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.heroImage} resizeMode="contain" />
        ) : null}

        {detail.extractedStats.summary.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Extracted stats</Text>
            <View style={styles.statsWrap}>
              {detail.extractedStats.summary.map((s, i) => (
                <View key={`${s.label}-${i}`} style={[styles.statWrap, tileFlex]}>
                  <StatTile stat={s} />
                </View>
              ))}
            </View>
          </>
        ) : null}

        {detail.extractedStats.shots.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Per-shot detail</Text>
            {detail.extractedStats.shots.map((shot, i) => (
              <ShotBlock key={i} shot={shot} index={i} />
            ))}
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Takeaways</Text>
        <View style={styles.panel}>
          {detail.takeaways.map((t, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bulletTxt}>{t}</Text>
            </View>
          ))}
        </View>

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

        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
          onPress={() => router.replace('/(tabs)/log/practice' as never)}
        >
          <Text style={styles.primaryBtnTxt}>Analyze another</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed, deleting && styles.disabled]}
          onPress={() => void onDelete()}
          disabled={deleting}
        >
          {deleting ? (
            <ActivityIndicator color={colors.danger} />
          ) : (
            <Text style={styles.dangerBtnTxt}>Delete analysis</Text>
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
  sessionNotes: { fontSize: 13, color: colors.subtle, lineHeight: 19, marginBottom: 12 },
  heroImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 8,
    marginBottom: 10,
  },
  statsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  statWrap: { flexGrow: 1 },
  statCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
    minHeight: 72,
  },
  statCardWide: {},
  statLbl: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.subtle,
    marginBottom: 5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statVal: { fontSize: 16, fontWeight: '700', color: colors.ink },
  shotCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  shotTitle: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  shotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  shotLbl: { flex: 1, fontSize: 12, color: colors.muted },
  shotVal: { fontSize: 12, fontWeight: '600', color: colors.ink },
  panel: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    marginBottom: 8,
  },
  bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  bullet: { fontSize: 14, color: colors.sage, fontWeight: '700', lineHeight: 20 },
  bulletTxt: { flex: 1, fontSize: 14, color: colors.ink, lineHeight: 20 },
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
