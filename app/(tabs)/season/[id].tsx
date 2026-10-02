import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthContext';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { confirmAppChoice, showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import { formatLeagueFormatLabel } from '../../../src/lib/leagueStandings';
import { useResponsive } from '../../../src/lib/responsive';
import { formatSeasonDateRange } from '../../../src/lib/seasonPoints';
import { fetchSeasonBoard, fetchSeasonById, updateSeasonStatus, type SeasonBoard } from '../../../src/lib/seasons';
import { isSocialGroupManager } from '../../../src/lib/socialGroupCreator';
import { resolveSocialGroupsAccessToken } from '../../../src/lib/socialGroups';
import { useAppStore } from '../../../src/store/useAppStore';

export default function SeasonScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const seasonId = typeof rawId === 'string' ? rawId : rawId?.[0] ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user, session } = useAuth();
  const groups = useAppStore((s) => s.groups);
  const [board, setBoard] = useState<SeasonBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [ending, setEnding] = useState(false);

  const group = useMemo(
    () => groups.find((g) => g.id === board?.season.group_id),
    [groups, board?.season.group_id]
  );
  const displayNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const member of group?.members ?? []) {
      if (member.userId) names[member.userId] = member.displayName.replace(' (you)', '');
    }
    return names;
  }, [group?.members]);
  const authUserId = session?.user?.id ?? user?.id ?? null;
  const canManage = isSocialGroupManager(group, authUserId);

  const load = useCallback(async () => {
    setLoading(true);
    const accessToken =
      googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
    const seasonRes = await fetchSeasonById(seasonId, accessToken);
    const season = seasonRes.data;
    if (!season) {
      setBoard(null);
      setMissing(true);
      setLoading(false);
      return;
    }
    const names: Record<string, string> = {};
    const crew = useAppStore.getState().groups.find((g) => g.id === season.group_id);
    for (const member of crew?.members ?? []) {
      if (member.userId) names[member.userId] = member.displayName.replace(' (you)', '');
    }
    const scored = await fetchSeasonBoard(seasonId, accessToken, names);
    setBoard(scored.data);
    setMissing(!scored.data);
    setLoading(false);
  }, [seasonId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onEnd = async () => {
    if (!board || board.season.status !== 'active') return;
    const choice = await confirmAppChoice(
      'End this season?',
      'Standings stay available. Tournaments keep their own results. You can start a new season after this one ends.',
      { cancelText: 'Cancel', confirmText: 'End season' }
    );
    if (choice !== 'confirm') return;
    setEnding(true);
    const accessToken =
      googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
    const res = await updateSeasonStatus(board.season.id, 'completed', accessToken);
    setEnding(false);
    if (res.error) {
      showAppAlert('Could not end season', res.error);
      return;
    }
    void load();
  };

  if (loading && !board) {
    return (
      <ContentWidth bg={colors.surface}>
        <ActivityIndicator color={colors.header} style={{ marginTop: 32 }} />
      </ContentWidth>
    );
  }

  if (missing || !board) {
    return (
      <ContentWidth bg={colors.surface}>
        <Text style={{ padding: gutter, color: colors.muted }}>Season not found.</Text>
      </ContentWidth>
    );
  }

  const { season, leagues, standings } = board;
  const active = season.status === 'active';

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
            <Text style={styles.pillTxt}>{active ? 'Active' : 'Completed'}</Text>
          </View>
        </View>
        <Text style={styles.title}>{season.name}</Text>
        <Text style={styles.meta}>{formatSeasonDateRange(season.start_date, season.end_date)}</Text>
        <Text style={styles.meta}>
          {season.events_that_count == null
            ? 'Every finished event counts'
            : `Best ${season.events_that_count} events count`}
        </Text>

        <Text style={styles.section}>Standings</Text>
        {standings.length === 0 ? (
          <Text style={styles.empty}>No finished events yet. Points show up after a tournament ends.</Text>
        ) : (
          standings.map((row) => (
            <View key={row.userId} style={styles.row}>
              <Text style={styles.rank}>{row.rank}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{displayNames[row.userId] ?? 'Golfer'}</Text>
                <Text style={styles.sub}>
                  {row.eventsCounted} of {row.eventsPlayed} counted
                </Text>
              </View>
              <Text style={styles.points}>{row.totalPoints}</Text>
            </View>
          ))
        )}

        <Text style={styles.section}>Tournaments</Text>
        {leagues.length === 0 ? (
          <Text style={styles.empty}>No tournaments in this season yet.</Text>
        ) : (
          leagues.map((league) => (
            <Pressable
              key={league.id}
              style={styles.leagueRow}
              onPress={() => router.push(`/(tabs)/league/${league.id}` as never)}
            >
              <Text style={styles.name}>{league.name}</Text>
              <Text style={styles.sub}>
                {formatLeagueFormatLabel(league.format)} · {league.status}
              </Text>
            </Pressable>
          ))
        )}

        {canManage && active ? (
          <Pressable
            style={[styles.endBtn, ending && { opacity: 0.6 }]}
            disabled={ending}
            onPress={() => void onEnd()}
          >
            <Text style={styles.endBtnTxt}>{ending ? 'Ending…' : 'End season'}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', marginBottom: 8 },
  pill: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillTxt: { fontSize: 11, fontWeight: '700', color: colors.accentDark },
  title: { fontSize: 24, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 13, color: colors.muted, marginTop: 4 },
  section: {
    marginTop: 22,
    marginBottom: 8,
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
  },
  empty: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rank: { width: 24, fontSize: 16, fontWeight: '700', color: colors.ink },
  name: { fontSize: 15, fontWeight: '600', color: colors.ink },
  sub: { fontSize: 12, color: colors.subtle, marginTop: 2 },
  points: { fontSize: 18, fontWeight: '700', color: colors.ink },
  leagueRow: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  endBtn: {
    marginTop: 28,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 12,
    alignItems: 'center',
  },
  endBtnTxt: { fontSize: 15, fontWeight: '700', color: colors.ink },
});
