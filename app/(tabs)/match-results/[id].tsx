import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthContext';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { localYmdToIso, todayLocalYmd } from '../../../src/lib/dates';
import {
  buildNewRoundInputFromCompletedMatch,
  matchIndexRoundStorageKey,
} from '../../../src/lib/matchPlayIndexRound';
import {
  countActiveDirectMatchesForUser,
  findActiveDirectMatchBetween,
  MAX_ACTIVE_DIRECT_CHALLENGES,
} from '../../../src/lib/matchDirectChallenges';
import {
  fetchMatchPlayerDisplayNames,
  getMatchById,
  listMatchHoles,
  listMyMatches,
  type DbMatchHoleRow,
  type DbMatchRow,
} from '../../../src/lib/matchPlay';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import {
  playerVerificationUiState,
  verificationStatusEmoji,
  verificationStatusLabel,
} from '../../../src/lib/matchVerification';
import { grossMapsForPlayers, matchHoleNumbers } from '../../../src/lib/matchStrokeMath';
import { useResponsive } from '../../../src/lib/responsive';
import { isSupabaseConfigured } from '../../../src/lib/supabase';
import { useAppStore } from '../../../src/store/useAppStore';

type IndexRoundUi = 'off' | 'loading' | 'prompt' | 'saving' | 'saved' | 'skipped';

export default function MatchResultsScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const matchId = typeof rawId === 'string' ? rawId : rawId?.[0] ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user } = useAuth();
  const userId = user?.id;
  const addRound = useAppStore((s) => s.addRound);
  const preferredLogPlatform = useAppStore((s) => s.preferredLogPlatform);

  const [match, setMatch] = useState<DbMatchRow | null>(null);
  const [names, setNames] = useState<{ p1: string; p2: string }>({ p1: 'Player 1', p2: 'Player 2' });
  const [holesRows, setHolesRows] = useState<DbMatchHoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [indexRoundUi, setIndexRoundUi] = useState<IndexRoundUi>('off');
  const [rematchBusy, setRematchBusy] = useState(false);

  const supabaseOn = isSupabaseConfigured();

  const holeNumsList = useMemo(() => (match ? matchHoleNumbers(match) : []), [match]);

  const grossMapsComplete = useMemo(() => {
    if (!match?.player_2_id) return { p1: new Map<number, number>(), p2: new Map<number, number>() };
    return grossMapsForPlayers(holesRows, match.player_1_id, match.player_2_id);
  }, [holesRows, match]);

  const load = useCallback(async () => {
    if (!matchId || !supabaseOn) {
      setLoading(false);
      setErr('Missing match.');
      return;
    }
    setLoading(true);
    setErr(null);
    const res = await getMatchById(matchId, googleOAuthAccessToken ?? undefined);
    if (res.error || !res.data) {
      setErr(res.error ?? 'Could not load match.');
      setMatch(null);
      setHolesRows([]);
      setLoading(false);
      return;
    }
    const m = res.data;
    setMatch(m);
    const holesRes = await listMatchHoles(matchId, googleOAuthAccessToken ?? undefined);
    setHolesRows(holesRes.data ?? []);
    if (m.player_2_id) {
      const nm = await fetchMatchPlayerDisplayNames([m], googleOAuthAccessToken ?? undefined);
      setNames({
        p1: nm[m.player_1_id] ?? 'Player 1',
        p2: nm[m.player_2_id] ?? 'Player 2',
      });
    }
    setLoading(false);
  }, [matchId, supabaseOn, googleOAuthAccessToken]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    if (loading) return;
    if (!match || match.status !== 'complete' || !userId || !matchId) {
      setIndexRoundUi('off');
      return;
    }
    if (userId !== match.player_1_id && userId !== match.player_2_id) {
      setIndexRoundUi('off');
      return;
    }
    setIndexRoundUi('loading');
    let cancelled = false;
    void (async () => {
      const v = await AsyncStorage.getItem(matchIndexRoundStorageKey(matchId, userId));
      if (cancelled) return;
      if (v === 'saved') setIndexRoundUi('saved');
      else if (v === 'skipped') setIndexRoundUi('skipped');
      else setIndexRoundUi('prompt');
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, match, matchId, userId]);

  const onSkipSaveToIndex = useCallback(async () => {
    if (!userId || !matchId) return;
    await AsyncStorage.setItem(matchIndexRoundStorageKey(matchId, userId), 'skipped');
    setIndexRoundUi('skipped');
  }, [matchId, userId]);

  const onRematch = useCallback(async () => {
    if (!match?.player_2_id || !userId || !matchId) return;
    setRematchBusy(true);
    const res = await listMyMatches(userId, googleOAuthAccessToken ?? undefined);
    setRematchBusy(false);
    if (res.error || !res.data) {
      showAppAlert('Rematch', res.error ?? 'Could not verify your matches.');
      return;
    }
    const p1 = match.player_1_id;
    const p2 = match.player_2_id;
    const oppId = userId === p1 ? p2 : p1;
    const oppName = userId === p1 ? names.p2 : names.p1;
    const existing = findActiveDirectMatchBetween(res.data, userId, oppId);
    if (existing) {
      if (userId === existing.player_2_id && existing.status === 'pending') {
        showAppAlert('Rematch', 'Your opponent already wants a rematch!', {
          onOk: () => router.push(`/(tabs)/match-accept/${existing.id}` as never),
        });
        return;
      }
      if (userId === existing.player_1_id && existing.status === 'pending') {
        showAppAlert(
          'Rematch',
          `You already have a challenge waiting on ${oppName}. Wait for them to accept before sending another.`
        );
        return;
      }
      showAppAlert('Rematch', `You and ${oppName} already have a match in progress.`, {
        onOk: () => router.push(`/(tabs)/match-score/${existing.id}` as never),
      });
      return;
    }
    if (countActiveDirectMatchesForUser(res.data, userId) >= MAX_ACTIVE_DIRECT_CHALLENGES) {
      showAppAlert(
        'Challenge limit',
        `You have ${MAX_ACTIVE_DIRECT_CHALLENGES} active challenges. Finish or resolve an existing match before sending a rematch.`
      );
      return;
    }
    router.push(`/(tabs)/match-create?rematchFrom=${matchId}` as never);
  }, [match, matchId, names.p1, names.p2, router, userId, googleOAuthAccessToken]);

  const onSaveToIndex = useCallback(async () => {
    if (!match || !userId || !matchId) return;
    const playedAt = localYmdToIso(todayLocalYmd());
    const built = buildNewRoundInputFromCompletedMatch({
      match,
      holesRows,
      playerId: userId,
      playedAtIso: playedAt,
      platform: preferredLogPlatform,
    });
    if (!built.ok) {
      showAppAlert('Could not prepare round', built.error);
      return;
    }
    setIndexRoundUi('saving');
    try {
      await addRound(built.input);
      await AsyncStorage.setItem(matchIndexRoundStorageKey(matchId, userId), 'saved');
      setIndexRoundUi('saved');
    } catch (e) {
      setIndexRoundUi('prompt');
      showAppAlert('Could not save', String(e));
    }
  }, [addRound, holesRows, match, matchId, preferredLogPlatform, userId]);

  if (!supabaseOn) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.centered, { padding: gutter }]}>
          <Text style={styles.muted}>Supabase not configured.</Text>
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

  if (err || !match) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.centered, { padding: gutter }]}>
          <Text style={styles.muted}>{err ?? 'Match not found.'}</Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.replace('/(tabs)/groups' as never)}>
            <Text style={styles.primaryBtnTxt}>Back to Social</Text>
          </Pressable>
        </View>
      </ContentWidth>
    );
  }

  if (match.status !== 'complete') {
    const backSocial = () => router.replace('/(tabs)/groups' as never);
    if (match.status === 'abandoned') {
      return (
        <ContentWidth bg={colors.surface}>
          <View style={[styles.centered, { padding: gutter }]}>
            <Text style={styles.title}>Match was abandoned</Text>
            <Pressable style={styles.primaryBtn} onPress={backSocial}>
              <Text style={styles.primaryBtnTxt}>Back to Social</Text>
            </Pressable>
          </View>
        </ContentWidth>
      );
    }
    if (match.status === 'declined') {
      return (
        <ContentWidth bg={colors.surface}>
          <View style={[styles.centered, { padding: gutter }]}>
            <Text style={styles.title}>Challenge declined</Text>
            <Text style={styles.muted}>This match was declined and will not be played.</Text>
            <Pressable style={styles.primaryBtn} onPress={backSocial}>
              <Text style={styles.primaryBtnTxt}>Back to Social</Text>
            </Pressable>
          </View>
        </ContentWidth>
      );
    }
    if (match.status === 'pending') {
      return (
        <ContentWidth bg={colors.surface}>
          <View style={[styles.centered, { padding: gutter }]}>
            <Text style={styles.title}>Challenge pending</Text>
            <Text style={styles.muted}>
              This direct challenge is waiting on the other player to respond on the Social tab.
            </Text>
            <Pressable style={styles.primaryBtn} onPress={backSocial}>
              <Text style={styles.primaryBtnTxt}>Back to Social</Text>
            </Pressable>
          </View>
        </ContentWidth>
      );
    }
    if (match.status === 'open') {
      return (
        <ContentWidth bg={colors.surface}>
          <View style={[styles.centered, { padding: gutter }]}>
            <Text style={styles.title}>Open challenge</Text>
            <Text style={styles.muted}>
              This challenge is still posted to the open feed and waiting for a SimCap player to accept.
            </Text>
            <Pressable style={styles.primaryBtn} onPress={backSocial}>
              <Text style={styles.primaryBtnTxt}>Back to Social</Text>
            </Pressable>
          </View>
        </ContentWidth>
      );
    }
    if (match.status === 'active' || match.status === 'waiting') {
      return (
        <ContentWidth bg={colors.surface}>
          <View style={[styles.centered, { padding: gutter }]}>
            <Text style={styles.title}>Match still in progress</Text>
            <Text style={styles.muted}>Final results appear here when both players finish every hole.</Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.replace(`/(tabs)/match-score/${matchId}` as never)}>
              <Text style={styles.primaryBtnTxt}>Continue scoring</Text>
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={backSocial}>
              <Text style={styles.secondaryBtnTxt}>Social</Text>
            </Pressable>
          </View>
        </ContentWidth>
      );
    }
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.centered, { padding: gutter }]}>
          <Text style={styles.title}>Match unavailable</Text>
          <Text style={styles.muted}>This match is not in a results-ready state.</Text>
          <Pressable style={styles.primaryBtn} onPress={backSocial}>
            <Text style={styles.primaryBtnTxt}>Back to Social</Text>
          </Pressable>
        </View>
      </ContentWidth>
    );
  }

  const n1 = match.player_1_net_score;
  const n2 = match.player_2_net_score;

  const grossP1 = holesRows
    .filter((r) => r.player_id === match.player_1_id)
    .reduce((s, r) => s + r.gross_score, 0);
  const grossP2 = match.player_2_id
    ? holesRows.filter((r) => r.player_id === match.player_2_id).reduce((s, r) => s + r.gross_score, 0)
    : 0;

  const fmtGrossNet = (gross: number, net: number | null | undefined) => {
    const gStr = gross > 0 ? String(gross) : '—';
    const nNum = net != null && Number.isFinite(Number(net)) ? Number(net) : null;
    const nStr = nNum != null ? (Number.isInteger(nNum) ? String(nNum) : nNum.toFixed(1)) : '—';
    return `${gStr} gross · ${nStr} net`;
  };

  const winnerLine =
    match.winner_id == null
      ? 'Tied match — halved on net stroke play.'
      : match.winner_id === match.player_1_id
        ? `${names.p1} wins on net score.`
        : `${names.p2} wins on net score.`;

  return (
    <ContentWidth bg={colors.surface}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: 20,
          paddingBottom: insets.bottom + 28,
        }}
      >
        <Text style={styles.eyebrow}>Match results</Text>
        <Text style={styles.course}>{match.course_name}</Text>
        <Text style={styles.winner}>{winnerLine}</Text>

        <View style={styles.scoreCard}>
          <View style={styles.scoreRow}>
            <Text style={styles.scoreName} numberOfLines={1}>
              {names.p1}
            </Text>
            <Text style={styles.scoreVal}>{fmtGrossNet(grossP1, n1)}</Text>
          </View>
          <View style={styles.scoreRow}>
            <Text style={styles.scoreName} numberOfLines={1}>
              {names.p2}
            </Text>
            <Text style={styles.scoreVal}>{fmtGrossNet(grossP2, n2)}</Text>
          </View>
        </View>

        {match.verification_required ? (
          <View style={styles.verifyCard}>
            <Text style={styles.verifyTitle}>Scorecard verification</Text>
            <Text style={styles.verifyRow}>
              {verificationStatusEmoji(playerVerificationUiState(match, true))}{' '}
              {names.p1}: {verificationStatusLabel(playerVerificationUiState(match, true))}
            </Text>
            {match.player_2_id ? (
              <Text style={styles.verifyRow}>
                {verificationStatusEmoji(playerVerificationUiState(match, false))}{' '}
                {names.p2}: {verificationStatusLabel(playerVerificationUiState(match, false))}
              </Text>
            ) : null}
          </View>
        ) : null}

        {match.player_2_id &&
        userId &&
        (userId === match.player_1_id || userId === match.player_2_id) ? (
          <Pressable
            style={[styles.secondaryBtn, styles.rematchBtn, rematchBusy && styles.btnBusy]}
            disabled={rematchBusy}
            onPress={() => void onRematch()}
            accessibilityRole="button"
            accessibilityLabel="Rematch this opponent"
          >
            {rematchBusy ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.secondaryBtnTxt}>Rematch</Text>
            )}
          </Pressable>
        ) : null}

        {match.player_2_id ? (
          <View style={styles.holeByHole}>
            <Text style={styles.holeByHoleTitle}>Hole-by-hole</Text>
            <View style={styles.hbhHead}>
              <Text style={[styles.hbhTh, styles.hbhHole]}>Hole</Text>
              <Text style={[styles.hbhTh, styles.hbhCol]} numberOfLines={1}>
                {names.p1}
              </Text>
              <Text style={[styles.hbhTh, styles.hbhCol]} numberOfLines={1}>
                {names.p2}
              </Text>
            </View>
            {holeNumsList.map((h) => {
              const g1 = grossMapsComplete.p1.get(h);
              const g2 = grossMapsComplete.p2.get(h);
              const row1 = holesRows.find(
                (r) => r.player_id === match.player_1_id && r.hole_number === h
              );
              const row2 = holesRows.find(
                (r) => r.player_id === match.player_2_id && r.hole_number === h
              );
              const rx1 = row1?.player_2_reaction?.trim();
              const rx2 = row2?.player_1_reaction?.trim();
              return (
                <View key={h} style={styles.hbhRow}>
                  <Text style={[styles.hbhTd, styles.hbhHole]}>{h}</Text>
                  <View style={[styles.hbhCell, styles.hbhCol]}>
                    <View style={styles.hbhGrossRow}>
                      <Text style={styles.hbhGrossNum}>{g1 ?? '—'}</Text>
                      {rx1 ? <Text style={styles.hbhRxInline}>{rx1}</Text> : null}
                    </View>
                  </View>
                  <View style={[styles.hbhCell, styles.hbhCol]}>
                    <View style={styles.hbhGrossRow}>
                      <Text style={styles.hbhGrossNum}>{g2 ?? '—'}</Text>
                      {rx2 ? <Text style={styles.hbhRxInline}>{rx2}</Text> : null}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {indexRoundUi === 'prompt' || indexRoundUi === 'saving' ? (
          <View style={styles.indexPromptCard}>
            <Text style={styles.indexPromptTitle}>Save this round to your SimCap index?</Text>
            <Text style={styles.indexPromptBody}>
              This will count toward your handicap calculation like a regular logged round.
            </Text>
            <View style={styles.indexBtnRow}>
              <Pressable
                style={[styles.secondaryBtn, styles.indexBtnFlex]}
                disabled={indexRoundUi === 'saving'}
                onPress={() => void onSkipSaveToIndex()}
                accessibilityRole="button"
                accessibilityLabel="Skip saving to index"
              >
                <Text style={styles.secondaryBtnTxt}>Skip</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, styles.indexBtnFlex, indexRoundUi === 'saving' && styles.btnBusy]}
                disabled={indexRoundUi === 'saving'}
                onPress={() => void onSaveToIndex()}
                accessibilityRole="button"
                accessibilityLabel="Save to index"
              >
                {indexRoundUi === 'saving' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnTxt}>Save to index</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : indexRoundUi === 'saved' ? (
          <Text style={styles.indexSavedNote}>This match is saved to your SimCap index.</Text>
        ) : null}

        <Text style={styles.note}>
          Lower net wins. Course handicaps use each player&apos;s SimCap index and their tee (rating / slope) vs course par,
          with strokes given on the hardest holes by stroke index — no round-logging difficulty modifier.
        </Text>

        <Pressable
          style={[styles.primaryBtn, styles.primaryBtnSpaced]}
          onPress={() => router.replace('/(tabs)/groups' as never)}
        >
          <Text style={styles.primaryBtnTxt}>Back to Social</Text>
        </Pressable>
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', minHeight: 220 },
  muted: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 21 },
  title: { fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: 10, textAlign: 'center' },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.sage,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  course: { fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 14 },
  winner: { fontSize: 16, fontWeight: '600', color: colors.header, marginBottom: 18, lineHeight: 22 },
  scoreCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    padding: 14,
    marginBottom: 16,
  },
  verifyCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
    backgroundColor: colors.accentSoft,
    padding: 14,
    marginBottom: 16,
  },
  verifyTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.forestDeep,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  verifyRow: { fontSize: 14, color: colors.ink, marginTop: 4, lineHeight: 20 },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  scoreName: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink, paddingRight: 12 },
  scoreVal: { fontSize: 16, fontWeight: '800', color: colors.ink },
  rematchBtn: { marginTop: 4, marginBottom: 14 },
  holeByHole: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    padding: 14,
    marginBottom: 16,
  },
  holeByHoleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 10,
  },
  hbhHead: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingBottom: 8,
    marginBottom: 6,
  },
  hbhRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6 },
  hbhTh: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.subtle,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  hbhTd: { fontSize: 13, color: colors.muted, fontWeight: '600' },
  hbhHole: { width: 40 },
  hbhCol: { flex: 1, minWidth: 0 },
  hbhCell: { alignItems: 'center' },
  hbhGrossRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  hbhGrossNum: { fontSize: 15, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  hbhRxInline: { fontSize: 17, lineHeight: 20 },
  indexPromptCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 14,
    marginBottom: 16,
  },
  indexPromptTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 8, lineHeight: 22 },
  indexPromptBody: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 14 },
  indexBtnRow: { flexDirection: 'row', gap: 10 },
  indexBtnFlex: { flex: 1, minWidth: 0 },
  indexSavedNote: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accentDark,
    marginBottom: 16,
    lineHeight: 19,
  },
  note: { fontSize: 12, color: colors.subtle, lineHeight: 18, marginBottom: 22 },
  primaryBtn: {
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryBtnSpaced: { marginBottom: 12 },
  primaryBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnBusy: { opacity: 0.88 },
  secondaryBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.sage,
    backgroundColor: colors.accentSoft,
  },
  secondaryBtnTxt: { fontSize: 15, fontWeight: '700', color: colors.accent },
});
