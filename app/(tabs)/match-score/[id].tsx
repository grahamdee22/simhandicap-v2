import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { useAuth } from '../../../src/auth/AuthContext';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { confirmDestructive, showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { googleOAuthAccessToken } from '@/src/lib/googleOAuthAccessToken';
import {
  abandonMatch,
  fetchMatchParticipantProfiles,
  fetchMatchPlayerDisplayNames,
  getMatchById,
  listMatchHoles,
  MATCH_HOLE_REACTION_EMOJIS,
  reactionReceivedOnMyHoleRow,
  reactionSentOnOpponentRow,
  setMatchHoleReaction,
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
import { MatchChat } from '../../../src/components/MatchChat';

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
  const [settingsThumbMineOpen, setSettingsThumbMineOpen] = useState(false);
  const [settingsThumbOppOpen, setSettingsThumbOppOpen] = useState(false);
  const [settingsMineImgErr, setSettingsMineImgErr] = useState(false);
  const [settingsOppImgErr, setSettingsOppImgErr] = useState(false);
  const [reactionPickerOpenHole, setReactionPickerOpenHole] = useState<number | null>(null);
  /** Hole numbers where we show the user's reaction before server confirms (cleared when `holes` includes it). */
  const [optimisticSentReactionByHole, setOptimisticSentReactionByHole] = useState<Record<number, string>>(
    {}
  );

  const supabaseOn = isSupabaseConfigured();
  const mounted = useRef(true);
  const reactionRpcInFlightByHoleRef = useRef<Set<number>>(new Set());

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
    const [mRes, hRes] = await Promise.all([
      getMatchById(matchId, googleOAuthAccessToken ?? undefined),
      listMatchHoles(matchId, googleOAuthAccessToken ?? undefined),
    ]);
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

    const sessionRes = supabase ? await supabase.auth.getSession() : null;
    const nameBearer =
      googleOAuthAccessToken ?? sessionRes?.data?.session?.access_token ?? undefined;

    if (nameBearer) {
      const { displayNames, ghinById } = await fetchMatchParticipantProfiles([m], nameBearer);
      if (!mounted.current) return;
      setNames({
        p1: displayNames[p1] ?? 'Player 1',
        p2: displayNames[p2] ?? 'Player 2',
      });
      setGhin1(ghinById[p1] ?? 0);
      setGhin2(ghinById[p2] ?? 0);
    } else if (supabase) {
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
      const nameMapFallback = await fetchMatchPlayerDisplayNames([m]);
      setNames({
        p1: nameMapFallback[p1] ?? map[p1]?.dn ?? 'Player 1',
        p2: nameMapFallback[p2] ?? map[p2]?.dn ?? 'Player 2',
      });
      setGhin1(map[p1]?.ghin ?? 0);
      setGhin2(map[p2]?.ghin ?? 0);
    } else {
      if (!mounted.current) return;
      setNames({ p1: 'Player 1', p2: 'Player 2' });
      setGhin1(0);
      setGhin2(0);
    }
    setLoading(false);
  }, [matchId, supabaseOn, user?.id, router, googleOAuthAccessToken]);

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

  const holeRowByPlayerHole = useMemo(() => {
    const m = new Map<string, DbMatchHoleRow>();
    for (const r of holes) {
      m.set(`${r.player_id}:${r.hole_number}`, r);
    }
    return m;
  }, [holes]);

  useEffect(() => {
    if (!oppId) return;
    setOptimisticSentReactionByHole((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;
      let changed = false;
      const next = { ...prev };
      for (const k of keys) {
        const hn = Number(k);
        const oppRow = holes.find((r) => r.player_id === oppId && r.hole_number === hn);
        if (reactionSentOnOpponentRow(oppRow, amPlayer1)) {
          delete next[hn];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [holes, oppId, amPlayer1]);

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
    setSettingsMineImgErr(false);
    setSettingsOppImgErr(false);
  }, [match?.player_1_settings_photo_url, match?.player_2_settings_photo_url, amPlayer1]);

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
      const res = await updateMatchById(
        m.id,
        {
          status: 'complete',
          player_1_net_score: totalNet1,
          player_2_net_score: totalNet2,
          winner_id,
          player_1_finished: true,
          player_2_finished: true,
        },
        googleOAuthAccessToken ?? undefined
      );
      if (!res.error && res.data?.status === 'complete') {
        router.replace(`/(tabs)/match-results/${m.id}` as never);
      }
    },
    [strokeCtx, course, router, googleOAuthAccessToken]
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
      userId: user.id,
      accessToken: googleOAuthAccessToken ?? undefined,
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
    googleOAuthAccessToken,
  ]);

  const onPickHoleReaction = useCallback(
    async (holeNum: number, emoji: string) => {
      if (!matchId || !user?.id || !oppId) return;
      if (reactionRpcInFlightByHoleRef.current.has(holeNum)) return;

      const oppRow = holes.find((r) => r.player_id === oppId && r.hole_number === holeNum);
      if (reactionSentOnOpponentRow(oppRow, amPlayer1)) return;

      reactionRpcInFlightByHoleRef.current.add(holeNum);
      setReactionPickerOpenHole(null);
      setOptimisticSentReactionByHole((prev) => ({ ...prev, [holeNum]: emoji }));

      try {
        const res = await setMatchHoleReaction(
          {
            matchId,
            holeNumber: holeNum,
            emoji,
          },
          googleOAuthAccessToken ?? undefined
        );
        if (!res.ok) {
          setOptimisticSentReactionByHole((prev) => {
            const { [holeNum]: _, ...rest } = prev;
            return rest;
          });
          showAppAlert('Reaction', res.error ?? 'Could not save.');
          return;
        }
        void refreshAll();
      } finally {
        reactionRpcInFlightByHoleRef.current.delete(holeNum);
      }
    },
    [matchId, user?.id, oppId, holes, amPlayer1, refreshAll, googleOAuthAccessToken]
  );

  const onAbandonMatch = useCallback(async () => {
    if (!matchId || abandonBusy) return;
    const ok = await confirmDestructive(
      'Abandon match?',
      'You will record a loss and forfeit on your profile. Your opponent’s SimCap match record will not change.',
      'Abandon'
    );
    if (!ok) return;
    setAbandonBusy(true);
    const res = await abandonMatch(matchId, googleOAuthAccessToken ?? undefined);
    setAbandonBusy(false);
    if (!res.ok) {
      showAppAlert('Could not abandon match', res.error ?? 'Unknown error');
      return;
    }
    router.replace('/(tabs)/groups' as never);
  }, [matchId, abandonBusy, router, googleOAuthAccessToken]);

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
    reactionOnMyScore: string | null;
    reactionISent: string | null;
    showReactionPicker: boolean;
  }[] = [];

  for (const h of holeNums) {
    const g1 = maps.p1.get(h);
    const g2 = maps.p2.get(h);
    const myGross = amPlayer1 ? g1 : g2;
    const oppGross = amPlayer1 ? g2 : g1;
    const myRow =
      user?.id ? holeRowByPlayerHole.get(`${user.id}:${h}`) : undefined;
    const oppRow =
      oppId ? holeRowByPlayerHole.get(`${oppId}:${h}`) : undefined;
    const reactionOnMyScore = reactionReceivedOnMyHoleRow(myRow, amPlayer1);
    const reactionISentFromServer = reactionSentOnOpponentRow(oppRow, amPlayer1);
    const reactionISent =
      reactionISentFromServer ?? optimisticSentReactionByHole[h] ?? null;
    const showReactionPicker = Boolean(oppId && oppGross != null && !reactionISent);
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
    rows.push({
      h,
      myGross,
      oppGross,
      myNetDisp,
      oppNetDisp,
      reactionOnMyScore,
      reactionISent,
      showReactionPicker,
    });
  }

  const myDisplayName = amPlayer1 ? names.p1 : names.p2;
  const oppDisplayName = amPlayer1 ? names.p2 : names.p1;
  const mySettingsPhotoUrl = amPlayer1
    ? match.player_1_settings_photo_url
    : match.player_2_settings_photo_url;
  const oppSettingsPhotoUrl = amPlayer1
    ? match.player_2_settings_photo_url
    : match.player_1_settings_photo_url;

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
            paddingBottom: insets.bottom + 200,
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

          <View style={styles.settingsPhotosRow}>
            <View style={styles.colHole} />
            <Pressable
              style={styles.settingsPhotoCol}
              onPress={() => setSettingsThumbMineOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityLabel={`${myDisplayName} sim settings photo`}
              accessibilityState={{ expanded: settingsThumbMineOpen }}
            >
              <Text style={styles.settingsPhotoLabel} numberOfLines={1}>
                {myDisplayName}
              </Text>
              {mySettingsPhotoUrl && !settingsMineImgErr ? (
                <Image
                  source={{ uri: mySettingsPhotoUrl }}
                  style={settingsThumbMineOpen ? styles.settingsPhotoExpanded : styles.settingsPhotoThumb}
                  resizeMode="contain"
                  onError={() => setSettingsMineImgErr(true)}
                />
              ) : settingsThumbMineOpen ? (
                <Text style={styles.settingsPhotoMissingExpanded}>
                  {settingsMineImgErr
                    ? 'Could not load image.'
                    : 'No sim settings photo for this player.'}
                </Text>
              ) : (
                <View style={styles.settingsPhotoThumbPlaceholder}>
                  <Text style={styles.settingsPhotoMissingCollapsed}>—</Text>
                </View>
              )}
            </Pressable>
            <Pressable
              style={styles.settingsPhotoCol}
              onPress={() => setSettingsThumbOppOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityLabel={`${oppDisplayName} sim settings photo`}
              accessibilityState={{ expanded: settingsThumbOppOpen }}
            >
              <Text style={styles.settingsPhotoLabel} numberOfLines={1}>
                {oppDisplayName}
              </Text>
              {oppSettingsPhotoUrl && !settingsOppImgErr ? (
                <Image
                  source={{ uri: oppSettingsPhotoUrl }}
                  style={settingsThumbOppOpen ? styles.settingsPhotoExpanded : styles.settingsPhotoThumb}
                  resizeMode="contain"
                  onError={() => setSettingsOppImgErr(true)}
                />
              ) : settingsThumbOppOpen ? (
                <Text style={styles.settingsPhotoMissingExpanded}>
                  {settingsOppImgErr
                    ? 'Could not load image.'
                    : 'No sim settings photo for this player.'}
                </Text>
              ) : (
                <View style={styles.settingsPhotoThumbPlaceholder}>
                  <Text style={styles.settingsPhotoMissingCollapsed}>—</Text>
                </View>
              )}
            </Pressable>
          </View>

          <View style={styles.tableHead}>
            <Text style={[styles.th, styles.colHole]}>Hole</Text>
            <Text style={[styles.th, styles.colNum]}>Gross</Text>
            <Text style={[styles.th, styles.colNum]}>Net</Text>
            <Text style={[styles.th, styles.colNum]}>Gross</Text>
            <Text style={[styles.th, styles.colNum]}>Net</Text>
          </View>

          {rows.map(
            ({
              h,
              myGross,
              oppGross,
              myNetDisp,
              oppNetDisp,
              reactionOnMyScore,
              reactionISent,
              showReactionPicker,
            }) => (
              <View key={h} style={styles.tr}>
                <Text style={[styles.td, styles.colHole]}>{h}</Text>
                <View style={[styles.tdCell, styles.colNum]}>
                  <View style={styles.oppGrossInlineWrap}>
                    <View style={styles.oppGrossInlineRow}>
                      <Text style={[styles.td, styles.oppGrossInlineNum]}>{myGross ?? '—'}</Text>
                      {reactionOnMyScore ? (
                        <Text style={styles.reactionEmojiInline}>{reactionOnMyScore}</Text>
                      ) : null}
                    </View>
                  </View>
                </View>
                <View style={[styles.tdCell, styles.colNum]}>
                  <Text style={[styles.td, styles.tdCenter]}>{myNetDisp}</Text>
                </View>
                <View style={[styles.tdCell, styles.colNum]}>
                  <View style={styles.oppGrossInlineWrap}>
                    <View style={styles.oppGrossInlineRow}>
                      <Text style={[styles.td, styles.oppGrossInlineNum]}>{oppGross ?? '—'}</Text>
                      {reactionISent ? (
                        <Text style={styles.reactionEmojiInline}>{reactionISent}</Text>
                      ) : showReactionPicker ? (
                        <Pressable
                          style={({ pressed }) => [
                            styles.reactionHintHitInline,
                            pressed && styles.reactionHintHitPressed,
                          ]}
                          onPress={() =>
                            setReactionPickerOpenHole((cur) => (cur === h ? null : h))
                          }
                          accessibilityRole="button"
                          accessibilityLabel="Add reaction to opponent score"
                          accessibilityState={{ expanded: reactionPickerOpenHole === h }}
                          hitSlop={{ top: 4, bottom: 6, left: 8, right: 8 }}
                        >
                          <Text style={styles.reactionHintTxt}>+</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                  {showReactionPicker && reactionPickerOpenHole === h ? (
                    <View style={styles.reactionPickPopover}>
                      <View style={styles.reactionPickWrap}>
                        {MATCH_HOLE_REACTION_EMOJIS.map((emo) => (
                          <Pressable
                            key={`${h}-${emo}`}
                            style={({ pressed }) => [
                              styles.reactionPickHit,
                              pressed && styles.reactionPickHitPressed,
                            ]}
                            onPress={() => void onPickHoleReaction(h, emo)}
                            accessibilityRole="button"
                            accessibilityLabel={`React ${emo}`}
                          >
                            <Text style={styles.reactionPickEmoji}>{emo}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>
                <View style={[styles.tdCell, styles.colNum]}>
                  <Text style={[styles.td, styles.tdCenter]}>{oppNetDisp}</Text>
                </View>
              </View>
            )
          )}

          <View style={[styles.tr, styles.trTotals]}>
            <Text style={[styles.tdStrong, styles.colHole]}>Total</Text>
            <View style={[styles.tdCell, styles.colNum]}>
              <Text style={[styles.tdStrong, styles.tdCenter]}>
                {myScoredHoles === 0 ? '—' : cumMyGross}
              </Text>
            </View>
            <View style={[styles.tdCell, styles.colNum]}>
              <Text style={[styles.tdStrong, styles.tdCenter]}>{myScoredHoles === 0 ? '—' : cumMyNet}</Text>
            </View>
            <View style={[styles.tdCell, styles.colNum]}>
              <Text style={[styles.tdStrong, styles.tdCenter]}>
                {oppScoredHoles === 0 ? '—' : cumOppGross}
              </Text>
            </View>
            <View style={[styles.tdCell, styles.colNum]}>
              <Text style={[styles.tdStrong, styles.tdCenter]}>{oppScoredHoles === 0 ? '—' : cumOppNet}</Text>
            </View>
          </View>

          <MatchChat
            matchId={matchId}
            currentUserId={user.id}
            opponentId={oppId}
          />
        </ScrollView>

        <View style={styles.footer}>
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
            hitSlop={{ top: 6, bottom: 10, left: 12, right: 12 }}
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
  settingsPhotosRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    paddingTop: 2,
  },
  settingsPhotoCol: { flex: 2, alignItems: 'center', paddingHorizontal: 2 },
  settingsPhotoLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.subtle,
    marginBottom: 6,
    textAlign: 'center',
    width: '100%',
  },
  settingsPhotoThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
  },
  settingsPhotoExpanded: {
    width: '100%',
    maxWidth: 200,
    height: 200,
    marginTop: 2,
    borderRadius: 10,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
  },
  settingsPhotoThumbPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsPhotoMissingCollapsed: { fontSize: 14, color: colors.muted, fontWeight: '600' },
  settingsPhotoMissingExpanded: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  tableHead: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    marginBottom: 4,
  },
  tr: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 7 },
  trTotals: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  th: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.subtle,
    textTransform: 'uppercase',
    textAlign: 'center',
    width: '100%',
  },
  td: { fontSize: 13, color: colors.ink },
  tdStrong: { fontSize: 13, fontWeight: '800', color: colors.ink },
  tdCell: { flex: 1, alignItems: 'center', minWidth: 0 },
  tdCenter: { textAlign: 'center', width: '100%' },
  colHole: { width: 44 },
  colNum: { flex: 1 },
  oppGrossInlineWrap: { width: '100%', alignItems: 'center' },
  oppGrossInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  oppGrossInlineNum: { fontSize: 13, color: colors.ink, textAlign: 'center' },
  reactionEmojiInline: { fontSize: 17, lineHeight: 20 },
  reactionHintHitInline: {
    paddingVertical: 1,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  reactionHintHitPressed: { opacity: 0.72 },
  reactionHintTxt: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.subtle,
    opacity: 0.42,
    lineHeight: 18,
  },
  reactionPickPopover: {
    marginTop: 6,
    alignSelf: 'stretch',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
    backgroundColor: colors.accentSoft,
  },
  reactionPickWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 2,
    maxWidth: '100%',
  },
  reactionPickHit: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 8,
  },
  reactionPickHitPressed: { opacity: 0.65 },
  reactionPickEmoji: { fontSize: 20, lineHeight: 26 },
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
    paddingBottom: 16,
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
    paddingTop: 10,
    paddingBottom: 0,
    marginTop: 8,
    marginBottom: 0,
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
