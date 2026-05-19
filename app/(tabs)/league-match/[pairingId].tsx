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
  formatPairingStatusLabel,
  myHolesWonInPairing,
  type DbLeagueMatchPairingRow,
} from '../../../src/lib/matchPlayTournamentPairings';
import { restSelect } from '../../../src/lib/tournamentApi';
import { useResponsive } from '../../../src/lib/responsive';
import { useAppStore } from '../../../src/store/useAppStore';

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
    } else {
      setBundle(null);
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

        <Text style={styles.halvedLine}>{pairing.holes_halved} holes halved</Text>

        {isComplete && pairing.winner_entry_id ? (
          <Text style={styles.resultLine}>
            Winner:{' '}
            {pairing.winner_entry_id === pairing.player_1_entry_id ? name1 : name2}
          </Text>
        ) : null}
        {pairing.status === 'halved' ? (
          <Text style={styles.resultLine}>Match halved — 1 point each</Text>
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
                Log a round and enter hole-by-hole W/L/H to record your match.
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
  halvedLine: { textAlign: 'center', fontSize: 14, color: colors.muted, marginBottom: 16 },
  resultLine: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 16,
  },
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
});
