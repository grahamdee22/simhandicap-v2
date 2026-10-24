import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { Link, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n, { useTranslation } from '../../../src/i18n';
import { showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { mergeViewStyles } from '../../../src/lib/mergeStyles';
import { navigateBackOrFallback } from '../../../src/lib/navigateBack';
import { useResponsive } from '../../../src/lib/responsive';
import {
  formatDifferentialDisplay,
  formatHandicapIndexDisplay,
  normalizeMulligans,
  scoreToParStyle,
} from '../../../src/lib/handicap';
import { getCourseById } from '../../../src/lib/courses';
import {
  fetchCommunityCourseEnrichment,
} from '../../../src/lib/communityCourses';
import {
  roundDetailAttributionLabel,
  shouldFetchCommunityCourseEnrichmentForRound,
} from '../../../src/lib/roundDetailCommunityEnrichment';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import { resolveSocialGroupsAccessToken } from '../../../src/lib/socialGroups';
import { isSupabaseConfigured } from '../../../src/lib/supabase';
import { UnverifiedCourseBadge } from '../../../src/components/UnverifiedCourseBadge';
import { UnratedCourseBadge } from '../../../src/components/UnratedCourseBadge';
import { isUnratedTee } from '../../../src/lib/ratingSource';
import { isGsProPlatform } from '../../../src/lib/pinPlacement';
import { useAppStore, type SimRound } from '../../../src/store/useAppStore';
import type { TFunction } from 'i18next';

/** RN Web's Alert.alert is a no-op; use the browser confirm dialog there. */
function confirmDestructive(
  title: string,
  message: string,
  destructiveLabel: string,
  onConfirm: () => void
) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: i18n.t('common.cancel'), style: 'cancel' },
    { text: destructiveLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

function puttingLabel(t: TFunction, p: SimRound['putting']): string {
  if (p === 'auto_2putt') return t('analyze.filter.putting.auto2putt');
  if (p === 'gimme_5') return t('round.detail.putting.gimme_5');
  return t('round.detail.putting.putt_all');
}

function windLabel(t: TFunction, w: SimRound['wind']): string {
  return t(`analyze.filter.wind.${w}`);
}

function pinDetailLabelTranslated(
  t: TFunction,
  pin: SimRound['pin'],
  platform: SimRound['platform']
): string {
  if (isGsProPlatform(platform)) {
    return t(`round.detail.pinDetail.${pin}`);
  }
  if (pin === 'thu') return t('log.round.pin.easy');
  if (pin === 'fri') return t('log.round.pin.medium');
  if (pin === 'sun') return t('log.round.pin.hard');
  return t(`log.round.pin.${pin}`);
}

/** Same counting set as Home index math (`roundsForSimcapIndex`). */
function top8Ids(all: SimRound[]): Set<string> {
  const counting = all.filter((r) => !r.excludesFromSimcapIndex);
  const chron = [...counting].sort((a, b) => {
    const dt = new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime();
    if (dt !== 0) return dt;
    return a.id.localeCompare(b.id);
  });
  const window = chron.slice(-20);
  const ranked = window.map((r) => ({ id: r.id, d: r.adjustedDiff }));
  ranked.sort((a, b) => a.d - b.d);
  return new Set(ranked.slice(0, 8).map((x) => x.id));
}

export default function RoundDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { gutter, isWide, isVeryWide, columnWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const rounds = useAppStore((s) => s.rounds);
  const deleteRound = useAppStore((s) => s.deleteRound);
  const roundId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const r = roundId ? rounds.find((x) => x.id === roundId) : undefined;
  const supabaseOn = isSupabaseConfigured();
  const [courseEnrichment, setCourseEnrichment] = useState<{
    enrichmentTier: number | null;
    enrichmentSource: string | null;
  } | null>(null);

  const goBack = useCallback(() => {
    navigateBackOrFallback(navigation, router, '/(tabs)' as Href);
  }, [navigation, router]);

  useEffect(() => {
    if (!shouldFetchCommunityCourseEnrichmentForRound(r)) {
      setCourseEnrichment(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const accessToken =
          googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
        if (!supabaseOn && !accessToken) return;
        const enrichment = await fetchCommunityCourseEnrichment(r!.courseId, accessToken);
        if (!cancelled) setCourseEnrichment(enrichment);
      } catch {
        if (!cancelled) setCourseEnrichment(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [r, supabaseOn]);

  useLayoutEffect(() => {
    if (!r) {
      navigation.setOptions({
        title: t('tabs.round.title'),
        headerRight: undefined,
      });
      return;
    }
    navigation.setOptions({
      title: t('tabs.round.title'),
      headerRight: () => (
        <Link href={{ pathname: '/(tabs)/log/round', params: { editId: r.id } } as unknown as Href} asChild>
          <Pressable style={{ paddingHorizontal: 12 }}>
            <Text style={{ color: colors.accentMuted, fontSize: 13, fontWeight: '600' }}>
              {t('round.detail.edit')}
            </Text>
          </Pressable>
        </Link>
      ),
    });
  }, [navigation, r, t]);

  // With tab `backBehavior="history"`, this screen can stay mounted while another
  // tab is visible. Don't leave "Round not found" text in the inactive DOM.
  if (!r) {
    if (!isFocused) return null;
    return (
      <View style={[styles.miss, { paddingTop: insets.top }]}>
        <Text style={styles.missTxt}>{t('round.detail.notFound')}</Text>
        <Pressable onPress={goBack}>
          <Text style={styles.link}>{t('round.detail.backHome')}</Text>
        </Pressable>
      </View>
    );
  }

  const course = getCourseById(r.courseId);
  const pars = course?.pars ?? [];
  const parTotal = pars.reduce((a, b) => a + b, 0) || 72;
  const vsPar = r.grossScore - parTotal;
  const vsParTxt =
    vsPar === 0
      ? t('round.detail.evenPar')
      : vsPar > 0
        ? t('round.detail.overPar', { count: vsPar })
        : t('round.detail.underPar', { count: Math.abs(vsPar) });

  const excludedFromIndex = !!r.excludesFromSimcapIndex;
  const inTop = !excludedFromIndex && top8Ids(rounds).has(r.id);
  const indexBadgeSub = excludedFromIndex
    ? t('round.detail.excludedFromIndex')
    : inTop
      ? t('round.detail.countsTowardIndex')
      : t('round.detail.outsideBest8');
  const filledCard = r.holeScores.length === 18 && r.holeScores.every((h) => h != null);
  const emDash = t('match.history.emDash');
  const holesMeta =
    r.holesPlayed === 'front'
      ? ` · ${t('roundList.front9')}`
      : r.holesPlayed === 'back'
        ? ` · ${t('roundList.back9')}`
        : '';
  const holesSub =
    r.holesPlayed === 'front'
      ? t('roundList.front9')
      : r.holesPlayed === 'back'
        ? t('roundList.back9')
        : vsParTxt;

  const onDelete = () => {
    confirmDestructive(
      t('round.detail.deleteConfirmTitle'),
      t('round.detail.deleteConfirmBody'),
      t('round.detail.deleteAction'),
      () => {
        void (async () => {
          try {
            await deleteRound(r.id);
            goBack();
          } catch (e) {
            showAppAlert(t('round.detail.couldNotDelete'), String(e));
          }
        })();
      }
    );
  };

  return (
    <View style={styles.screenRoot}>
        <ScrollView
          style={styles.screen}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator
        >
          <View
            style={[
              styles.hero,
              {
                paddingLeft: Math.max(gutter, insets.left),
                paddingRight: Math.max(gutter, insets.right),
              },
            ]}
          >
            <Text style={[styles.course, isWide && styles.courseLg]}>{r.courseName}</Text>
            {isUnratedTee(r.teeRatingSource) ? (
              <UnratedCourseBadge />
            ) : roundDetailAttributionLabel(r.handicapSource, courseEnrichment) ? (
              <UnverifiedCourseBadge
                enrichmentTier={courseEnrichment?.enrichmentTier}
                enrichmentSource={courseEnrichment?.enrichmentSource}
              />
            ) : null}
            <Text style={[styles.meta, isWide && styles.metaLg]}>
              {r.platform} · {new Date(r.playedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
              {r.teeName ? ` · ${r.teeName}` : ''}
              {holesMeta}
            </Text>
            <View style={[styles.heroStats, isWide && { gap: 12 }]}>
              <View style={[styles.hstat, isWide && styles.hstatLg]}>
                <Text style={styles.hstatLbl}>{t('round.detail.grossScore')}</Text>
                <Text style={styles.hstatVal}>{r.grossScore}</Text>
                <Text style={styles.hstatSub}>{holesSub}</Text>
              </View>
              <View style={[styles.hstat, isWide && styles.hstatLg]}>
                <Text style={styles.hstatLbl}>{t('round.detail.differential')}</Text>
                <Text style={styles.hstatVal}>{formatDifferentialDisplay(r.adjustedDiff)}</Text>
                <Text style={styles.hstatSub}>{indexBadgeSub}</Text>
              </View>
              <View style={[styles.hstat, isWide && styles.hstatLg]}>
                <Text style={styles.hstatLbl}>{t('round.detail.indexAfter')}</Text>
                <Text style={styles.hstatVal}>{formatHandicapIndexDisplay(r.indexAfter)}</Text>
                <Text style={styles.hstatSub}>
                  {r.indexDelta != null
                    ? t('round.detail.indexDeltaThisRound', { value: r.indexDelta.toFixed(1) })
                    : emDash}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.detailColumn, { maxWidth: columnWidth }]}>
          {isVeryWide ? (
            <View style={[styles.splitDetail, { paddingHorizontal: gutter, gap: gutter }]}>
              <View style={styles.splitCol}>
                <View style={[styles.predCard, styles.predCardSplit]}>
                  <View style={styles.predStatRow}>
                    <Text style={styles.predStatLbl}>{t('log.round.adjustedDifferential')}</Text>
                    <Text style={styles.predAdjustedNum}>{formatDifferentialDisplay(r.adjustedDiff)}</Text>
                  </View>
                </View>
              </View>
              <View style={styles.splitCol}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>{t('round.detail.conditionsPlayed')}</Text>
                </View>
                <View style={styles.grid}>
                  <View style={[styles.chip, isVeryWide && styles.chipLg]}>
                    <Text style={styles.chipLbl}>{t('log.round.puttingMode')}</Text>
                    <Text style={styles.chipVal}>{puttingLabel(t, r.putting)}</Text>
                  </View>
                  <View style={[styles.chip, isVeryWide && styles.chipLg]}>
                    <Text style={styles.chipLbl}>{t('log.round.pinPlacement')}</Text>
                    <Text style={styles.chipVal}>{pinDetailLabelTranslated(t, r.pin, r.platform)}</Text>
                  </View>
                  <View style={[styles.chip, isVeryWide && styles.chipLg]}>
                    <Text style={styles.chipLbl}>{t('log.round.wind')}</Text>
                    <Text style={[styles.chipVal, styles.chipHi]}>{windLabel(t, r.wind)}</Text>
                  </View>
                  <View style={[styles.chip, isVeryWide && styles.chipLg]}>
                    <Text style={styles.chipLbl}>{t('log.round.mulligans')}</Text>
                    <Text style={[styles.chipVal, styles.chipHi]}>
                      {t(`log.round.mulliganOpts.${normalizeMulligans(r.mulligans)}.ds`)}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <>
              <View style={[styles.predCard, { marginHorizontal: gutter }]}>
                <View style={styles.predStatRow}>
                  <Text style={styles.predStatLbl}>{t('log.round.adjustedDifferential')}</Text>
                  <Text style={styles.predAdjustedNum}>{formatDifferentialDisplay(r.adjustedDiff)}</Text>
                </View>
              </View>

              <View style={[styles.sectionHead, { paddingHorizontal: gutter }]}>
                <Text style={styles.sectionTitle}>{t('round.detail.conditionsPlayed')}</Text>
              </View>
              <View style={[styles.grid, { paddingHorizontal: gutter }]}>
                <View style={styles.chip}>
                  <Text style={styles.chipLbl}>{t('log.round.puttingMode')}</Text>
                  <Text style={styles.chipVal}>{puttingLabel(t, r.putting)}</Text>
                </View>
                <View style={styles.chip}>
                  <Text style={styles.chipLbl}>{t('log.round.pinPlacement')}</Text>
                  <Text style={styles.chipVal}>{pinDetailLabelTranslated(t, r.pin, r.platform)}</Text>
                </View>
                <View style={styles.chip}>
                  <Text style={styles.chipLbl}>{t('log.round.wind')}</Text>
                  <Text style={[styles.chipVal, styles.chipHi]}>{windLabel(t, r.wind)}</Text>
                </View>
                <View style={styles.chip}>
                  <Text style={styles.chipLbl}>{t('log.round.mulligans')}</Text>
                  <Text style={[styles.chipVal, styles.chipHi]}>
                    {t(`log.round.mulliganOpts.${normalizeMulligans(r.mulligans)}.ds`)}
                  </Text>
                </View>
              </View>
            </>
          )}

          {filledCard ? (
            <>
              <View style={[styles.sectionHead, { paddingHorizontal: gutter }]}>
                <Text style={styles.sectionTitle}>{t('round.detail.scorecard')}</Text>
              </View>
              {isVeryWide ? (
                <View style={[styles.scRowWide, { paddingHorizontal: gutter, gap: gutter }]}>
                  <ScoreTable
                    pars={pars}
                    scores={r.holeScores as number[]}
                    label={t('roundList.front9')}
                    start={0}
                    count={9}
                    totalLabel={t('round.detail.scorecardOut')}
                    wrapStyle={styles.scWrapHalf}
                  />
                  <ScoreTable
                    pars={pars}
                    scores={r.holeScores as number[]}
                    label={t('roundList.back9')}
                    start={9}
                    count={9}
                    totalLabel={t('round.detail.scorecardIn')}
                    wrapStyle={styles.scWrapHalf}
                  />
                </View>
              ) : (
                <>
                  <ScoreTable
                    pars={pars}
                    scores={r.holeScores as number[]}
                    label={t('roundList.front9')}
                    start={0}
                    count={9}
                    totalLabel={t('round.detail.scorecardOut')}
                    wrapStyle={{ marginHorizontal: gutter }}
                  />
                  <ScoreTable
                    pars={pars}
                    scores={r.holeScores as number[]}
                    label={t('roundList.back9')}
                    start={9}
                    count={9}
                    totalLabel={t('round.detail.scorecardIn')}
                    wrapStyle={{ marginHorizontal: gutter }}
                  />
                </>
              )}
            </>
          ) : null}

          <View style={[styles.actions, { marginHorizontal: gutter }]}>
            <Link href={'/(tabs)/log/round' as Href} asChild>
              <Pressable style={mergeViewStyles(styles.actionBtn, styles.actionPrimary)}>
                <Text style={[styles.actionTxt, styles.actionPrimaryTxt]}>{t('round.detail.logAnother')}</Text>
              </Pressable>
            </Link>
          </View>

          <Pressable style={styles.deleteBtn} onPress={onDelete}>
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
            <Text style={styles.deleteTxt}>{t('round.detail.deleteRound')}</Text>
          </Pressable>
          </View>
        </ScrollView>
    </View>
  );
}

function ScoreTable({
  pars,
  scores,
  label,
  start,
  count,
  totalLabel,
  wrapStyle,
}: {
  pars: number[];
  scores: number[];
  label: string;
  start: number;
  count: number;
  totalLabel: string;
  wrapStyle?: ViewStyle;
}) {
  const { t } = useTranslation();
  const holes = Array.from({ length: count }, (_, i) => start + i);
  const total = holes.reduce((s, i) => s + (scores[i] ?? 0), 0);
  const emDash = t('match.history.emDash');
  return (
    <View style={[styles.scWrap, wrapStyle]}>
      <Text style={styles.scSection}>{label}</Text>
      <View style={styles.scHdr}>
        <Text style={[styles.scCell, styles.scCellL]}>{t('round.detail.scorecardHole')}</Text>
        {holes.map((i) => (
          <Text key={i} style={styles.scCell}>
            {i + 1}
          </Text>
        ))}
      </View>
      <View style={styles.scRow}>
        <Text style={styles.scN}>{t('round.detail.scorecardPar')}</Text>
        {holes.map((i) => (
          <Text key={i} style={styles.scS}>
            {pars[i] ?? emDash}
          </Text>
        ))}
      </View>
      <View style={styles.scRow}>
        <Text style={styles.scN}>{t('round.detail.scorecardYou')}</Text>
        {holes.map((i) => {
          const sc = scores[i];
          const par = pars[i] ?? 4;
          const st = scoreToParStyle(sc, par);
          const inner = (
            <Text style={[styles.scScoreTxt, st === 'birdie' || st === 'eagle_plus' ? styles.bi : undefined]}>
              {sc}
            </Text>
          );
          if (st === 'birdie' || st === 'eagle_plus') {
            return (
              <View key={i} style={styles.scS}>
                <View style={styles.circle}>{inner}</View>
              </View>
            );
          }
          if (st === 'bogey' || st === 'double_plus') {
            return (
              <View key={i} style={styles.scS}>
                <View style={styles.box}>{inner}</View>
              </View>
            );
          }
          return (
            <View key={i} style={styles.scS}>
              {inner}
            </View>
          );
        })}
      </View>
      <View style={styles.scTot}>
        <Text style={styles.scTotLbl}>{totalLabel}</Text>
        <Text style={styles.scTotVal}>{total}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    backgroundColor: colors.surface,
  },
  detailColumn: {
    width: '100%',
    alignSelf: 'center',
  },
  screen: { flex: 1, minHeight: 0, backgroundColor: colors.surface, width: '100%' },
  splitDetail: { flexDirection: 'row', alignItems: 'flex-start', width: '100%' },
  splitCol: { flex: 1, minWidth: 0 },
  scRowWide: { flexDirection: 'row', alignItems: 'flex-start', width: '100%' },
  scWrapHalf: { flex: 1, minWidth: 0, marginBottom: 10 },
  courseLg: { fontSize: 22 },
  metaLg: { fontSize: 12 },
  hstatLg: { padding: 10 },
  chipLg: { width: '100%' },
  miss: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  missTxt: { fontSize: 15, color: colors.muted },
  link: { marginTop: 12, color: colors.accent, fontSize: 15 },
  hero: {
    backgroundColor: colors.header,
    width: '100%',
    alignSelf: 'stretch',
    paddingTop: 18,
    paddingBottom: 16,
  },
  course: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 2 },
  meta: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 12 },
  heroStats: { flexDirection: 'row', gap: 8 },
  hstat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: 8 },
  hstatLbl: { fontSize: 9, color: 'rgba(255,255,255,0.35)', marginBottom: 2 },
  hstatVal: { fontSize: 18, fontWeight: '600', color: '#fff' },
  hstatSub: { fontSize: 9, color: colors.accentMuted, marginTop: 1 },
  sectionHead: { paddingTop: 12, paddingBottom: 6 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.ink },
  /** Matches log round `predCard` / adjusted differential row. */
  predCard: {
    backgroundColor: '#f0f7f4',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 14,
    marginBottom: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cfe8dc',
  },
  predCardSplit: { marginTop: 12 },
  predStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 4,
    justifyContent: 'space-between',
    marginBottom: 0,
  },
  predStatLbl: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a3d2b',
  },
  predAdjustedNum: { fontSize: 28, fontWeight: '700', color: '#1a3d2b' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: { width: '48%', backgroundColor: colors.surface, borderRadius: 8, padding: 8, borderWidth: 0.5, borderColor: colors.border },
  chipLbl: { fontSize: 9, color: colors.subtle },
  chipVal: { fontSize: 12, fontWeight: '600', color: colors.ink, marginTop: 2 },
  chipHi: { color: colors.accentDark },
  scWrap: {
    marginBottom: 10,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  scSection: { fontSize: 11, fontWeight: '700', color: colors.subtle, padding: 8, backgroundColor: colors.accentSoft },
  scHdr: { flexDirection: 'row', backgroundColor: colors.accentSoft, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  scRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: colors.border },
  scTot: { flexDirection: 'row', backgroundColor: colors.accentSoft, alignItems: 'center' },
  scCell: { flex: 1, fontSize: 9, fontWeight: '600', color: colors.subtle, textAlign: 'center', paddingVertical: 5 },
  scCellL: { flex: 0, width: 28, textAlign: 'left', paddingLeft: 6 },
  scN: { width: 28, fontSize: 9, color: colors.subtle, paddingVertical: 6, paddingLeft: 6 },
  scS: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  scScoreTxt: { fontSize: 10, fontWeight: '600', color: colors.ink },
  bi: { color: colors.accent },
  circle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scTotLbl: { width: 28, fontSize: 9, fontWeight: '600', color: colors.muted, padding: 6 },
  scTotVal: { flex: 1, textAlign: 'right', paddingRight: 8, fontSize: 10, fontWeight: '600', color: colors.ink },
  actions: { flexDirection: 'row', gap: 6, marginTop: 10 },
  actionBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
    alignItems: 'center',
  },
  actionPrimary: { backgroundColor: colors.header, borderColor: colors.header },
  actionTxt: { fontSize: 12, fontWeight: '700', color: colors.accent },
  actionPrimaryTxt: { color: '#fff', fontWeight: '700' },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
    paddingVertical: 12,
  },
  deleteTxt: { color: colors.danger, fontSize: 14, fontWeight: '600' },
});
