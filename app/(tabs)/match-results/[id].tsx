import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { colors } from '../../../src/lib/constants';
import {
  getMatchById,
  listMatchHoles,
  type DbMatchHoleRow,
  type DbMatchRow,
} from '../../../src/lib/matchPlay';
import { useResponsive } from '../../../src/lib/responsive';
import { isSupabaseConfigured, supabase } from '../../../src/lib/supabase';

export default function MatchResultsScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const matchId = typeof rawId === 'string' ? rawId : rawId?.[0] ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();

  const [match, setMatch] = useState<DbMatchRow | null>(null);
  const [names, setNames] = useState<{ p1: string; p2: string }>({ p1: 'Player 1', p2: 'Player 2' });
  const [holesRows, setHolesRows] = useState<DbMatchHoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const supabaseOn = isSupabaseConfigured();

  const load = useCallback(async () => {
    if (!matchId || !supabaseOn) {
      setLoading(false);
      setErr('Missing match.');
      return;
    }
    setLoading(true);
    setErr(null);
    const res = await getMatchById(matchId);
    if (res.error || !res.data) {
      setErr(res.error ?? 'Could not load match.');
      setMatch(null);
      setHolesRows([]);
      setLoading(false);
      return;
    }
    const m = res.data;
    setMatch(m);
    const holesRes = await listMatchHoles(matchId);
    setHolesRows(holesRes.data ?? []);
    if (supabase && m.player_2_id) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', [m.player_1_id, m.player_2_id]);
      const map: Record<string, string> = {};
      for (const row of (profs ?? []) as { id: string; display_name?: string }[]) {
        map[row.id] = row.display_name?.trim() || 'Golfer';
      }
      setNames({ p1: map[m.player_1_id] ?? 'Player 1', p2: map[m.player_2_id] ?? 'Player 2' });
    }
    setLoading(false);
  }, [matchId, supabaseOn]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

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
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.centered, { padding: gutter }]}>
          <Text style={styles.title}>Match still in progress</Text>
          <Text style={styles.muted}>Final results appear here when both players finish every hole.</Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.replace(`/(tabs)/match-score/${matchId}` as never)}>
            <Text style={styles.primaryBtnTxt}>Continue scoring</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={() => router.replace('/(tabs)/groups' as never)}>
            <Text style={styles.secondaryBtnTxt}>Social</Text>
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

        <Text style={styles.note}>
          Lower net wins. Course handicaps use each player&apos;s SimCap index and their tee (rating / slope) vs course par,
          with strokes given on the hardest holes by stroke index — no round-logging difficulty modifier.
        </Text>

        <Pressable style={styles.primaryBtn} onPress={() => router.replace('/(tabs)/groups' as never)}>
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
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  scoreName: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.ink, paddingRight: 12 },
  scoreVal: { fontSize: 16, fontWeight: '800', color: colors.ink },
  note: { fontSize: 12, color: colors.subtle, lineHeight: 18, marginBottom: 22 },
  primaryBtn: {
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
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
