import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthContext';
import { isSocialGroupCreator } from '../../../src/lib/socialGroupCreator';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { colors } from '../../../src/lib/constants';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import {
  fetchLeagueBundle,
  fetchMatchWinsForLeague,
  syncLeagueStatuses,
  type LeagueBundle,
} from '../../../src/lib/leagues';
import {
  computeLeagueStandings,
  formatLeagueDateRange,
  formatLeagueFormatLabel,
  isLeagueActive,
  leagueDaysRemaining,
} from '../../../src/lib/leagueStandings';
import { useResponsive } from '../../../src/lib/responsive';
import { useAppStore } from '../../../src/store/useAppStore';

export default function LeagueDetailScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const leagueId = typeof rawId === 'string' ? rawId : rawId?.[0] ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user, session } = useAuth();
  const groups = useAppStore((s) => s.groups);

  const [bundle, setBundle] = useState<LeagueBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [matchWins, setMatchWins] = useState<Record<string, number>>({});

  const group = useMemo(
    () => groups.find((g) => g.id === bundle?.league.group_id),
    [groups, bundle?.league.group_id]
  );
  const authUserId = session?.user?.id ?? user?.id ?? null;
  const isCreator = isSocialGroupCreator(group, authUserId);

  const displayNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mem of group?.members ?? []) {
      if (mem.userId) m[mem.userId] = mem.displayName.replace(' (you)', '');
    }
    return m;
  }, [group?.members]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchLeagueBundle(leagueId, googleOAuthAccessToken ?? undefined);
    if (res.data) {
      const synced = await syncLeagueStatuses([res.data.league], googleOAuthAccessToken ?? undefined);
      const league = synced[0] ?? res.data.league;
      setBundle({ ...res.data, league });
      if (league.format === 'match_play') {
        const ids = res.data.entries.map((e) => e.user_id);
        const wins = await fetchMatchWinsForLeague(league, ids, googleOAuthAccessToken ?? undefined);
        setMatchWins(wins);
      }
    } else {
      setBundle(null);
    }
    setLoading(false);
  }, [leagueId]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const standings = useMemo(() => {
    if (!bundle) return [];
    return computeLeagueStandings({
      league: bundle.league,
      entries: bundle.entries,
      rounds: bundle.rounds,
      teams: bundle.teams,
      displayNames,
      matchWinsByUser: matchWins,
    });
  }, [bundle, displayNames, matchWins]);

  const myStanding = useMemo(() => {
    if (!user?.id) return null;
    return standings.find((s) => s.userId === user.id) ?? null;
  }, [standings, user?.id]);

  if (loading) {
    return (
      <ContentWidth bg={colors.surface}>
        <ActivityIndicator color={colors.header} style={{ marginTop: 40 }} />
      </ContentWidth>
    );
  }

  if (!bundle) {
    return (
      <ContentWidth bg={colors.surface}>
        <Text style={{ padding: gutter }}>Tournament not found.</Text>
      </ContentWidth>
    );
  }

  const { league } = bundle;
  const completed = league.status === 'completed' || !isLeagueActive(league);

  return (
    <ContentWidth bg={colors.surface}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: 14,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <View style={styles.badgeRow}>
          <View style={styles.pill}>
            <Text style={styles.pillTxt}>{formatLeagueFormatLabel(league.format)}</Text>
          </View>
          {!completed ? (
            <View style={styles.pillMuted}>
              <Text style={styles.pillMutedTxt}>{leagueDaysRemaining(league)} days left</Text>
            </View>
          ) : (
            <View style={styles.pillMuted}>
              <Text style={styles.pillMutedTxt}>Completed</Text>
            </View>
          )}
        </View>
        <Text style={styles.title}>{league.name}</Text>
        <Text style={styles.dates}>
          {formatLeagueDateRange(league.start_date, league.end_date)}
        </Text>
        {league.notes?.trim() ? (
          <Text style={styles.notes}>{league.notes.trim()}</Text>
        ) : null}

        {completed ? (
          <View style={styles.podium}>
            {standings[0] ? (
              <View style={[styles.trophyCard, styles.trophyCardGold]}>
                <Text style={styles.trophyEmoji}>🏆</Text>
                <Text style={styles.trophyTitle}>{standings[0].displayName}</Text>
                <Text style={styles.trophySub}>Tournament champion</Text>
              </View>
            ) : null}
            {standings[1] ? (
              <View style={[styles.trophyCard, styles.trophyCardSilver]}>
                <Text style={styles.trophyEmoji}>🥈</Text>
                <Text style={styles.trophyTitle}>{standings[1].displayName}</Text>
                <Text style={styles.trophySub}>2nd place</Text>
              </View>
            ) : null}
            {standings[2] ? (
              <View style={[styles.trophyCard, styles.trophyCardBronze]}>
                <Text style={styles.trophyEmoji}>🥉</Text>
                <Text style={styles.trophyTitle}>{standings[2].displayName}</Text>
                <Text style={styles.trophySub}>3rd place</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.tableCard}>
          <View style={styles.tableHead}>
            <Text style={[styles.th, styles.colRank]}>#</Text>
            <Text style={[styles.th, styles.colName]}>Player</Text>
            <Text style={[styles.th, styles.colR]}>Rds</Text>
            <Text style={[styles.th, styles.colScore]}>
              {league.format === 'match_play' ? 'Wins' : 'Avg net'}
            </Text>
          </View>
          {standings.map((s) => (
            <View key={s.entryId} style={styles.tr}>
              <Text style={[styles.td, styles.colRank]}>{s.rank}</Text>
              <View style={[styles.colName, styles.nameCol]}>
                <Text style={styles.tdName}>{s.displayName}</Text>
                {s.isTeam && s.memberNames.length > 0 ? (
                  <Text style={styles.tdSub}>{s.memberNames.join(', ')}</Text>
                ) : null}
              </View>
              <Text style={[styles.td, styles.colR]}>{s.roundsPlayed}</Text>
              <Text style={[styles.td, styles.colScore]}>
                {league.format === 'match_play'
                  ? String(s.points)
                  : s.avgNet != null
                    ? s.avgNet.toFixed(1)
                    : '—'}
              </Text>
            </View>
          ))}
        </View>

        {myStanding || user?.id ? (
          <View style={styles.myStats}>
            <Text style={styles.myStatsTitle}>My stats</Text>
            <Text style={styles.myStatsLine}>
              Position: {myStanding?.rank ?? '—'} · Rounds: {myStanding?.roundsPlayed ?? 0}
            </Text>
            {league.format !== 'match_play' && myStanding?.avgNet != null ? (
              <Text style={styles.myStatsLine}>Avg net: {myStanding.avgNet.toFixed(1)}</Text>
            ) : null}
          </View>
        ) : null}

        {isCreator ? (
          <Pressable
            style={styles.manageBtn}
            onPress={() => router.push(`/(tabs)/league-manage/${leagueId}` as never)}
          >
            <Text style={styles.manageBtnTxt}>Manage tournament</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  pill: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
  },
  pillTxt: { fontSize: 11, fontWeight: '700', color: colors.accentDark },
  pillMuted: { backgroundColor: colors.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillMutedTxt: { fontSize: 11, fontWeight: '600', color: colors.muted },
  title: { fontSize: 24, fontWeight: '700', color: colors.ink },
  dates: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 16 },
  notes: {
    fontSize: 14,
    color: colors.ink,
    lineHeight: 20,
    marginTop: -8,
    marginBottom: 16,
  },
  podium: { gap: 10, marginBottom: 16 },
  trophyCard: {
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  trophyCardGold: {
    backgroundColor: '#f0f7f3',
    borderColor: colors.sage,
  },
  trophyCardSilver: {
    backgroundColor: colors.bg,
  },
  trophyCardBronze: {
    backgroundColor: colors.bg,
  },
  trophyEmoji: { fontSize: 36 },
  trophyTitle: { fontSize: 20, fontWeight: '700', color: colors.ink, marginTop: 8 },
  trophySub: { fontSize: 13, color: colors.muted, marginTop: 4 },
  tableCard: {
    backgroundColor: '#f0f7f3',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tableHead: { flexDirection: 'row', padding: 12, backgroundColor: colors.accentSoft },
  th: { fontSize: 10, fontWeight: '700', color: colors.subtle, textTransform: 'uppercase' },
  tr: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  td: { fontSize: 13, color: colors.ink },
  tdName: { fontSize: 14, fontWeight: '600', color: colors.ink },
  tdSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  colRank: { width: 28 },
  colName: { flex: 1 },
  colR: { width: 36, textAlign: 'center' },
  colScore: { width: 56, textAlign: 'right' },
  nameCol: { paddingRight: 8 },
  myStats: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  myStatsTitle: { fontSize: 12, fontWeight: '700', color: colors.sage, textTransform: 'uppercase' },
  myStatsLine: { fontSize: 14, color: colors.ink, marginTop: 6 },
  manageBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.sage,
    alignItems: 'center',
  },
  manageBtnTxt: { color: colors.accentDark, fontWeight: '700', fontSize: 15 },
});
