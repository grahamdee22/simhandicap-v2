import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthContext';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { colors } from '../../../src/lib/constants';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import { fetchLeagueBundle, type LeagueBundle } from '../../../src/lib/leagues';
import {
  BRACKET_HALVED_TIEBREAKER_BODY,
  bracketHalvedAdvanceLine,
} from '../../../src/lib/matchPlayBracketCopy';
import { formatMatchPlayStatus } from '../../../src/lib/matchPlayTournament';
import {
  formatPairingStatusLabel,
  myHolesWonInPairing,
  type DbLeagueMatchPairingRow,
} from '../../../src/lib/matchPlayTournamentPairings';
import { fetchTournamentHoleScores } from '../../../src/lib/tournamentHoleScores';
import { restSelect } from '../../../src/lib/tournamentApi';
import type { DbTournamentHoleScoreRow } from '../../../src/lib/tournamentTypes';
import { useResponsive } from '../../../src/lib/responsive';
import { useAppStore } from '../../../src/store/useAppStore';

type PairingRoundLink = {
  pairing_id: string;
  league_round_id: string;
  submitted_by_entry_id: string;
};

export default function LeagueMatchDetailScreen() {
  const { pairingId: rawId } = useLocalSearchParams<{ pairingId: string | string[] }>();
  const pairingId = typeof rawId === 'string' ? rawId : rawId?.[0] ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user } = useAuth();
  const groups = useAppStore((s) => s.groups);

  const [pairing, setPairing] = useState<DbLeagueMatchPairingRow | null>(null);
  const [bundle, setBundle] = useState<LeagueBundle | null>(null);
  const [p1Holes, setP1Holes] = useState<DbTournamentHoleScoreRow[]>([]);
  const [p2Holes, setP2Holes] = useState<DbTournamentHoleScoreRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const token = googleOAuthAccessToken ?? undefined;
    const path = `league_match_pairings?id=eq.${encodeURIComponent(pairingId)}&limit=1`;
    const res = await restSelect<DbLeagueMatchPairingRow>(path, token);
    const row = res.data?.[0] ?? null;
    setPairing(row);
    if (row) {
      const b = await fetchLeagueBundle(row.league_id, token);
      setBundle(b.data ?? null);
      const linksRes = await restSelect<PairingRoundLink>(
        `league_match_pairing_rounds?pairing_id=eq.${encodeURIComponent(pairingId)}&select=pairing_id,league_round_id,submitted_by_entry_id`,
        token
      );
      const links = linksRes.data ?? [];
      const p1Link = links.find((l) => l.submitted_by_entry_id === row.player_1_entry_id);
      const p2Link = links.find((l) => l.submitted_by_entry_id === row.player_2_entry_id);
      if (p1Link) {
        const h = await fetchTournamentHoleScores(p1Link.league_round_id, token);
        setP1Holes(h.data ?? []);
      } else {
        setP1Holes([]);
      }
      if (p2Link) {
        const h = await fetchTournamentHoleScores(p2Link.league_round_id, token);
        setP2Holes(h.data ?? []);
      } else {
        setP2Holes([]);
      }
    } else {
      setBundle(null);
      setP1Holes([]);
      setP2Holes([]);
    }
    setLoading(false);
  }, [pairingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const group = useMemo(
    () => groups.find((g) => g.id === bundle?.league.group_id),
    [groups, bundle?.league.group_id]
  );

  const displayNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mem of group?.members ?? []) {
      if (mem.userId) m[mem.userId] = mem.displayName.replace(' (you)', '');
    }
    return m;
  }, [group?.members]);

  const p1 = bundle?.entries.find((e) => e.id === pairing?.player_1_entry_id);
  const p2 = bundle?.entries.find((e) => e.id === pairing?.player_2_entry_id);
  const name1 = p1 ? displayNames[p1.user_id] ?? 'Player 1' : 'Player 1';
  const name2 = p2 ? displayNames[p2.user_id] ?? 'Player 2' : 'Player 2';

  const myEntry = useMemo(() => {
    if (!user?.id || !bundle) return null;
    return bundle.entries.find((e) => e.user_id === user.id) ?? null;
  }, [bundle, user?.id]);

  const holeGrid = useMemo(() => {
    if (p1Holes.length < 18 || p2Holes.length < 18) return null;
    const p1ByHole = new Map(p1Holes.map((h) => [h.hole_number, h]));
    const p2ByHole = new Map(p2Holes.map((h) => [h.hole_number, h]));
    const rows: {
      hole: number;
      g1: number;
      g2: number;
      result: string;
    }[] = [];
    for (let n = 1; n <= 18; n += 1) {
      const h1 = p1ByHole.get(n);
      const h2 = p2ByHole.get(n);
      if (h1?.gross_score == null || h2?.gross_score == null) return null;
      const g1 = h1.gross_score;
      const g2 = h2.gross_score;
      let result = 'H';
      if (g1 < g2) result = 'W';
      else if (g2 < g1) result = 'L';
      rows.push({ hole: n, g1, g2, result: h1.result ?? result });
    }
    return rows;
  }, [p1Holes, p2Holes]);

  const matchStatusLine = useMemo(() => {
    if (!pairing || pairing.status === 'scheduled') return null;
    const net = pairing.holes_won_p1 - pairing.holes_won_p2;
    return formatMatchPlayStatus(
      {
        wins: pairing.holes_won_p1,
        losses: pairing.holes_won_p2,
        halved: pairing.holes_halved,
        net_holes: net,
      },
      18
    );
  }, [pairing]);

  if (loading) {
    return (
      <ContentWidth bg={colors.surface}>
        <ActivityIndicator color={colors.header} style={{ marginTop: 40 }} />
      </ContentWidth>
    );
  }

  if (!pairing) {
    return (
      <ContentWidth bg={colors.surface}>
        <Text style={{ padding: gutter }}>Match not found.</Text>
      </ContentWidth>
    );
  }

  const statusLabel = formatPairingStatusLabel(pairing.status);
  const isComplete = pairing.status === 'complete' || pairing.status === 'halved';

  return (
    <ContentWidth bg={colors.surface}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: 14,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <View style={styles.statusPill}>
          <Text style={styles.statusPillTxt}>{statusLabel}</Text>
        </View>

        <View style={styles.playersRow}>
          <View style={styles.playerCol}>
            <Text style={styles.playerName}>{name1}</Text>
            <Text style={styles.holesWon}>{pairing.holes_won_p1}</Text>
            <Text style={styles.holesLbl}>holes won</Text>
          </View>
          <Text style={styles.vs}>vs</Text>
          <View style={styles.playerCol}>
            <Text style={styles.playerName}>{name2}</Text>
            <Text style={styles.holesWon}>{pairing.holes_won_p2}</Text>
            <Text style={styles.holesLbl}>holes won</Text>
          </View>
        </View>

        {matchStatusLine ? <Text style={styles.statusLine}>{matchStatusLine}</Text> : null}
        <Text style={styles.halvedLine}>{pairing.holes_halved} holes halved</Text>

        {isComplete && pairing.winner_entry_id ? (
          <Text style={styles.resultLine}>
            Winner: {pairing.winner_entry_id === pairing.player_1_entry_id ? name1 : name2}
          </Text>
        ) : null}
        {pairing.status === 'halved' ? (
          <Text style={styles.resultLine}>
            {bundle?.league.match_play_pairing_method === 'bracket' && pairing.winner_entry_id
              ? bracketHalvedAdvanceLine(
                  pairing.winner_entry_id === pairing.player_1_entry_id ? name1 : name2
                )
              : 'Match halved — 1 point each'}
          </Text>
        ) : null}

        {bundle?.league.match_play_pairing_method === 'bracket' ? (
          <View style={styles.tiebreakBox}>
            <Text style={styles.tiebreakTitle}>Bracket tiebreaker</Text>
            <Text style={styles.tiebreakLine}>{BRACKET_HALVED_TIEBREAKER_BODY}</Text>
          </View>
        ) : null}

        {holeGrid ? (
          <View style={styles.gridCard}>
            <Text style={styles.gridTitle}>Hole-by-hole</Text>
            <View style={styles.gridHead}>
              <Text style={[styles.gridTh, styles.colHole]}>Hole</Text>
              <Text style={[styles.gridTh, styles.colGross]}>{name1.split(' ')[0]}</Text>
              <Text style={[styles.gridTh, styles.colGross]}>{name2.split(' ')[0]}</Text>
              <Text style={[styles.gridTh, styles.colRes]}>Result</Text>
            </View>
            {holeGrid.map((row) => (
              <View key={row.hole} style={styles.gridRow}>
                <Text style={[styles.gridTd, styles.colHole]}>{row.hole}</Text>
                <Text style={[styles.gridTd, styles.colGross]}>{row.g1}</Text>
                <Text style={[styles.gridTd, styles.colGross]}>{row.g2}</Text>
                <Text style={[styles.gridTd, styles.colRes]}>{row.result}</Text>
              </View>
            ))}
          </View>
        ) : pairing.status === 'in_progress' ? (
          <Text style={styles.waitingTxt}>
            Waiting for both players to submit complete scorecards before hole-by-hole results appear.
          </Text>
        ) : null}

        {myEntry &&
        (pairing.player_1_entry_id === myEntry.id || pairing.player_2_entry_id === myEntry.id) ? (
          <View style={styles.myBox}>
            <Text style={styles.myBoxTitle}>Your result</Text>
            <Text style={styles.myBoxLine}>
              You won {myHolesWonInPairing(pairing, myEntry.id)} holes in this match.
            </Text>
            {pairing.status === 'scheduled' ? (
              <Text style={styles.myBoxHint}>
                Log a round and enter gross scores hole-by-hole to record your match.
              </Text>
            ) : null}
          </View>
        ) : null}

        <Pressable
          style={styles.backBtn}
          onPress={() =>
            bundle
              ? router.replace(`/(tabs)/league/${bundle.league.id}` as never)
              : router.back()
          }
        >
          <Text style={styles.backBtnTxt}>Back to tournament</Text>
        </Pressable>
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 20,
  },
  statusPillTxt: { fontSize: 12, fontWeight: '700', color: colors.accentDark },
  playersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  playerCol: { flex: 1, alignItems: 'center' },
  playerName: { fontSize: 16, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  holesWon: { fontSize: 36, fontWeight: '700', color: colors.header, marginTop: 8 },
  holesLbl: { fontSize: 12, color: colors.muted, marginTop: 4 },
  vs: { fontSize: 14, fontWeight: '600', color: colors.muted, paddingHorizontal: 12 },
  statusLine: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: colors.header,
    marginBottom: 8,
  },
  halvedLine: { textAlign: 'center', fontSize: 14, color: colors.muted, marginBottom: 16 },
  resultLine: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 16,
  },
  waitingTxt: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: 16,
    textAlign: 'center',
  },
  gridCard: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 16,
    overflow: 'hidden',
  },
  gridTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.sage,
    textTransform: 'uppercase',
    padding: 12,
    paddingBottom: 8,
  },
  gridHead: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  gridRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  gridTh: { fontSize: 10, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  gridTd: { fontSize: 13, color: colors.ink },
  colHole: { width: 36 },
  colGross: { flex: 1, textAlign: 'center' },
  colRes: { width: 36, textAlign: 'right', fontWeight: '700' },
  myBox: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 16,
  },
  myBoxTitle: { fontSize: 12, fontWeight: '700', color: colors.sage, textTransform: 'uppercase' },
  myBoxLine: { fontSize: 14, color: colors.ink, marginTop: 6 },
  myBoxHint: { fontSize: 13, color: colors.muted, marginTop: 8, lineHeight: 18 },
  backBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  backBtnTxt: { fontSize: 15, fontWeight: '600', color: colors.sage },
  tiebreakBox: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fff8e6',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e6c84a',
    marginBottom: 16,
  },
  tiebreakTitle: { fontSize: 12, fontWeight: '700', color: colors.sage, textTransform: 'uppercase' },
  tiebreakLine: { fontSize: 13, color: colors.ink, marginTop: 6, lineHeight: 18 },
});
