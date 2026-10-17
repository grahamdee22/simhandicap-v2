import { Link, useRouter, type Href } from 'expo-router';
import { Fragment, useMemo, useState } from 'react';
import { Modal, Platform, Pressable as RNPressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TFunction } from 'i18next';
import { ContentWidth } from '../../src/components/ContentWidth';
import { PendingTournamentHolesBanner } from '../../src/components/PendingTournamentHolesBanner';
import { HomeHeroInstagramButton } from '../../src/components/HeaderInstagramSimCap';
import { RoundListRow } from '../../src/components/RoundListRow';
import { ShareRoundCardModal } from '../../src/components/ShareCard';
import { IconChevronForward, IconGolf } from '../../src/components/SvgUiIcons';
import { SimCapLogoHero, SIM_CAP_LOGO_ASPECT } from '../../src/components/SimCapLogoHero';
import { useTranslation } from '../../src/i18n';
import { colors } from '../../src/lib/constants';
import { formatDifferentialDisplay, formatHandicapIndexDisplay, indexHistoryFromRounds } from '../../src/lib/handicap';
import { mergeViewStyles } from '../../src/lib/mergeStyles';
import { useResponsive } from '../../src/lib/responsive';
import {
  currentIndexFromRounds,
  useAppStore,
  type SimRound,
} from '../../src/store/useAppStore';

function greetingFromHour(h: number, t: TFunction): string {
  if (h < 12) return t('home.greeting.morning');
  if (h < 17) return t('home.greeting.afternoon');
  return t('home.greeting.evening');
}

function trendBadge(rounds: SimRound[], t: TFunction): string | null {
  const hist = indexHistoryFromRounds(
    [...rounds].map((r) => ({ playedAt: r.playedAt, adjustedDiff: r.adjustedDiff }))
  );
  if (hist.length < 2) return null;
  const now = hist[hist.length - 1].index;
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const past = [...hist].filter((h) => new Date(h.date).getTime() <= monthAgo).pop();
  if (!past) return null;
  const d = now - past.index;
  if (Math.abs(d) < 0.05) return t('home.trend.flat');
  if (d < 0) return t('home.trend.down', { value: Math.abs(d).toFixed(1) });
  return t('home.trend.up', { value: d.toFixed(1) });
}

/** In-card horizontal padding (matches latest row); body uses `gutter` for outer alignment only. */
const CARD_INNER_PAD = 14;
/** Recent rounds list: one inset on the card content wrapper so rows/links can’t paint past it. */
const RECENT_LIST_INSET = 18;

export default function HomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const {
    gutter,
    isWide,
    isVeryWide,
    isCompactHome,
  } = useResponsive();
  const router = useRouter();
  const rounds = useAppStore((s) => s.rounds);
  const displayName = useAppStore((s) => s.displayName);
  const [indexInfoOpen, setIndexInfoOpen] = useState(false);
  const [shareRoundId, setShareRoundId] = useState<string | null>(null);
  const shareRound = useMemo(
    () => (shareRoundId ? rounds.find((r) => r.id === shareRoundId) ?? null : null),
    [rounds, shareRoundId]
  );

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

  const badge = trendBadge(rounds, t);
  const latest = rounds[0];
  const heroPadTop = Math.max(insets.top, 12) + 4;
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
        <Text style={[styles.sectionTitle, isWide && styles.sectionTitleLg]}>{t('home.recentRounds')}</Text>
        <Link href="/(tabs)/analyze" asChild>
          <Pressable style={styles.analyzeLink}>
            <Text style={styles.analyzeLinkTxt}>{t('home.analyze')}</Text>
            <IconChevronForward size={14} color={colors.sage} />
          </Pressable>
        </Link>
      </View>
      {rounds.length === 0 ? (
        <Text style={styles.emptyRounds}>
          {t('home.emptyRounds')}
        </Text>
      ) : (
        rounds.slice(0, 8).map((r, idx) => (
          <RoundListRow
            key={r.id}
            round={r}
            isWide={isWide}
            showTopBorder={idx > 0}
            onPress={() => router.push(`/round/${r.id}`)}
            onShare={() => setShareRoundId(r.id)}
          />
        ))
      )}
    </>
  );

  const statsTiles = (
    <View style={statsRowStyle}>
      <View style={mergeViewStyles(styles.statCard, statCardDyn, isWide && styles.statCardLg)}>
        <Text style={styles.statLbl}>{t('home.stats.rounds')}</Text>
        <Text style={[styles.statVal, isWide && styles.statValLg]}>{stats.roundsN}</Text>
        <Text style={styles.statSub}>{t('home.stats.logged')}</Text>
      </View>
      <View style={mergeViewStyles(styles.statCard, statCardDyn, isWide && styles.statCardLg)}>
        <Text style={styles.statLbl}>{t('home.stats.bestDiff')}</Text>
        <Text style={[styles.statVal, isWide && styles.statValLg]}>
          {formatDifferentialDisplay(stats.bestDiff)}
        </Text>
        <Text style={[styles.statSub, { color: colors.subtle }]} numberOfLines={1}>
          {stats.bestCourse || '—'}
        </Text>
      </View>
      <View style={mergeViewStyles(styles.statCard, statCardDyn, isWide && styles.statCardLg)}>
        <Text style={styles.statLbl}>{t('home.stats.avgScore')}</Text>
        <Text style={[styles.statVal, isWide && styles.statValLg]}>
          {stats.avg != null ? stats.avg : '—'}
        </Text>
        <Text style={styles.statSub}>{t('home.stats.gross')}</Text>
      </View>
    </View>
  );

  /**
   * The tab bar is laid out in flow (never `position: absolute`), so the scene already stops
   * above it and its safe-area padding covers the home indicator. Adding tab bar height here
   * only buys a dead white band under the last round — this is pure end-of-list breathing room.
   */
  const scrollBelowContent = 16;

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
            {greetingFromHour(new Date().getHours(), t).toUpperCase()}
          </Text>
          <Text style={[styles.heroName, isWide && styles.heroNameLg]}>{displayName}</Text>
        </View>
        <View style={[styles.indexRow, isCompactHome && styles.indexRowWrap]}>
          <Text style={[styles.indexNum, isWide && styles.indexNumLg, isVeryWide && styles.indexNumXL]}>
            {formatHandicapIndexDisplay(index)}
          </Text>
          <View style={styles.indexLblCluster}>
            <Text style={[styles.indexLbl, isWide && styles.indexLblLg]}>{t('home.indexLabel')}</Text>
            <RNPressable
              style={styles.indexInfoBtn}
              onPress={() => setIndexInfoOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('home.indexInfoA11y')}
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
            {t('home.indexFoot', { count: rounds.length })}
          </Text>
        ) : (
          <Text style={[styles.indexFoot, styles.indexFootMuted]}>
            {t('home.indexFootEmpty')}
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
            <Text style={styles.infoModalTitle}>{t('home.indexInfoTitle')}</Text>
            <Text style={styles.infoModalBody}>
              {t('home.indexInfoBody')}
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
        <PendingTournamentHolesBanner gutter={gutter} />
        <Fragment>
          <View style={[styles.homeBody, { paddingHorizontal: gutter }]}>
            <View style={styles.statsTilesBlock}>{statsTiles}</View>
            {latest ? (
              <Link href={`/round/${latest.id}`} asChild>
                <Pressable
                  style={styles.latestCard}
                  accessibilityRole="button"
                  accessibilityLabel={t('home.latestRoundA11y')}
                >
                  <View style={styles.latestIcon}>
                    <IconGolf size={20} color={colors.sage} />
                  </View>
                  <View style={styles.latestBody}>
                    <Text style={styles.latestKicker}>{t('home.latestRound')}</Text>
                    <Text style={styles.latestTitle} numberOfLines={1}>
                      {latest.courseName}
                    </Text>
                    <Text style={styles.latestMeta} numberOfLines={2}>
                      {[
                        new Date(latest.playedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        }),
                        t('home.latestGross', { score: latest.grossScore }),
                        ...(latest.holesPlayed === 'front'
                          ? [t('home.latestFront9')]
                          : latest.holesPlayed === 'back'
                            ? [t('home.latestBack9')]
                            : []),
                        t('home.latestDiff', { value: formatDifferentialDisplay(latest.adjustedDiff) }),
                      ].join(' · ')}
                    </Text>
                  </View>
                  <View style={styles.latestChevron} pointerEvents="none">
                    <IconChevronForward size={20} color={colors.subtle} />
                  </View>
                </Pressable>
              </Link>
            ) : (
              <Link href={'/(tabs)/log/round' as Href} asChild>
                <Pressable style={styles.ctaCard}>
                  <Text style={styles.ctaTitle}>{t('home.ctaTitle')}</Text>
                  <Text style={styles.ctaSub}>
                    {t('home.ctaSub')}
                  </Text>
                </Pressable>
              </Link>
            )}
            <View style={[styles.listCard, { marginTop: 12 }]}>
              <View style={styles.listCardContent}>{roundList}</View>
            </View>
          </View>
        </Fragment>
        </ScrollView>
        <ShareRoundCardModal
          visible={!!shareRound}
          round={shareRound}
          onClose={() => setShareRoundId(null)}
        />
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
    paddingBottom: 12,
    width: '100%',
    maxWidth: '100%',
  },
  /**
   * Gap down to the Latest round / CTA card; matches listCard's marginTop so both card gaps match.
   * Children of `<Link asChild>` must keep a plain-object `style` — expo-router's Slot merges via
   * Radix mergeProps (`{ ...slotStyle, ...childStyle }`), which spreads a function style into `{}`
   * and silently drops the whole card (padding, border, flexDirection).
   */
  statsTilesBlock: { marginTop: 8, marginBottom: 12 },
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
  emptyRounds: { paddingVertical: 12, fontSize: 13, color: colors.muted },
});
