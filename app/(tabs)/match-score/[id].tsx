import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthContext';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { confirmDestructive, showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import {
  abandonMatch,
  getMatchById,
  listMatchHoles,
  updateMatchById,
  upsertMatchHoleScore,
  type DbMatchHoleRow,
  type DbMatchRow,
} from '../../../src/lib/matchPlay';
import {
  buildMatchStrokeContext,
  computeTotalsIfComplete,
  grossMapsForPlayers,
  holeNetScore,
  matchHoleNumbers,
  opponentAhead,
  resolvedCourseForMatch,
} from '../../../src/lib/matchStrokeMath';
import { useResponsive } from '../../../src/lib/responsive';
import { isSupabaseConfigured, supabase } from '../../../src/lib/supabase';

const GROSS_MIN = 1;
const GROSS_MAX = 15;

function clampGross(n: number): number {
  return Math.min(GROSS_MAX, Math.max(GROSS_MIN, Math.round(n)));
}

function distinctHoleCount(rows: DbMatchHoleRow[], playerId: string): number {
  const s = new Set(rows.filter((r) => r.player_id === playerId).map((r) => r.hole_number));
  return s.size;
}

export default function MatchScoreScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const matchId = typeof rawId === 'string' ? rawId : rawId?.[0] ?? '';
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user } = useAuth();

  const [match, setMatch] = useState<DbMatchRow | null>(null);
  const [holes, setHoles] = useState<DbMatchHoleRow[]>([]);
  const [names, setNames] = useState<{ p1: string; p2: string }>({ p1: 'Player 1', p2: 'Player 2' });
  const [ghin1, setGhin1] = useState<number>(0);
  const [ghin2, setGhin2] = useState<number>(0);
  const [fatalErr, setFatalErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [abandonBusy, setAbandonBusy] = useState(false);
  const [holeGross, setHoleGross] = useState(4);

  const supabaseOn = isSupabaseConfigured();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshAll = useCallback(async () => {
    if (!matchId || !supabaseOn || !user?.id) {
      setLoading(false);
      return;
    }
    const [mRes, hRes] = await Promise.all([getMatchById(matchId), listMatchHoles(matchId)]);
    if (!mounted.current) return;
    if (mRes.error || !mRes.data) {
      setFatalErr(mRes.error ?? 'Match not found.');
      setMatch(null);
      setLoading(false);
      return;
    }
    const m = mRes.data;
    if (m.status === 'complete') {
      router.replace(`/(tabs)/match-results/${matchId}` as never);
      return;
    }
    if (m.status === 'abandoned') {
      router.replace('/(tabs)/groups' as never);
      return;
    }
    if ((m.status !== 'active' && m.status !== 'waiting') || !m.player_2_id) {
      setFatalErr('This match is not open for scoring.');
      setMatch(null);
      setLoading(false);
      return;
    }
    setMatch(m);
    setFatalErr(null);
    if (hRes.data) setHoles(hRes.data);
    const p1 = m.player_1_id;
    const p2 = m.player_2_id;
    if (supabase) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, display_name, ghin_index')
        .in('id', [p1, p2]);
      if (!mounted.current) return;
      const map: Record<string, { dn: string; ghin: number }> = {};
      for (const row of (profs ?? []) as {
        id: string;
        display_name?: string;
        ghin_index?: number | string | null;
      }[]) {
        const g = row.ghin_index != null ? Number(row.ghin_index) : NaN;
        map[row.id] = {
          dn: row.display_name?.trim() || 'Golfer',
          ghin: Number.isFinite(g) ? g : 0,
        };
      }
      setNames({
        p1: map[p1]?.dn ?? 'Player 1',
        p2: map[p2]?.dn ?? 'Player 2',
      });
      setGhin1(map[p1]?.ghin ?? 0);
      setGhin2(map[p2]?.ghin ?? 0);
    }
    setLoading(false);
  }, [matchId, supabaseOn, user?.id, router]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll])
  );

  useEffect(() => {
    const client = supabase;
    if (!matchId || !client || !supabaseOn || !user?.id) return;

    const channel = client
      .channel(`match-score:${matchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_holes',
          filter: `match_id=eq.${matchId}`,
        },
        () => {
          void refreshAll();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `id=eq.${matchId}`,
        },
        () => {
          void refreshAll();
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [matchId, supabase, supabaseOn, user?.id, refreshAll]);

  const course = useMemo(() => (match ? resolvedCourseForMatch(match) : null), [match]);

  const strokeCtx = useMemo(() => {
    if (!match || !course || !match.player_2_id) return null;
    return buildMatchStrokeContext(match, course, ghin1, ghin2, names.p1, names.p2);
  }, [match, course, ghin1, ghin2, names.p1, names.p2]);

  const holeNums = useMemo(() => (match ? matchHoleNumbers(match) : []), [match]);

  const amPlayer1 = user?.id === match?.player_1_id;
  const oppId =
    match?.player_1_id && match?.player_2_id
      ? user?.id === match.player_1_id
        ? match.player_2_id
        : match.player_1_id
      : null;

  const maps = useMemo(() => {
    if (!match?.player_2_id) return { p1: new Map<number, number>(), p2: new Map<number, number>() };
    return grossMapsForPlayers(holes, match.player_1_id, match.player_2_id);
  }, [holes, match]);

  const myDistinct = user?.id && match ? distinctHoleCount(holes, user.id) : 0;
  const oppDistinct = oppId ? distinctHoleCount(holes, oppId) : 0;
  const showAheadBanner = opponentAhead(myDistinct, oppDistinct);

  const currentHole = useMemo(() => {
    if (!match?.player_2_id || !user?.id || !maps) return null;
    const myMap = amPlayer1 ? maps.p1 : maps.p2;
    for (const h of holeNums) {
      if (!myMap.has(h)) return h;
    }
    return null;
  }, [match?.player_2_id, user?.id, maps, amPlayer1, holeNums]);

  useEffect(() => {
    if (currentHole == null || !course) return;
    const par = course.pars[currentHole - 1] ?? 4;
    setHoleGross(clampGross(par));
  }, [currentHole, course]);

  const tryFinalize = useCallback(
    async (m: DbMatchRow, holeRows: DbMatchHoleRow[]) => {
      if (m.status !== 'active' || !strokeCtx || !course || !m.player_2_id) return;
      const totals = computeTotalsIfComplete(m, course, holeRows, strokeCtx, m.player_2_id);
      if (!totals) return;
      const { totalNet1, totalNet2 } = totals;
      let winner_id: string | null = null;
      if (totalNet1 < totalNet2) winner_id = m.player_1_id;
      else if (totalNet2 < totalNet1) winner_id = m.player_2_id;
      const res = await updateMatchById(m.id, {
        status: 'complete',
        player_1_net_score: totalNet1,
        player_2_net_score: totalNet2,
        winner_id,
        player_1_finished: true,
        player_2_finished: true,
      });
      if (!res.error && res.data?.status === 'complete') {
        router.replace(`/(tabs)/match-results/${m.id}` as never);
      }
    },
    [strokeCtx, course, router]
  );

  const onSubmitHole = useCallback(async () => {
    if (
      !match ||
      !user?.id ||
      currentHole == null ||
      !course ||
      !strokeCtx ||
      submitBusy ||
      !matchId
    )
      return;
    const gross = clampGross(holeGross);
    setSubmitBusy(true);
    const res = await upsertMatchHoleScore({
      matchId,
      holeNumber: currentHole,
      grossScore: gross,
    });
    setSubmitBusy(false);
    if (res.error) {
      showAppAlert('Could not save hole', res.error);
      return;
    }
    const nextRows = [...holes.filter((r) => !(r.player_id === user.id && r.hole_number === currentHole))];
    if (res.data) nextRows.push(res.data);
    setHoles(nextRows);
    await tryFinalize(match, nextRows);
    void refreshAll();
  }, [
    match,
    user?.id,
    currentHole,
    course,
    strokeCtx,
    submitBusy,
    matchId,
    holeGross,
    holes,
    tryFinalize,
    refreshAll,
  ]);

  const onAbandonMatch = useCallback(async () => {
    if (!matchId || abandonBusy) return;
    const ok = await confirmDestructive(
      'Abandon match?',
      'You will record a loss and forfeit on your profile. Your opponent’s SimCap match record will not change.',
      'Abandon'
    );
    if (!ok) return;
    setAbandonBusy(true);
    const res = await abandonMatch(matchId);
    setAbandonBusy(false);
    if (!res.ok) {
      showAppAlert('Could not abandon match', res.error ?? 'Unknown error');
      return;
    }
    router.replace('/(tabs)/groups' as never);
  }, [matchId, abandonBusy, router]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: match?.course_name ?? 'Match',
      headerRight: () => (
        <Pressable
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Close scoring"
        >
          <Text style={styles.headerBtnTxt}>Close</Text>
        </Pressable>
      ),
    });
  }, [navigation, router, match?.course_name]);

  if (!matchId) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.centered, { padding: gutter }]}>
          <Text style={styles.errTxt}>Missing match.</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnTxt}>Go back</Text>
          </Pressable>
        </View>
      </ContentWidth>
    );
  }

  if (!supabaseOn || !user) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.centered, { padding: gutter }]}>
          <Text style={styles.errTxt}>Sign in to score this match.</Text>
        </View>
      </ContentWidth>
    );
  }

  if (loading) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.centered, { padding: gutter }]}>
          <ActivityIndicator color={colors.header} />
        </View>
      </ContentWidth>
    );
  }

  if (!match || fatalErr) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.centered, { padding: gutter }]}>
          <Text style={styles.errTxt}>{fatalErr ?? 'Match not available.'}</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnTxt}>Go back</Text>
          </Pressable>
        </View>
      </ContentWidth>
    );
  }

  if (!strokeCtx || !course) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.centered, { padding: gutter }]}>
          <ActivityIndicator color={colors.header} />
        </View>
      </ContentWidth>
    );
  }

  let cumMyGross = 0;
  let cumOppGross = 0;
  let cumMyNet = 0;
  let cumOppNet = 0;
  let myScoredHoles = 0;
  let oppScoredHoles = 0;

  const rows: {
    h: number;
    myGross: number | undefined;
    oppGross: number | undefined;
    myNetDisp: string | number;
    oppNetDisp: string | number;
  }[] = [];

  for (const h of holeNums) {
    const g1 = maps.p1.get(h);
    const g2 = maps.p2.get(h);
    const myGross = amPlayer1 ? g1 : g2;
    const oppGross = amPlayer1 ? g2 : g1;
    let myNetDisp: string | number = '—';
    let oppNetDisp: string | number = '—';
    if (g1 != null && g2 != null) {
      const n1 = holeNetScore(g1, h, strokeCtx, true);
      const n2 = holeNetScore(g2, h, strokeCtx, false);
      myNetDisp = amPlayer1 ? n1 : n2;
      oppNetDisp = amPlayer1 ? n2 : n1;
    } else if (myGross != null) {
      myNetDisp = holeNetScore(myGross, h, strokeCtx, amPlayer1);
    } else if (oppGross != null) {
      oppNetDisp = holeNetScore(oppGross, h, strokeCtx, !amPlayer1);
    }

    if (myGross != null) {
      myScoredHoles += 1;
      cumMyGross += myGross;
      cumMyNet += holeNetScore(myGross, h, strokeCtx, amPlayer1);
    }
    if (oppGross != null) {
      oppScoredHoles += 1;
      cumOppGross += oppGross;
      cumOppNet += holeNetScore(oppGross, h, strokeCtx, !amPlayer1);
    }
    rows.push({ h, myGross, oppGross, myNetDisp, oppNetDisp });
  }

  const parCur = currentHole != null ? course.pars[currentHole - 1] ?? 4 : null;

  const myDone = currentHole == null;

  return (
    <ContentWidth bg={colors.surface}>
      <View style={styles.flex1}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingTop: 12,
            paddingBottom: insets.bottom + 280,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {showAheadBanner ? (
            <View style={styles.banner}>
              <Text style={styles.bannerTxt}>
                Your opponent has continued playing — catch up when you&apos;re ready.
              </Text>
            </View>
          ) : null}

          <Text style={styles.vsLine} numberOfLines={1}>
            {names.p1} vs {names.p2}
          </Text>

          <View style={styles.tableHead}>
            <Text style={[styles.th, styles.colHole]}>Hole</Text>
            <Text style={[styles.th, styles.colNum]}>Me</Text>
            <Text style={[styles.th, styles.colNum]}>Net</Text>
            <Text style={[styles.th, styles.colNum]}>Opp</Text>
            <Text style={[styles.th, styles.colNum]}>Net</Text>
          </View>

          {rows.map(({ h, myGross, oppGross, myNetDisp, oppNetDisp }) => (
            <View key={h} style={styles.tr}>
              <Text style={[styles.td, styles.colHole]}>{h}</Text>
              <Text style={[styles.td, styles.colNum]}>{myGross ?? '—'}</Text>
              <Text style={[styles.td, styles.colNum]}>{myNetDisp}</Text>
              <Text style={[styles.td, styles.colNum]}>{oppGross ?? '—'}</Text>
              <Text style={[styles.td, styles.colNum]}>{oppNetDisp}</Text>
            </View>
          ))}

          <View style={[styles.tr, styles.trTotals]}>
            <Text style={[styles.tdStrong, styles.colHole]}>Total</Text>
            <Text style={[styles.tdStrong, styles.colNum]}>
              {myScoredHoles === 0 ? '—' : cumMyGross}
            </Text>
            <Text style={[styles.tdStrong, styles.colNum]}>{myScoredHoles === 0 ? '—' : cumMyNet}</Text>
            <Text style={[styles.tdStrong, styles.colNum]}>
              {oppScoredHoles === 0 ? '—' : cumOppGross}
            </Text>
            <Text style={[styles.tdStrong, styles.colNum]}>{oppScoredHoles === 0 ? '—' : cumOppNet}</Text>
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {myDone ? (
            <Text style={styles.footerTitle}>You&apos;ve entered all holes. Totals lock when both players finish.</Text>
          ) : (
            <>
              <Text style={styles.footerTitle}>
                Hole {currentHole} · Par {parCur}
              </Text>
              <Text style={styles.sectionLabel}>Score</Text>
              <View style={styles.scoreBlock}>
                <View style={styles.scoreMain}>
                  <Pressable
                    style={styles.scoreBtn}
                    onPress={() => setHoleGross((g) => clampGross(g - 1))}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease gross score"
                  >
                    <Text style={styles.scoreBtnTxt}>−</Text>
                  </Pressable>
                  <View style={[styles.scoreInput, styles.scoreInputStatic]}>
                    <Text style={styles.scoreInputStaticTxt}>{String(clampGross(holeGross))}</Text>
                  </View>
                  <Pressable
                    style={styles.scoreBtn}
                    onPress={() => setHoleGross((g) => clampGross(g + 1))}
                    accessibilityRole="button"
                    accessibilityLabel="Increase gross score"
                  >
                    <Text style={styles.scoreBtnTxt}>+</Text>
                  </Pressable>
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.submitBtn,
                  pressed && styles.submitBtnPressed,
                  submitBusy && styles.submitBtnDisabled,
                ]}
                disabled={submitBusy}
                onPress={() => void onSubmitHole()}
              >
                {submitBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnTxt}>Save hole {currentHole}</Text>
                )}
              </Pressable>
            </>
          )}
          <Pressable
            style={styles.abandonBtn}
            disabled={abandonBusy || submitBusy}
            onPress={() => void onAbandonMatch()}
            accessibilityRole="button"
            accessibilityLabel="Abandon match"
          >
            {abandonBusy ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <Text style={styles.abandonBtnTxt}>Abandon match</Text>
            )}
          </Pressable>
        </View>
      </View>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1, minHeight: 0, backgroundColor: colors.surface, width: '100%' },
  scroll: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', minHeight: 200 },
  errTxt: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 },
  headerBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  headerBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '600' },
  banner: {
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  bannerTxt: { fontSize: 13, color: colors.ink, lineHeight: 18, fontWeight: '600' },
  vsLine: { fontSize: 13, fontWeight: '700', color: colors.subtle, marginBottom: 10 },
  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    marginBottom: 4,
  },
  tr: { flexDirection: 'row', paddingVertical: 7 },
  trTotals: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  th: { fontSize: 10, fontWeight: '700', color: colors.subtle, textTransform: 'uppercase' },
  td: { fontSize: 13, color: colors.ink },
  tdStrong: { fontSize: 13, fontWeight: '800', color: colors.ink },
  colHole: { width: 44 },
  colNum: { flex: 1, textAlign: 'center' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  footerTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.subtle,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  scoreBlock: { borderWidth: 0.5, borderColor: colors.pillBorder, borderRadius: 9, overflow: 'hidden', marginBottom: 12 },
  scoreMain: { flexDirection: 'row', alignItems: 'center' },
  scoreBtn: {
    width: 40,
    height: 44,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreBtnTxt: { fontSize: 18, color: colors.muted },
  scoreInput: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '600',
    color: colors.ink,
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderColor: colors.border,
    paddingVertical: 10,
    minWidth: 0,
  },
  scoreInputStatic: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreInputStaticTxt: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.ink,
    textAlign: 'center',
    width: '100%',
  },
  submitBtn: {
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  submitBtnPressed: { opacity: 0.92 },
  submitBtnDisabled: { opacity: 0.65 },
  submitBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  abandonBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 10,
  },
  abandonBtnTxt: { fontSize: 14, fontWeight: '700', color: colors.danger },
  secondaryBtn: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.sage,
    backgroundColor: colors.accentSoft,
  },
  secondaryBtnTxt: { fontSize: 15, fontWeight: '700', color: colors.accent },
});
