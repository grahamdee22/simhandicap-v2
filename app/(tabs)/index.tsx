import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Link } from 'expo-router';
import { Fragment, useMemo, useState } from 'react';
import { Modal, Platform, Pressable as RNPressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentWidth } from '../../src/components/ContentWidth';
import { HomeHeroInstagramButton } from '../../src/components/HeaderInstagramSimCap';
import {
  IconChevronForward,
  IconGolf,
} from '../../src/components/SvgUiIcons';
import { SimCapLogoHero, SIM_CAP_LOGO_ASPECT } from '../../src/components/SimCapLogoHero';
import { colors } from '../../src/lib/constants';
import { formatDifferentialDisplay, formatHandicapIndexDisplay, indexHistoryFromRounds } from '../../src/lib/handicap';
import { mergeViewStyles } from '../../src/lib/mergeStyles';
import { useResponsive } from '../../src/lib/responsive';
import {
  currentIndexFromRounds,
  formatRoundMeta,
  useAppStore,
  type SimRound,
} from '../../src/store/useAppStore';

function greetingFromHour(h: number): string {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function trendBadge(rounds: SimRound[]): string | null {
  const hist = indexHistoryFromRounds(
    [...rounds].map((r) => ({ playedAt: r.playedAt, adjustedDiff: r.adjustedDiff }))
  );
  if (hist.length < 2) return null;
  const now = hist[hist.length - 1].index;
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const past = [...hist].filter((h) => new Date(h.date).getTime() <= monthAgo).pop();
  if (!past) return null;
  const d = now - past.index;
  if (Math.abs(d) < 0.05) return 'Flat vs last month';
  if (d < 0) return `Down ${Math.abs(d).toFixed(1)} from last month`;
  return `Up ${d.toFixed(1)} from last month`;
}

/** In-card horizontal padding (matches latest row); body uses `gutter` for outer alignment only. */
const CARD_INNER_PAD = 14;
/** Recent rounds list: one inset on the card content wrapper so rows/links can’t paint past it. */
const RECENT_LIST_INSET = 18;

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const {
    gutter,
    maxContent,
    homeSplit,
    isWide,
    isVeryWide,
    isCompactHome,
  } = useResponsive();
  const rounds = useAppStore((s) => s.rounds);
  const displayName = useAppStore((s) => s.displayName);
  const [indexInfoOpen, setIndexInfoOpen] = useState(false);

  const index = currentIndexFromRounds(rounds);

  const stats = useMemo(() => {
    if (rounds.length === 0) {
      return { roundsN: 0, bestDiff: null as number | null, bestCourse: '', avg: null as number | null };
    }
    const best = [...rounds].sort((a, b) => a.adjustedDiff - b.adjustedDiff)[0];
    const avg = rounds.reduce((s, r) => s + r.grossScore, 0) / rounds.length;
    return {
      roundsN: rounds.length,
      bestDiff: best.adjustedDiff,
      bestCourse: best.courseName,
      avg: Math.round(avg * 10) / 10,
    };
  }, [rounds]);

  const badge = trendBadge(rounds);
  const latest = rounds[0];
  const heroPadTop = Math.max(insets.top, 12) + 4;
  const rightColW = Math.min(420, Math.floor(maxContent * 0.4));

  const statsRowStyle = useMemo(
    () =>
      mergeViewStyles(styles.statsRow, {
        flexDirection: isCompactHome ? 'column' : 'row',
        gap: isCompactHome ? 10 : isVeryWide ? 12 : isWide ? 8 : 6,
      }),
    [isWide, isVeryWide, isCompactHome]
  );

  const statCardDyn = useMemo(
    () =>
      isCompactHome
        ? { flex: 0 as const, width: '100%' as const }
        : { flex: 1 as const, flexBasis: 0 as const },
    [isCompactHome]
  );

  const roundList = (
    <>
      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, isWide && styles.sectionTitleLg]}>Recent rounds</Text>
        <Link href="/(tabs)/analyze" asChild>
          <Pressable style={styles.analyzeLink}>
            <Text style={styles.analyzeLinkTxt}>Analyze</Text>
            <IconChevronForward size={14} color={colors.sage} />
          </Pressable>
        </Link>
      </View>
      {rounds.length === 0 ? (
        <Text style={styles.emptyRounds}>
          No rounds yet. Log your first sim round.
        </Text>
      ) : (
        rounds.slice(0, 8).map((r, idx) => (
          <View key={r.id} style={[styles.roundRowOuter, idx > 0 && styles.roundRowGapBefore]}>
            <Link href={`/round/${r.id}`} asChild>
              <Pressable
                style={({ pressed }) =>
                  mergeViewStyles(
                    styles.roundRow,
                    idx > 0 && styles.roundRowBorder,
                    { width: '100%' as const },
                    pressed && styles.roundRowPressed
                  )
                }
              >
                <View style={styles.roundRowFlagIcon} pointerEvents="none">
                  <IconGolf size={isWide ? 18 : 16} color={colors.sage} />
                </View>
                <View style={styles.roundRowMain}>
                  <View style={styles.roundInfo}>
                    <Text style={[styles.roundCourse, isWide && styles.roundCourseLg]} numberOfLines={1}>
                      {r.courseName}
                    </Text>
                    <Text style={[styles.roundMeta, isWide && styles.roundMetaLg]} numberOfLines={2}>
                      {formatRoundMeta(r)}
                    </Text>
                  </View>
                  <View style={styles.roundRight}>
                    <Text
                      style={[styles.roundScore, isWide && styles.roundScoreLg]}
                      {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
                    >
                      {r.grossScore}
                    </Text>
                    <Text
                      style={styles.roundDiff}
                      {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
                    >
                      diff {formatDifferentialDisplay(r.adjustedDiff)}
                    </Text>
                  </View>
                </View>
              </Pressable>
            </Link>
          </View>
        ))
      )}
    </>
  );

  /**
   * Bottom inset must match app/(tabs)/_layout.tsx (barPadTop + barRow + bottomInset).
   * useBottomTabBarHeight is usually right, but we floor it so we never under-count the bar.
   */
  const tabBarBottomInset = Platform.OS === 'web' ? insets.bottom : Math.max(insets.bottom, 8);
  const tabBarHeightFloor = 3 + 62 + tabBarBottomInset;
  const effectiveTabBarHeight = Math.max(tabBarHeight, tabBarHeightFloor);
  /** Only clear the tab bar — avoids a huge empty band below the last card when scrolling. */
  const scrollBelowContent = Math.round(effectiveTabBarHeight + 12);

  return (
    <View style={styles.pageRoot}>
      <View
        style={[
          styles.hero,
          {
            paddingTop: heroPadTop,
            paddingHorizontal: gutter,
            paddingBottom: isWide ? 26 : 22,
            marginBottom: 10,
          },
        ]}
      >
        <View style={styles.heroBrandRow}>
          <View style={[styles.heroLogoWrap, isWide && styles.heroLogoWrapWide]}>
            <SimCapLogoHero style={[styles.heroLogo, { aspectRatio: SIM_CAP_LOGO_ASPECT }]} />
          </View>
          <HomeHeroInstagramButton />
        </View>
        <View style={styles.heroBlock}>
          <Text
            style={[styles.heroGreet, isWide && styles.heroGreetLg]}
            {...(Platform.OS === 'web' ? { suppressHydrationWarning: true } : {})}
          >
            {greetingFromHour(new Date().getHours()).toUpperCase()}
          </Text>
          <Text style={[styles.heroName, isWide && styles.heroNameLg]}>{displayName}</Text>
        </View>
        <View style={[styles.indexRow, isCompactHome && styles.indexRowWrap]}>
          <Text style={[styles.indexNum, isWide && styles.indexNumLg, isVeryWide && styles.indexNumXL]}>
            {formatHandicapIndexDisplay(index)}
          </Text>
          <View style={styles.indexLblCluster}>
            <Text style={[styles.indexLbl, isWide && styles.indexLblLg]}>Sim handicap index</Text>
            <RNPressable
              style={styles.indexInfoBtn}
              onPress={() => setIndexInfoOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="About Sim handicap index"
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
            >
              <Text style={styles.indexInfoBtnTxt}>ⓘ</Text>
            </RNPressable>
          </View>
        </View>
        {badge ? (
          <View style={styles.badge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeTxt}>{badge}</Text>
          </View>
        ) : null}
        {rounds.length > 0 ? (
          <Text style={[styles.indexFoot, isWide && styles.indexFootLg]}>
            Based on {rounds.length} logged round{rounds.length === 1 ? '' : 's'} · updates when you save from Log
          </Text>
        ) : (
          <Text style={[styles.indexFoot, styles.indexFootMuted]}>
            Log a round to calculate your sim index from differentials.
          </Text>
        )}
      </View>

      <Modal
        visible={indexInfoOpen}
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        transparent
        onRequestClose={() => setIndexInfoOpen(false)}
      >
        <View style={styles.infoModalRoot}>
          <RNPressable style={styles.infoModalBackdrop} onPress={() => setIndexInfoOpen(false)} />
          <View style={[styles.infoModalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.infoModalTitle}>Sim handicap index</Text>
            <Text style={styles.infoModalBody}>
              Your SimCap index is calculated from your logged rounds using a WHS-style formula, adjusted for your
              simulator settings. The more rounds you log, the more accurate it gets.
            </Text>
          </View>
        </View>
      </Modal>

      <ContentWidth>
        <ScrollView
          style={styles.screen}
          contentContainerStyle={{
            width: '100%',
            alignSelf: 'stretch',
            paddingBottom: scrollBelowContent,
          }}
          {...(Platform.OS === 'ios'
            ? { contentInsetAdjustmentBehavior: 'never' as const }
            : {})}
          {...(Platform.OS === 'android' ? { overScrollMode: 'never' as const } : {})}
          showsVerticalScrollIndicator={false}
        >
        <Fragment>
        {homeSplit ? (
          <>
            <View style={[styles.homeBody, { paddingHorizontal: gutter, marginTop: 8 }]}>
              {latest ? (
                <Link href={`/round/${latest.id}`} asChild>
                  <Pressable
                    style={({ pressed }) => mergeViewStyles(styles.latestCard, pressed && { opacity: 0.94 })}
                    accessibilityRole="button"
                    accessibilityLabel="Open latest saved round"
                  >
                    <View style={styles.latestIcon}>
                      <IconGolf size={20} color={colors.sage} />
                    </View>
                    <View style={styles.latestBody}>
                      <Text style={styles.latestKicker}>Latest round</Text>
                      <Text style={styles.latestTitle} numberOfLines={1}>
                        {latest.courseName}
                      </Text>
                      <Text style={styles.latestMeta} numberOfLines={2}>
                        {new Date(latest.playedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}{' '}
                        · Gross {latest.grossScore} · Diff {formatDifferentialDisplay(latest.adjustedDiff)}
                        {latest.indexDelta != null
                          ? ` · Index ${latest.indexDelta.toFixed(1)}`
                          : ''}
                      </Text>
                    </View>
                    <View style={styles.latestChevron} pointerEvents="none">
                      <IconChevronForward size={20} color={colors.subtle} />
                    </View>
                  </Pressable>
                </Link>
              ) : (
                <Link href="/(tabs)/log" asChild>
                  <Pressable style={({ pressed }) => mergeViewStyles(styles.ctaCard, pressed && { opacity: 0.94 })}>
                    <Text style={styles.ctaTitle}>Log your first round</Text>
                    <Text style={styles.ctaSub}>
                      Score + sim settings → your index, Trends, and profile update instantly.
                    </Text>
                  </Pressable>
                </Link>
              )}
            </View>
            <View style={[styles.splitRow, { paddingHorizontal: gutter, gap: gutter, marginTop: 14 }]}>
              <View style={[styles.splitLeft, { minWidth: 0 }]}>
                <View style={statsRowStyle}>
                  <View style={mergeViewStyles(styles.statCard, statCardDyn, isWide && styles.statCardLg)}>
                    <Text style={styles.statLbl}>Rounds</Text>
                    <Text style={[styles.statVal, isWide && styles.statValLg]}>{stats.roundsN}</Text>
                    <Text style={styles.statSub}>Logged</Text>
                  </View>
                  <View style={mergeViewStyles(styles.statCard, statCardDyn, isWide && styles.statCardLg)}>
                    <Text style={styles.statLbl}>Best diff.</Text>
                    <Text style={[styles.statVal, isWide && styles.statValLg]}>
                      {formatDifferentialDisplay(stats.bestDiff)}
                    </Text>
                    <Text style={[styles.statSub, { color: colors.subtle }]} numberOfLines={1}>
                      {stats.bestCourse || '—'}
                    </Text>
                  </View>
                  <View style={mergeViewStyles(styles.statCard, statCardDyn, isWide && styles.statCardLg)}>
                    <Text style={styles.statLbl}>Avg score</Text>
                    <Text style={[styles.statVal, isWide && styles.statValLg]}>
                      {stats.avg != null ? stats.avg : '—'}
                    </Text>
                    <Text style={styles.statSub}>Gross</Text>
                  </View>
                </View>
              </View>
              <View style={[styles.splitRight, { width: rightColW }]}>
                <View style={[styles.listCard, styles.splitListCard]}>
                  <View style={styles.listCardContent}>{roundList}</View>
                </View>
              </View>
            </View>
          </>
        ) : (
          <View style={[styles.homeBody, { paddingHorizontal: gutter }]}>
            {latest ? (
              <Link href={`/round/${latest.id}`} asChild>
                <Pressable
                  style={({ pressed }) =>
                    mergeViewStyles(styles.latestCard, { marginTop: 8 }, pressed && { opacity: 0.94 })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Open latest saved round"
                >
                  <View style={styles.latestIcon}>
                    <IconGolf size={20} color={colors.sage} />
                  </View>
                  <View style={styles.latestBody}>
                    <Text style={styles.latestKicker}>Latest round</Text>
                    <Text style={styles.latestTitle} numberOfLines={1}>
                      {latest.courseName}
                    </Text>
                    <Text style={styles.latestMeta} numberOfLines={2}>
                      {new Date(latest.playedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}{' '}
                      · Gross {latest.grossScore} · Diff {formatDifferentialDisplay(latest.adjustedDiff)}
                      {latest.indexDelta != null
                        ? ` · Index ${latest.indexDelta.toFixed(1)}`
                        : ''}
                    </Text>
                  </View>
                  <View style={styles.latestChevron} pointerEvents="none">
                    <IconChevronForward size={20} color={colors.subtle} />
                  </View>
                </Pressable>
              </Link>
            ) : (
              <Link href="/(tabs)/log" asChild>
                <Pressable
                  style={({ pressed }) =>
                    mergeViewStyles(styles.ctaCard, { marginTop: 8 }, pressed && { opacity: 0.94 })
                  }
                >
                  <Text style={styles.ctaTitle}>Log your first round</Text>
                  <Text style={styles.ctaSub}>
                    Score + sim settings → your index, Trends, and profile update instantly.
                  </Text>
                </Pressable>
              </Link>
            )}
            <View style={mergeViewStyles(statsRowStyle, { marginTop: 14 })}>
              <View style={mergeViewStyles(styles.statCard, statCardDyn, isWide && styles.statCardLg)}>
                <Text style={styles.statLbl}>Rounds</Text>
                <Text style={[styles.statVal, isWide && styles.statValLg]}>{stats.roundsN}</Text>
                <Text style={styles.statSub}>Logged</Text>
              </View>
              <View style={mergeViewStyles(styles.statCard, statCardDyn, isWide && styles.statCardLg)}>
                <Text style={styles.statLbl}>Best diff.</Text>
                <Text style={[styles.statVal, isWide && styles.statValLg]}>
                  {formatDifferentialDisplay(stats.bestDiff)}
                </Text>
                <Text style={[styles.statSub, { color: colors.subtle }]} numberOfLines={1}>
                  {stats.bestCourse || '—'}
                </Text>
              </View>
              <View style={mergeViewStyles(styles.statCard, statCardDyn, isWide && styles.statCardLg)}>
                <Text style={styles.statLbl}>Avg score</Text>
                <Text style={[styles.statVal, isWide && styles.statValLg]}>
                  {stats.avg != null ? stats.avg : '—'}
                </Text>
                <Text style={styles.statSub}>Gross</Text>
              </View>
            </View>
            <View style={[styles.listCard, { marginTop: 12 }]}>
              <View style={styles.listCardContent}>{roundList}</View>
            </View>
          </View>
        )}
        </Fragment>
        </ScrollView>
      </ContentWidth>
    </View>
  );
}

const webCardShadow = Platform.OS === 'web' ? { boxShadow: '0 2px 16px rgba(26,26,26,0.08)' } : {};
const webCtaShadow = Platform.OS === 'web' ? { boxShadow: '0 2px 14px rgba(29,158,117,0.14)' } : {};

const styles = StyleSheet.create({
  pageRoot: { flex: 1, width: '100%', minHeight: 0, backgroundColor: colors.bg },
  screen: { flex: 1, minHeight: 0, backgroundColor: colors.bg, width: '100%' },
  homeBody: {
    width: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
  },
  hero: { backgroundColor: colors.header, width: '100%' },
  heroBrandRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 10,
    gap: 12,
  },
  /** Keeps wordmark from stretching over the Instagram control (`heroLogo` is width 100% of this box). */
  heroLogoWrap: {
    flex: 1,
    minWidth: 0,
    maxWidth: 268,
    alignSelf: 'flex-start',
  },
  heroLogoWrapWide: { maxWidth: 300 },
  /** Vector wordmark, transparent — scales with width; height from aspect ratio. */
  heroLogo: {
    width: '100%',
    alignSelf: 'flex-start',
  },
  heroBlock: { width: '100%' },
  heroGreet: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.52)', marginBottom: 6, letterSpacing: 1.4 },
  heroGreetLg: { fontSize: 11, letterSpacing: 1.6 },
  heroName: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 4 },
  heroNameLg: { fontSize: 24 },
  indexRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 10 },
  indexRowWrap: { flexWrap: 'wrap', alignItems: 'baseline' },
  indexNum: { fontSize: 44, fontWeight: '700', color: '#fff', lineHeight: 48 },
  indexNumLg: { fontSize: 52, lineHeight: 56 },
  indexNumXL: { fontSize: 58, lineHeight: 62 },
  indexLblCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 5,
    flexShrink: 1,
    minWidth: 0,
  },
  indexLbl: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    flexShrink: 1,
  },
  indexLblLg: { fontSize: 13 },
  indexInfoBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: 'rgba(255,255,255,0.14)',
    flexShrink: 0,
    ...Platform.select({
      web: { cursor: 'pointer' as const },
      default: {},
    }),
  },
  indexInfoBtnTxt: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.92)', lineHeight: 12 },
  indexFoot: {
    marginTop: 10,
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    lineHeight: 16,
    maxWidth: '100%',
  },
  indexFootLg: { fontSize: 12, lineHeight: 17 },
  indexFootMuted: { color: 'rgba(255,255,255,0.35)' },
  /** Matches log round differential info sheets (bottom sheet + dim backdrop). */
  infoModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  infoModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  infoModalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  infoModalTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: colors.ink },
  infoModalBody: { fontSize: 14, lineHeight: 21, color: colors.ink },
  listCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    /**
     * Web: overflow visible lets text paint outside the card but those pixels do not expand
     * ScrollView scrollHeight — content ends up under the tab bar. Keep hidden + inner padding.
     */
    overflow: 'hidden',
    ...webCardShadow,
  },
  /** Inner wrapper: horizontal inset here (not on each row) keeps scores inside the white card on all platforms. */
  listCardContent: {
    flexDirection: 'column',
    alignItems: 'stretch',
    alignSelf: 'stretch',
    paddingHorizontal: RECENT_LIST_INSET,
    paddingBottom: 56,
    width: '100%',
    maxWidth: '100%',
  },
  latestCard: {
    position: 'relative',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 14,
    overflow: 'hidden',
    ...webCardShadow,
  },
  /**
   * Absolutely positioned so narrow/web layouts never wrap the chevron onto a second row
   * (marginLeft:auto was dropping it below the text block).
   */
  latestChevron: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    width: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  latestIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  /** Reserve space for latestChevron so long meta lines don’t run under the arrow. */
  latestBody: { flex: 1, minWidth: 0, paddingRight: 32 },
  latestKicker: { fontSize: 10, fontWeight: '700', color: colors.sage, textTransform: 'uppercase', letterSpacing: 1 },
  latestTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginTop: 5 },
  latestMeta: { fontSize: 12, color: colors.muted, marginTop: 5, lineHeight: 17 },
  ctaCard: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.accent,
    padding: 14,
    ...webCtaShadow,
  },
  ctaTitle: { fontSize: 15, fontWeight: '700', color: colors.header },
  ctaSub: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17 },
  badge: {
    marginTop: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.sage,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.header },
  badgeTxt: { fontSize: 11, fontWeight: '700', color: '#fff', flexShrink: 1 },
  /**
   * stretch: gives splitRight a real height (max of columns). With alignItems flex-start,
   * the right column stayed “content-sized” while sideCard used flex:1 → broken height on web/native.
   */
  splitRow: { flexDirection: 'row', alignItems: 'stretch', width: '100%' },
  splitLeft: { flex: 1, minWidth: 0 },
  splitRight: { flexShrink: 0, alignSelf: 'stretch' },
  /** Recent rounds in split layout: fill stretched column (same surface as stacked listCard). */
  splitListCard: { flex: 1, width: '100%', minWidth: 0 },
  statsRow: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'stretch',
  },
  statCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
    minWidth: 0,
  },
  statCardLg: { paddingVertical: 16, paddingHorizontal: 14 },
  statLbl: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.subtle,
    marginBottom: 5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statVal: { fontSize: 17, fontWeight: '700', color: colors.ink },
  statValLg: { fontSize: 19 },
  statSub: { fontSize: 10, fontWeight: '600', color: colors.sage, marginTop: 5 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 10,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  sectionTitleLg: { fontSize: 15 },
  analyzeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 4,
  },
  analyzeLinkTxt: { fontSize: 12, fontWeight: '700', color: colors.sage },
  /** Block wrapper so each Link/row participates in column height on web + native. */
  roundRowOuter: {
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
    flexShrink: 0,
  },
  /** Air between the prior round’s meta and the next row’s course / Trackman line. */
  roundRowGapBefore: { marginTop: 12 },
  roundRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    alignSelf: 'stretch',
    paddingVertical: 20,
    backgroundColor: colors.surface,
    maxWidth: '100%',
  },
  roundRowFlagIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  roundRowBorder: { borderTopWidth: 0.5, borderTopColor: colors.border },
  roundRowPressed: { backgroundColor: colors.accentSoft },
  /** Course + meta beside score + diff so the right column can stretch to meta height only. */
  roundRowMain: {
    flex: 1,
    minWidth: 0,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  /** flex:1 + fixed score column — predictable gutters vs percentage maxWidth. */
  roundInfo: {
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  roundCourse: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
    lineHeight: 17,
  },
  roundCourseLg: { fontSize: 14, lineHeight: 20 },
  roundMeta: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.subtle,
    marginTop: 4,
    lineHeight: 15,
  },
  roundMetaLg: { fontSize: 12, lineHeight: 16 },
  /**
   * space-between: score with course (top), diff with bottom of meta (incl. 2-line wrap).
   * No fixed width — 76px clipped bold “72” / “diff -0.9” under overflow:hidden. Size to content + inner pad.
   */
  roundRight: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    flexShrink: 0,
    flexGrow: 0,
    paddingLeft: 6,
    /** Extra cushion; outer inset is on listCardContent — this balances “Analyze” tap padding visually. */
    paddingRight: 2,
  },
  roundScore: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
    lineHeight: 17,
    textAlign: 'right',
    flexShrink: 0,
  },
  roundScoreLg: { fontSize: 16, lineHeight: 20 },
  roundDiff: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.sage,
    lineHeight: 14,
    textAlign: 'right',
    flexShrink: 0,
  },
  emptyRounds: { paddingVertical: 12, fontSize: 13, color: colors.muted },
});
