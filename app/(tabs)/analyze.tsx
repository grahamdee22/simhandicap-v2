import { Link } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentWidth } from '../../src/components/ContentWidth';
import { IconAnalyticsBars, IconCalendarOutline } from '../../src/components/SvgUiIcons';
import { colors, PLATFORMS, type PlatformId } from '../../src/lib/constants';
import { type Mulligans, type PinDay, type PuttingMode, type Wind } from '../../src/lib/handicap';
import { mergeViewStyles } from '../../src/lib/mergeStyles';
import { useResponsive } from '../../src/lib/responsive';
import { formatRoundMeta, useAppStore, type SimRound } from '../../src/store/useAppStore';

type RoundFilters = {
  putting: PuttingMode | null;
  pin: PinDay | null;
  wind: Wind | null;
  mulligans: Mulligans | null;
  platform: PlatformId | null;
};

const EMPTY_FILTERS: RoundFilters = {
  putting: null,
  pin: null,
  wind: null,
  mulligans: null,
  platform: null,
};

const PUTTING_FILTER_OPTS: { key: PuttingMode | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'auto_2putt', label: 'Auto 2-putt' },
  { key: 'gimme_5', label: 'Gimme' },
  { key: 'putt_all', label: 'Full' },
];

const PIN_FILTER_OPTS: { key: PinDay | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

const WIND_FILTER_OPTS: { key: Wind | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'off', label: 'Off' },
  { key: 'light', label: 'Light' },
  { key: 'strong', label: 'Strong' },
];

const MULL_FILTER_OPTS: { key: Mulligans | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'on', label: 'On' },
  { key: 'off', label: 'Off' },
];

const PLATFORM_FILTER_OPTS: { key: PlatformId | null; label: string }[] = [
  { key: null, label: 'All' },
  ...PLATFORMS.map((p) => ({ key: p, label: p })),
];

function matchesRoundFilters(r: SimRound, f: RoundFilters): boolean {
  if (f.putting != null && r.putting !== f.putting) return false;
  if (f.pin != null && r.pin !== f.pin) return false;
  if (f.wind != null && r.wind !== f.wind) return false;
  if (f.mulligans != null && r.mulligans !== f.mulligans) return false;
  if (f.platform != null && r.platform !== f.platform) return false;
  return true;
}

function filtersActive(f: RoundFilters): boolean {
  return f.putting != null || f.pin != null || f.wind != null || f.mulligans != null || f.platform != null;
}

/** Filter strip UI tokens (spec: dark chips, light “All”, sage accent). */
const F = {
  dark: '#1a3d2b',
  lightBg: '#f0f7f4',
  lightBorder: '#52b788',
  accent: '#52b788',
} as const;

function labelForPutting(k: PuttingMode | null) {
  return PUTTING_FILTER_OPTS.find((o) => o.key === k)?.label ?? 'All';
}
function labelForPin(k: PinDay | null) {
  return PIN_FILTER_OPTS.find((o) => o.key === k)?.label ?? 'All';
}
function labelForWind(k: Wind | null) {
  return WIND_FILTER_OPTS.find((o) => o.key === k)?.label ?? 'All';
}
function labelForMull(k: Mulligans | null) {
  return MULL_FILTER_OPTS.find((o) => o.key === k)?.label ?? 'All';
}
function labelForPlatform(k: PlatformId | null) {
  return PLATFORM_FILTER_OPTS.find((o) => o.key === k)?.label ?? 'All';
}

export default function AnalyzeScreen() {
  const insets = useSafeAreaInsets();
  const { gutter, maxContent, homeSplit, isWide, isVeryWide } = useResponsive();
  const rounds = useAppStore((s) => s.rounds);
  const [filters, setFilters] = useState<RoundFilters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<RoundFilters>(EMPTY_FILTERS);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const filteredRounds = useMemo(
    () => rounds.filter((r) => matchesRoundFilters(r, filters)),
    [rounds, filters]
  );

  const filterOn = filtersActive(filters);
  const rightColW = Math.min(420, Math.floor(maxContent * 0.4));

  const listStats = useMemo(() => {
    if (filteredRounds.length === 0) {
      return { roundsN: 0, bestDiff: null as number | null, bestCourse: '', avg: null as number | null };
    }
    const best = [...filteredRounds].sort((a, b) => a.adjustedDiff - b.adjustedDiff)[0];
    const avg = filteredRounds.reduce((s, r) => s + r.grossScore, 0) / filteredRounds.length;
    return {
      roundsN: filteredRounds.length,
      bestDiff: best.adjustedDiff,
      bestCourse: best.courseName,
      avg: Math.round(avg * 10) / 10,
    };
  }, [filteredRounds]);

  const statsRowStyle = useMemo(
    () =>
      mergeViewStyles(styles.statsRow, {
        paddingHorizontal: gutter,
        gap: isVeryWide ? 12 : isWide ? 8 : 6,
        paddingTop: isWide ? 14 : 10,
      }),
    [gutter, isWide, isVeryWide]
  );

  const openFilterPanel = useCallback(() => {
    setDraftFilters({ ...filters });
    setFiltersExpanded(true);
  }, [filters]);

  const applyFilters = useCallback(() => {
    setFilters({ ...draftFilters });
    setFiltersExpanded(false);
  }, [draftFilters]);

  const resetAllFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setDraftFilters(EMPTY_FILTERS);
    setFiltersExpanded(false);
  }, []);

  const removeFilter = useCallback((dim: keyof RoundFilters) => {
    setFilters((prev) => ({ ...prev, [dim]: null }));
    setDraftFilters((prev) => ({ ...prev, [dim]: null }));
  }, []);

  const activeFilterChips = useMemo(() => {
    const out: { dim: keyof RoundFilters; label: string }[] = [];
    if (filters.putting != null) {
      out.push({ dim: 'putting', label: `Putting · ${labelForPutting(filters.putting)}` });
    }
    if (filters.pin != null) {
      out.push({ dim: 'pin', label: `Pin · ${labelForPin(filters.pin)}` });
    }
    if (filters.wind != null) {
      out.push({ dim: 'wind', label: `Wind · ${labelForWind(filters.wind)}` });
    }
    if (filters.mulligans != null) {
      out.push({ dim: 'mulligans', label: `Mulligans · ${labelForMull(filters.mulligans)}` });
    }
    if (filters.platform != null) {
      out.push({ dim: 'platform', label: `Platform · ${labelForPlatform(filters.platform)}` });
    }
    return out;
  }, [filters]);

  const filterPanel =
    rounds.length > 0 ? (
      <View style={[styles.filterShell, { marginHorizontal: gutter }]}>
        <View style={styles.filterCollapsed}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterChipScrollContent}
          >
            {activeFilterChips.map((c) => (
              <View key={c.dim} style={styles.appliedChip}>
                <Text style={styles.appliedChipTxt} numberOfLines={1}>
                  {c.label}
                </Text>
                <Pressable
                  onPress={() => removeFilter(c.dim)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${c.label}`}
                >
                  <Text style={styles.appliedChipX}>×</Text>
                </Pressable>
              </View>
            ))}
            {!filtersExpanded ? (
              <Pressable
                onPress={openFilterPanel}
                style={styles.addFilterBtn}
                accessibilityRole="button"
                accessibilityLabel="Add filter"
              >
                <Text style={styles.addFilterBtnTxt}>+ Add filter</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>

        {filtersExpanded ? (
          <View style={styles.filterExpanded}>
            <View style={styles.filterExpandedTop}>
              <Text style={styles.filterExpandedTitle}>Filters</Text>
              <Pressable onPress={resetAllFilters} hitSlop={8}>
                <Text style={styles.resetAllTxt}>Reset all</Text>
              </Pressable>
            </View>
            <Text style={styles.filterHint}>
              KPIs and matching rounds use this subset. Home still uses every round.
            </Text>

            <Text style={[styles.fCatLabel, styles.fCatFirst]}>Putting</Text>
            <View style={styles.fPillRow}>
              {PUTTING_FILTER_OPTS.map((o) => {
                const sel = draftFilters.putting === o.key;
                const isAll = o.key === null;
                return (
                  <Pressable
                    key={`p-${o.key ?? 'all'}`}
                    onPress={() => setDraftFilters((p) => ({ ...p, putting: o.key }))}
                    style={[
                      styles.fPanelPill,
                      sel && isAll && styles.fPanelPillLight,
                      sel && !isAll && styles.fPanelPillDark,
                    ]}
                  >
                    <Text
                      style={[
                        styles.fPanelPillTxt,
                        sel && isAll && styles.fPanelPillTxtLight,
                        sel && !isAll && styles.fPanelPillTxtDark,
                      ]}
                      numberOfLines={1}
                    >
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fCatLabel}>Pin</Text>
            <View style={styles.fPillRow}>
              {PIN_FILTER_OPTS.map((o) => {
                const sel = draftFilters.pin === o.key;
                const isAll = o.key === null;
                return (
                  <Pressable
                    key={`pin-${o.key ?? 'all'}`}
                    onPress={() => setDraftFilters((p) => ({ ...p, pin: o.key }))}
                    style={[
                      styles.fPanelPill,
                      sel && isAll && styles.fPanelPillLight,
                      sel && !isAll && styles.fPanelPillDark,
                    ]}
                  >
                    <Text
                      style={[
                        styles.fPanelPillTxt,
                        sel && isAll && styles.fPanelPillTxtLight,
                        sel && !isAll && styles.fPanelPillTxtDark,
                      ]}
                      numberOfLines={1}
                    >
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fCatLabel}>Wind</Text>
            <View style={styles.fPillRow}>
              {WIND_FILTER_OPTS.map((o) => {
                const sel = draftFilters.wind === o.key;
                const isAll = o.key === null;
                return (
                  <Pressable
                    key={`w-${o.key ?? 'all'}`}
                    onPress={() => setDraftFilters((p) => ({ ...p, wind: o.key }))}
                    style={[
                      styles.fPanelPill,
                      sel && isAll && styles.fPanelPillLight,
                      sel && !isAll && styles.fPanelPillDark,
                    ]}
                  >
                    <Text
                      style={[
                        styles.fPanelPillTxt,
                        sel && isAll && styles.fPanelPillTxtLight,
                        sel && !isAll && styles.fPanelPillTxtDark,
                      ]}
                      numberOfLines={1}
                    >
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fCatLabel}>Mulligans</Text>
            <View style={styles.fPillRow}>
              {MULL_FILTER_OPTS.map((o) => {
                const sel = draftFilters.mulligans === o.key;
                const isAll = o.key === null;
                return (
                  <Pressable
                    key={`m-${o.key ?? 'all'}`}
                    onPress={() => setDraftFilters((p) => ({ ...p, mulligans: o.key }))}
                    style={[
                      styles.fPanelPill,
                      sel && isAll && styles.fPanelPillLight,
                      sel && !isAll && styles.fPanelPillDark,
                    ]}
                  >
                    <Text
                      style={[
                        styles.fPanelPillTxt,
                        sel && isAll && styles.fPanelPillTxtLight,
                        sel && !isAll && styles.fPanelPillTxtDark,
                      ]}
                      numberOfLines={1}
                    >
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fCatLabel}>Platform</Text>
            <View style={styles.fPillRow}>
              {PLATFORM_FILTER_OPTS.map((o) => {
                const sel = draftFilters.platform === o.key;
                const isAll = o.key === null;
                return (
                  <Pressable
                    key={`plat-${o.key ?? 'all'}`}
                    onPress={() => setDraftFilters((p) => ({ ...p, platform: o.key }))}
                    style={[
                      styles.fPanelPill,
                      sel && isAll && styles.fPanelPillLight,
                      sel && !isAll && styles.fPanelPillDark,
                    ]}
                  >
                    <Text
                      style={[
                        styles.fPanelPillTxt,
                        sel && isAll && styles.fPanelPillTxtLight,
                        sel && !isAll && styles.fPanelPillTxtDark,
                      ]}
                      numberOfLines={1}
                    >
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable onPress={applyFilters} style={styles.applyFiltersBtn}>
              <Text style={styles.applyFiltersBtnTxt}>Apply filters</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    ) : null;

  const kpiCaption =
    rounds.length > 0 ? (
      <Text
        style={[
          styles.kpiCaption,
          { paddingHorizontal: gutter, marginTop: 6, marginBottom: filterOn ? 2 : 8 },
        ]}
      >
        {filterOn
          ? `Rounds / best diff / avg score: ${filteredRounds.length} match${filteredRounds.length === 1 ? '' : 'es'}.`
          : 'Rounds / best diff / avg score: all logged rounds.'}
      </Text>
    ) : null;

  const statsBlock = (
    <>
      <View style={statsRowStyle}>
        <View style={[styles.statCard, isWide && styles.statCardLg]}>
          <Text style={styles.statLbl}>Rounds</Text>
          <Text style={[styles.statVal, isWide && styles.statValLg]}>{listStats.roundsN}</Text>
          <Text style={styles.statSub}>In subset</Text>
        </View>
        <View style={[styles.statCard, isWide && styles.statCardLg]}>
          <Text style={styles.statLbl}>Best diff.</Text>
          <Text style={[styles.statVal, isWide && styles.statValLg]}>
            {listStats.bestDiff != null ? listStats.bestDiff.toFixed(1) : '—'}
          </Text>
          <Text style={[styles.statSub, { color: colors.subtle }]} numberOfLines={1}>
            {listStats.bestCourse || '—'}
          </Text>
        </View>
        <View style={[styles.statCard, isWide && styles.statCardLg]}>
          <Text style={styles.statLbl}>Avg score</Text>
          <Text style={[styles.statVal, isWide && styles.statValLg]}>
            {listStats.avg != null ? listStats.avg : '—'}
          </Text>
          <Text style={styles.statSub}>Gross</Text>
        </View>
      </View>
      {kpiCaption}
    </>
  );

  const roundList = (
    <>
      <View style={[styles.sectionHead, { paddingHorizontal: gutter }]}>
        <Text style={[styles.sectionTitle, isWide && styles.sectionTitleLg]}>Matching rounds</Text>
      </View>
      {rounds.length === 0 ? (
        <Text style={[styles.emptyRounds, { paddingHorizontal: gutter }]}>
          No rounds yet. Log a round from the Log tab, then come back here to explore trends by conditions.
        </Text>
      ) : filteredRounds.length === 0 ? (
        <Text style={[styles.emptyRounds, { paddingHorizontal: gutter }]}>
          No rounds match these filters. Adjust filters above or tap Reset all.
        </Text>
      ) : (
        filteredRounds.map((r) => (
          <Link key={r.id} href={`/round/${r.id}`} asChild>
            <Pressable style={mergeViewStyles(styles.roundRow, { paddingHorizontal: gutter })}>
              <View style={styles.roundIcon}>
                <IconCalendarOutline size={isWide ? 18 : 16} color={colors.subtle} />
              </View>
              <View style={styles.roundInfo}>
                <Text style={[styles.roundCourse, isWide && styles.roundCourseLg]} numberOfLines={1}>
                  {r.courseName}
                </Text>
                <Text style={[styles.roundMeta, isWide && styles.roundMetaLg]} numberOfLines={2}>
                  {formatRoundMeta(r)}
                </Text>
              </View>
              <View style={styles.roundRight}>
                <Text style={[styles.roundScore, isWide && styles.roundScoreLg]}>{r.grossScore}</Text>
                <Text style={styles.roundDiff}>diff {r.adjustedDiff.toFixed(1)}</Text>
              </View>
            </Pressable>
          </Link>
        ))
      )}
    </>
  );

  const introPadTop = Math.max(insets.top, 8) + 4;

  return (
    <ContentWidth>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
      >
        <View style={[styles.intro, { paddingTop: introPadTop, paddingHorizontal: gutter, paddingBottom: 14 }]}>
          <View style={styles.introIconWrap}>
            <IconAnalyticsBars size={22} color={colors.sage} />
          </View>
          <Text style={[styles.introTitle, isWide && styles.introTitleLg]}>Round analysis</Text>
          <Text style={styles.introSub}>
            Filter by how you played the sim (putting, pins, wind, etc.) and compare scores and differentials for that
            slice of your history.
          </Text>
        </View>

        {homeSplit ? (
          <View style={[styles.splitRow, { paddingHorizontal: gutter, gap: gutter }]}>
            <View style={[styles.splitLeft, { minWidth: 0 }]}>
              {filterPanel}
              {statsBlock}
            </View>
            <View style={[styles.splitRight, { width: rightColW }]}>
              <View style={styles.sideCard}>{roundList}</View>
            </View>
          </View>
        ) : (
          <>
            {filterPanel}
            {statsBlock}
            <View
              style={[
                styles.listCard,
                { marginHorizontal: gutter, marginTop: 12 },
              ]}
            >
              {roundList}
            </View>
          </>
        )}
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, backgroundColor: colors.bg, width: '100%' },
  intro: {
    backgroundColor: colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
    width: '100%',
  },
  introIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  introTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
  introTitleLg: { fontSize: 20 },
  introSub: { fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 17, maxWidth: 520 },
  splitRow: { flexDirection: 'row', alignItems: 'flex-start', width: '100%', marginTop: 8 },
  splitLeft: { flex: 1 },
  splitRight: { flexShrink: 0 },
  sideCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.border,
    overflow: 'hidden',
    flex: 1,
  },
  listCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  statsRow: {
    flexDirection: 'row',
    width: '100%',
  },
  statCard: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 10, borderWidth: 0.5, borderColor: colors.border },
  statCardLg: { padding: 12, borderRadius: 10 },
  statLbl: { fontSize: 9, fontWeight: '700', color: colors.subtle, marginBottom: 3, letterSpacing: 0.4 },
  statVal: { fontSize: 16, fontWeight: '700', color: colors.ink },
  statValLg: { fontSize: 18 },
  statSub: { fontSize: 9, fontWeight: '600', color: colors.sage, marginTop: 1 },
  filterShell: { marginTop: 8 },
  filterCollapsed: { minHeight: 40, justifyContent: 'center' },
  filterChipScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: 8,
    paddingVertical: 4,
  },
  appliedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: F.dark,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 8,
    borderRadius: 999,
    maxWidth: 280,
  },
  appliedChipTxt: { fontSize: 12, fontWeight: '600', color: '#fff', flexShrink: 1 },
  appliedChipX: { fontSize: 18, fontWeight: '500', color: 'rgba(255,255,255,0.85)', lineHeight: 20 },
  addFilterBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: F.lightBorder,
    backgroundColor: F.lightBg,
  },
  addFilterBtnTxt: { fontSize: 12, fontWeight: '700', color: F.accent },
  filterExpanded: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    marginTop: 4,
  },
  filterExpandedTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  filterExpandedTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  resetAllTxt: { fontSize: 13, fontWeight: '700', color: F.accent },
  filterHint: { fontSize: 10, color: colors.muted, lineHeight: 14, marginBottom: 10 },
  fCatLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.subtle,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 8,
  },
  fCatFirst: { marginTop: 2 },
  fPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fPanelPill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
  },
  fPanelPillLight: {
    backgroundColor: F.lightBg,
    borderColor: F.lightBorder,
  },
  fPanelPillDark: {
    backgroundColor: F.dark,
    borderColor: F.dark,
  },
  fPanelPillTxt: { fontSize: 12, fontWeight: '600', color: colors.muted },
  fPanelPillTxtLight: { color: F.accent },
  fPanelPillTxtDark: { color: '#fff' },
  applyFiltersBtn: {
    marginTop: 18,
    backgroundColor: F.dark,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  applyFiltersBtnTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
  kpiCaption: { fontSize: 10, color: colors.subtle, lineHeight: 14 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 6,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.ink },
  sectionTitleLg: { fontSize: 14 },
  roundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  roundIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundInfo: { flex: 1, minWidth: 0 },
  roundCourse: { fontSize: 12, fontWeight: '700', color: colors.ink },
  roundCourseLg: { fontSize: 14 },
  roundMeta: { fontSize: 10, fontWeight: '600', color: colors.subtle, marginTop: 1 },
  roundMetaLg: { fontSize: 11 },
  roundRight: { alignItems: 'flex-end' },
  roundScore: { fontSize: 14, fontWeight: '700', color: colors.ink },
  roundScoreLg: { fontSize: 16 },
  roundDiff: { fontSize: 10, fontWeight: '600', color: colors.sage },
  emptyRounds: { paddingVertical: 12, fontSize: 13, color: colors.muted },
});
