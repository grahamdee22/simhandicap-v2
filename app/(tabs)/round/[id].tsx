import { useFocusEffect } from '@react-navigation/native';
import { Link, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import {
  Alert,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconTrashOutline } from '../../../src/components/SvgUiIcons';
import { showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { mergeViewStyles } from '../../../src/lib/mergeStyles';
import { useResponsive } from '../../../src/lib/responsive';
import { formatHandicapIndexDisplay, scoreToParStyle } from '../../../src/lib/handicap';
import { getCourseById } from '../../../src/lib/courses';
import { useAppStore, type SimRound } from '../../../src/store/useAppStore';

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
    { text: 'Cancel', style: 'cancel' },
    { text: destructiveLabel, style: 'destructive', onPress: onConfirm },
  ]);
}

function pinLabel(pin: SimRound['pin']): string {
  const m = { thu: 'Thursday · R1', fri: 'Friday · R2', sat: 'Saturday · R3', sun: 'Sunday · R4' };
  return m[pin];
}

function puttingLabel(p: SimRound['putting']): string {
  if (p === 'auto_2putt') return 'Auto 2-putt';
  if (p === 'gimme_5') return 'Gimme <5ft';
  return 'Putt everything';
}

function windLabel(w: SimRound['wind']): string {
  if (w === 'off') return 'Off';
  if (w === 'light') return 'Light';
  return 'Strong';
}

function top8Ids(all: SimRound[]): Set<string> {
  const chron = [...all].sort((a, b) => {
    const dt = new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime();
    if (dt !== 0) return dt;
    return a.id.localeCompare(b.id);
  });
  const window = chron.slice(-20);
  const ranked = window.map((r) => ({ id: r.id, d: r.adjustedDiff }));
  ranked.sort((a, b) => a.d - b.d);
  return new Set(ranked.slice(0, 8).map((x) => x.id));
}

function modifierParts(r: SimRound) {
  const put = r.putting === 'auto_2putt' ? 0.62 : r.putting === 'gimme_5' ? 0.82 : 1.0;
  const pin = r.pin === 'thu' ? 0.9 : r.pin === 'fri' ? 0.92 : r.pin === 'sat' ? 0.97 : 1.0;
  const win = r.wind === 'off' ? 0.92 : r.wind === 'light' ? 0.96 : 1.0;
  const mul = r.mulligans === 'on' ? 0.88 : 1.0;
  return [
    {
      label: 'Raw differential',
      display: r.rawDiff.toFixed(1),
      width: Math.min(100, (Math.abs(r.rawDiff) / 15) * 100),
      color: colors.accent,
    },
    { label: 'Putting modifier', display: `×${put}`, width: put * 100, color: colors.warn },
    {
      label: `Pin (${r.pin === 'thu' ? 'Thu' : r.pin === 'fri' ? 'Fri' : r.pin === 'sat' ? 'Sat' : 'Sun'})`,
      display: `×${pin}`,
      width: pin * 100,
      color: colors.warn,
    },
    { label: 'Wind', display: `×${win}`, width: win * 100, color: colors.accent },
    { label: 'Mulligans', display: `×${mul}`, width: mul * 100, color: colors.accent },
  ];
}

export default function RoundDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { gutter, isWide, isVeryWide, columnWidth } = useResponsive();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const rounds = useAppStore((s) => s.rounds);
  const deleteRound = useAppStore((s) => s.deleteRound);
  const r = rounds.find((x) => x.id === id);

  useFocusEffect(
    useCallback(() => {
      const onHardwareBack = () => {
        router.replace('/');
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
      return () => sub.remove();
    }, [router])
  );

  if (!r) {
    return (
      <>
        <Stack.Screen
          options={{
            title: 'Round detail',
            headerBackVisible: false,
            headerLeft: () => null,
          }}
        />
        <View style={[styles.miss, { paddingTop: insets.top }]}>
          <Text style={styles.missTxt}>Round not found.</Text>
          <Link href="/" asChild>
            <Pressable>
              <Text style={styles.link}>Back home</Text>
            </Pressable>
          </Link>
        </View>
      </>
    );
  }

  const course = getCourseById(r.courseId);
  const pars = course?.pars ?? [];
  const parTotal = pars.reduce((a, b) => a + b, 0) || 72;
  const vsPar = r.grossScore - parTotal;
  const vsParTxt =
    vsPar === 0 ? 'Even par' : vsPar > 0 ? `${vsPar} over par` : `${Math.abs(vsPar)} under par`;

  const inTop = top8Ids(rounds).has(r.id);
  const filledCard = r.holeScores.length === 18 && r.holeScores.every((h) => h != null);

  const parts = modifierParts(r);

  const onDelete = () => {
    confirmDestructive(
      'Delete round?',
      'This will recalculate your sim index.',
      'Delete',
      () => {
        void (async () => {
          try {
            await deleteRound(r.id);
            router.replace('/');
          } catch (e) {
            showAppAlert('Could not delete', String(e));
          }
        })();
      }
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Round detail',
          headerBackVisible: false,
          headerLeft: () => null,
          headerRight: () => (
            <Link href={{ pathname: '/(tabs)/log', params: { editId: r.id } }} asChild>
              <Pressable style={{ paddingHorizontal: 12 }}>
                <Text style={{ color: colors.accentMuted, fontSize: 13, fontWeight: '600' }}>Edit</Text>
              </Pressable>
            </Link>
          ),
        }}
      />
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
            <Text style={[styles.meta, isWide && styles.metaLg]}>
              {r.platform} · {new Date(r.playedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
              {r.teeName ? ` · ${r.teeName}` : ''}
            </Text>
            <View style={[styles.heroStats, isWide && { gap: 12 }]}>
              <View style={[styles.hstat, isWide && styles.hstatLg]}>
                <Text style={styles.hstatLbl}>Gross score</Text>
                <Text style={styles.hstatVal}>{r.grossScore}</Text>
                <Text style={styles.hstatSub}>{vsParTxt}</Text>
              </View>
              <View style={[styles.hstat, isWide && styles.hstatLg]}>
                <Text style={styles.hstatLbl}>Differential</Text>
                <Text style={styles.hstatVal}>{r.adjustedDiff.toFixed(1)}</Text>
                <Text style={styles.hstatSub}>{inTop ? 'Counts toward index' : 'Outside best 8 / 20'}</Text>
              </View>
              <View style={[styles.hstat, isWide && styles.hstatLg]}>
                <Text style={styles.hstatLbl}>Index after</Text>
                <Text style={styles.hstatVal}>{formatHandicapIndexDisplay(r.indexAfter)}</Text>
                <Text style={styles.hstatSub}>
                  {r.indexDelta != null ? `${r.indexDelta.toFixed(1)} this round` : '—'}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.detailColumn, { maxWidth: columnWidth }]}>
          {isVeryWide ? (
            <View style={[styles.splitDetail, { paddingHorizontal: gutter, gap: gutter }]}>
              <View style={styles.splitCol}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Differential breakdown</Text>
                </View>
                <View style={styles.diffCard}>
                  <View style={styles.diffMainRow}>
                    <View>
                      <Text style={styles.diffBigLbl}>Adjusted differential</Text>
                      <Text style={styles.diffBig}>{r.adjustedDiff.toFixed(1)}</Text>
                    </View>
                    {inTop ? (
                      <View style={styles.pill}>
                        <Text style={styles.pillTxt}>Top 8 of 20</Text>
                      </View>
                    ) : (
                      <View style={[styles.pill, styles.pillMuted]}>
                        <Text style={styles.pillTxtMuted}>Not in top 8</Text>
                      </View>
                    )}
                  </View>
                  {parts.map((p) => (
                    <View key={p.label} style={styles.brow}>
                      <Text style={styles.blbl}>{p.label}</Text>
                      <View style={[styles.bbarTrack, styles.bbarTrackGrow]}>
                        <View style={[styles.bbar, { width: `${Math.min(100, p.width)}%`, backgroundColor: p.color }]} />
                      </View>
                      <Text style={styles.bval}>{p.display}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <View style={styles.splitCol}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Conditions played</Text>
                </View>
                <View style={styles.grid}>
                  <View style={[styles.chip, isVeryWide && styles.chipLg]}>
                    <Text style={styles.chipLbl}>Putting mode</Text>
                    <Text style={styles.chipVal}>{puttingLabel(r.putting)}</Text>
                  </View>
                  <View style={[styles.chip, isVeryWide && styles.chipLg]}>
                    <Text style={styles.chipLbl}>Pin placement</Text>
                    <Text style={styles.chipVal}>{pinLabel(r.pin)}</Text>
                  </View>
                  <View style={[styles.chip, isVeryWide && styles.chipLg]}>
                    <Text style={styles.chipLbl}>Wind</Text>
                    <Text style={[styles.chipVal, styles.chipHi]}>{windLabel(r.wind)}</Text>
                  </View>
                  <View style={[styles.chip, isVeryWide && styles.chipLg]}>
                    <Text style={styles.chipLbl}>Mulligans</Text>
                    <Text style={[styles.chipVal, styles.chipHi]}>{r.mulligans === 'on' ? 'On' : 'Off'}</Text>
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <>
              <View style={[styles.sectionHead, { paddingHorizontal: gutter }]}>
                <Text style={styles.sectionTitle}>Differential breakdown</Text>
              </View>
              <View style={[styles.diffCard, { marginHorizontal: gutter }]}>
                <View style={styles.diffMainRow}>
                  <View>
                    <Text style={styles.diffBigLbl}>Adjusted differential</Text>
                    <Text style={styles.diffBig}>{r.adjustedDiff.toFixed(1)}</Text>
                  </View>
                  {inTop ? (
                    <View style={styles.pill}>
                      <Text style={styles.pillTxt}>Top 8 of 20</Text>
                    </View>
                  ) : (
                    <View style={[styles.pill, styles.pillMuted]}>
                      <Text style={styles.pillTxtMuted}>Not in top 8</Text>
                    </View>
                  )}
                </View>
                {parts.map((p) => (
                  <View key={p.label} style={styles.brow}>
                    <Text style={styles.blbl}>{p.label}</Text>
                    <View style={[styles.bbarTrack, styles.bbarTrackFixed]}>
                      <View style={[styles.bbar, { width: `${Math.min(100, p.width)}%`, backgroundColor: p.color }]} />
                    </View>
                    <Text style={styles.bval}>{p.display}</Text>
                  </View>
                ))}
              </View>

              <View style={[styles.sectionHead, { paddingHorizontal: gutter }]}>
                <Text style={styles.sectionTitle}>Conditions played</Text>
              </View>
              <View style={[styles.grid, { paddingHorizontal: gutter }]}>
                <View style={styles.chip}>
                  <Text style={styles.chipLbl}>Putting mode</Text>
                  <Text style={styles.chipVal}>{puttingLabel(r.putting)}</Text>
                </View>
                <View style={styles.chip}>
                  <Text style={styles.chipLbl}>Pin placement</Text>
                  <Text style={styles.chipVal}>{pinLabel(r.pin)}</Text>
                </View>
                <View style={styles.chip}>
                  <Text style={styles.chipLbl}>Wind</Text>
                  <Text style={[styles.chipVal, styles.chipHi]}>{windLabel(r.wind)}</Text>
                </View>
                <View style={styles.chip}>
                  <Text style={styles.chipLbl}>Mulligans</Text>
                  <Text style={[styles.chipVal, styles.chipHi]}>{r.mulligans === 'on' ? 'On' : 'Off'}</Text>
                </View>
              </View>
            </>
          )}

          {filledCard ? (
            <>
              <View style={[styles.sectionHead, { paddingHorizontal: gutter }]}>
                <Text style={styles.sectionTitle}>Scorecard</Text>
              </View>
              {isVeryWide ? (
                <View style={[styles.scRowWide, { paddingHorizontal: gutter, gap: gutter }]}>
                  <ScoreTable
                    pars={pars}
                    scores={r.holeScores as number[]}
                    label="Front 9"
                    start={0}
                    count={9}
                    totalLabel="Out"
                    wrapStyle={styles.scWrapHalf}
                  />
                  <ScoreTable
                    pars={pars}
                    scores={r.holeScores as number[]}
                    label="Back 9"
                    start={9}
                    count={9}
                    totalLabel="In"
                    wrapStyle={styles.scWrapHalf}
                  />
                </View>
              ) : (
                <>
                  <ScoreTable
                    pars={pars}
                    scores={r.holeScores as number[]}
                    label="Front 9"
                    start={0}
                    count={9}
                    totalLabel="Out"
                    wrapStyle={{ marginHorizontal: gutter }}
                  />
                  <ScoreTable
                    pars={pars}
                    scores={r.holeScores as number[]}
                    label="Back 9"
                    start={9}
                    count={9}
                    totalLabel="In"
                    wrapStyle={{ marginHorizontal: gutter }}
                  />
                </>
              )}
            </>
          ) : null}

          <View style={[styles.actions, { marginHorizontal: gutter }]}>
            <Link href="/(tabs)/log" asChild>
              <Pressable style={mergeViewStyles(styles.actionBtn, styles.actionPrimary)}>
                <Text style={[styles.actionTxt, styles.actionPrimaryTxt]}>Log another</Text>
              </Pressable>
            </Link>
          </View>

          <Pressable style={styles.deleteBtn} onPress={onDelete}>
            <IconTrashOutline size={16} color={colors.danger} />
            <Text style={styles.deleteTxt}>Delete round</Text>
          </Pressable>
          </View>
        </ScrollView>
      </View>
    </>
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
  const holes = Array.from({ length: count }, (_, i) => start + i);
  const total = holes.reduce((s, i) => s + (scores[i] ?? 0), 0);
  return (
    <View style={[styles.scWrap, wrapStyle]}>
      <Text style={styles.scSection}>{label}</Text>
      <View style={styles.scHdr}>
        <Text style={[styles.scCell, styles.scCellL]}>H</Text>
        {holes.map((i) => (
          <Text key={i} style={styles.scCell}>
            {i + 1}
          </Text>
        ))}
      </View>
      <View style={styles.scRow}>
        <Text style={styles.scN}>Par</Text>
        {holes.map((i) => (
          <Text key={i} style={styles.scS}>
            {pars[i] ?? '—'}
          </Text>
        ))}
      </View>
      <View style={styles.scRow}>
        <Text style={styles.scN}>You</Text>
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
  diffCard: {
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    padding: 12,
  },
  diffMainRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 },
  diffBigLbl: { fontSize: 10, fontWeight: '600', color: colors.subtle, marginBottom: 4 },
  diffBig: { fontSize: 28, fontWeight: '700', color: colors.ink },
  pill: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.sage,
    borderRadius: 99,
    paddingVertical: 3,
    paddingHorizontal: 9,
  },
  pillTxt: { fontSize: 11, color: colors.accentDark, fontWeight: '600' },
  pillMuted: { backgroundColor: colors.bg, borderColor: colors.border },
  pillTxtMuted: { fontSize: 11, color: colors.muted },
  brow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 },
  blbl: { fontSize: 11, color: colors.muted, flex: 1 },
  bbarTrack: {
    height: 4,
    backgroundColor: colors.pillBorder,
    borderRadius: 99,
    overflow: 'hidden',
  },
  bbarTrackFixed: { width: 70 },
  bbarTrackGrow: { flex: 1, maxWidth: 220, minWidth: 72 },
  bbar: { height: 4, borderRadius: 99 },
  bval: { fontSize: 11, color: colors.subtle, width: 44, textAlign: 'right' },
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
