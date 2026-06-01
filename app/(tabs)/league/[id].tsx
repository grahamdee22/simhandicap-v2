import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthContext';
import { isSocialGroupManager } from '../../../src/lib/socialGroupCreator';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { MatchPlayBracketSection } from '../../../src/components/MatchPlayBracketSection';
import { colors } from '../../../src/lib/constants';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import { resolveSocialGroupsAccessToken } from '../../../src/lib/socialGroups';
import {
  fetchLeagueBundle,
  syncLeagueStatuses,
  type LeagueBundle,
} from '../../../src/lib/leagues';
import {
  fetchLeagueMatchPairings,
  formatPairingResultLine,
  pairingPlayerNames,
  type DbLeagueMatchPairingRow,
} from '../../../src/lib/matchPlayTournamentPairings';
import { fetchTeamHoleScoresForLeague } from '../../../src/lib/tournamentTeamScores';
import type { DbTournamentTeamHoleScoreRow } from '../../../src/lib/tournamentTypes';
import {
  computeLeagueStandings,
  formatLeagueDateRange,
  formatLeagueFormatLabel,
  formatTeamMemberSummary,
  isLeagueActive,
  isTeamLeagueFormat,
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
  const [pairings, setPairings] = useState<DbLeagueMatchPairingRow[]>([]);
  const [teamHoleScores, setTeamHoleScores] = useState<DbTournamentTeamHoleScoreRow[]>([]);

  const group = useMemo(
    () => groups.find((g) => g.id === bundle?.league.group_id),
    [groups, bundle?.league.group_id]
  );
  const authUserId = session?.user?.id ?? user?.id ?? null;
  const canManage = isSocialGroupManager(group, authUserId);

  const displayNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mem of group?.members ?? []) {
      if (mem.userId) m[mem.userId] = mem.displayName.replace(' (you)', '');
    }
    return m;
  }, [group?.members]);

  const load = useCallback(async () => {
    setLoading(true);
    const accessToken =
      googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
    const res = await fetchLeagueBundle(leagueId, accessToken);
    if (res.data) {
      const synced = await syncLeagueStatuses([res.data.league], accessToken);
      const league = synced[0] ?? res.data.league;
      setBundle({ ...res.data, league });
      if (league.format === 'match_play') {
        const pr = await fetchLeagueMatchPairings(league.id, accessToken);
        setPairings(pr.data ?? []);
        setTeamHoleScores([]);
      } else if (league.format === 'best_ball') {
        setPairings([]);
        const th = await fetchTeamHoleScoresForLeague(league.id, accessToken);
        setTeamHoleScores(th.data ?? []);
      } else {
        setPairings([]);
        setTeamHoleScores([]);
      }
    } else {
      setBundle(null);
      setPairings([]);
      setTeamHoleScores([]);
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
      teamHoleScores:
        bundle.league.format === 'best_ball' ? teamHoleScores : undefined,
    });
  }, [bundle, displayNames, teamHoleScores]);

  const myEntry = useMemo(() => {
    if (!bundle || !user?.id) return null;
    return bundle.entries.find((e) => e.user_id === user.id) ?? null;
  }, [bundle, user?.id]);

  const myPairing = useMemo(() => {
    if (!myEntry) return null;
    return (
      pairings.find(
        (p) => p.player_1_entry_id === myEntry.id || p.player_2_entry_id === myEntry.id
      ) ?? null
    );
  }, [pairings, myEntry]);

  const myOpponentName = useMemo(() => {
    if (!myPairing || !myEntry || !bundle) return null;
    const oppEntryId =
      myPairing.player_1_entry_id === myEntry.id
        ? myPairing.player_2_entry_id
        : myPairing.player_1_entry_id;
    const opp = bundle.entries.find((e) => e.id === oppEntryId);
    return opp ? displayNames[opp.user_id] ?? 'Opponent' : 'Opponent';
  }, [myPairing, myEntry, bundle, displayNames]);

  const myStanding = useMemo(() => {
    if (!user?.id) return null;
    return standings.find((s) => s.userId === user.id) ?? null;
  }, [standings, user?.id]);

  const myTeamStanding = useMemo(() => {
    if (!bundle || !user?.id) return null;
    if (bundle.league.format !== 'scramble' && bundle.league.format !== 'best_ball') return null;
    const entry = bundle.entries.find((e) => e.user_id === user.id);
    if (!entry?.league_team_id) return null;
    return standings.find((s) => s.teamId === entry.league_team_id) ?? null;
  }, [bundle, standings, user?.id]);

  const myScrambleTeam = useMemo(() => {
    if (!bundle || !user?.id || bundle.league.format !== 'scramble') return null;
    const entry = bundle.entries.find((e) => e.user_id === user.id);
    return entry?.league_team_id
      ? bundle.teams.find((t) => t.id === entry.league_team_id) ?? null
      : null;
  }, [bundle, user?.id]);

  const isScrambleScorer = useMemo(() => {
    if (!myScrambleTeam || !user?.id) return false;
    if (!myScrambleTeam.designated_scorer_id) return true;
    return myScrambleTeam.designated_scorer_id === user.id;
  }, [myScrambleTeam, user?.id]);

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
  const isBracketMp = league.format === 'match_play' && league.match_play_pairing_method === 'bracket';
  const isLegacyMp = league.format === 'match_play' && !isBracketMp;
  const isTeamLeague = isTeamLeagueFormat(league.format);
  const playerCount = bundle.entries.length;
  const teamCount = bundle.teams.length;

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

        {isBracketMp ? (
          <MatchPlayBracketSection
            pairings={pairings}
            entries={bundle.entries}
            displayNames={displayNames}
            currentBracketRound={league.current_bracket_round}
            myEntryId={myEntry?.id ?? null}
            playerCount={playerCount}
          />
        ) : null}

        {isLegacyMp ? (
          <View style={styles.pairingsCard}>
            <Text style={styles.pairingsTitle}>Match pairings</Text>
            {pairings.length === 0 ? (
              <Text style={styles.pairingsEmpty}>
                No pairings yet. The group creator or an admin can assign matchups from Manage tournament.
              </Text>
            ) : (
              pairings.map((p) => {
                const { name1, name2 } = pairingPlayerNames(p, bundle.entries, displayNames);
                return (
                  <Pressable
                    key={p.id}
                    style={styles.pairingRow}
                    onPress={() => router.push(`/(tabs)/league-match/${p.id}` as never)}
                  >
                    <Text style={styles.pairingLine}>
                      {name1} vs. {name2}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </View>
        ) : null}

        {isLegacyMp && myPairing && myEntry && myOpponentName ? (
          <Pressable
            style={styles.matchCard}
            onPress={() => router.push(`/(tabs)/league-match/${myPairing.id}` as never)}
          >
            <Text style={styles.matchCardTitle}>Your match</Text>
            <Text style={styles.matchCardLine}>
              {formatPairingResultLine(myPairing, myEntry.id, myOpponentName)}
            </Text>
            <Text style={styles.matchCardLink}>Match details →</Text>
          </Pressable>
        ) : null}

        {completed && !isBracketMp ? (
          <View style={styles.podium}>
            {standings.length > 3 ? (
              <Text style={styles.podiumHint}>
                Top 3 of {standings.length} {isTeamLeague ? 'teams' : 'players'} — full standings
                below
              </Text>
            ) : null}
            {standings[0] ? (
              <View style={[styles.trophyCard, styles.trophyCardGold]}>
                <Text style={styles.trophyEmoji}>🏆</Text>
                <Text style={styles.trophyTitle} numberOfLines={2}>
                  {standings[0].displayName}
                </Text>
                <Text style={styles.trophySub}>Tournament champion</Text>
                {isTeamLeague && standings[0].memberNames.length > 0 ? (
                  <Text style={styles.trophyMembers} numberOfLines={2}>
                    {formatTeamMemberSummary(standings[0].memberNames)}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {standings[1] ? (
              <View style={[styles.trophyCard, styles.trophyCardSilver]}>
                <Text style={styles.trophyEmoji}>🥈</Text>
                <Text style={styles.trophyTitle} numberOfLines={2}>
                  {standings[1].displayName}
                </Text>
                <Text style={styles.trophySub}>2nd place</Text>
                {isTeamLeague && standings[1].memberNames.length > 0 ? (
                  <Text style={styles.trophyMembers} numberOfLines={2}>
                    {formatTeamMemberSummary(standings[1].memberNames)}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {standings[2] ? (
              <View style={[styles.trophyCard, styles.trophyCardBronze]}>
                <Text style={styles.trophyEmoji}>🥉</Text>
                <Text style={styles.trophyTitle} numberOfLines={2}>
                  {standings[2].displayName}
                </Text>
                <Text style={styles.trophySub}>3rd place</Text>
                {isTeamLeague && standings[2].memberNames.length > 0 ? (
                  <Text style={styles.trophyMembers} numberOfLines={2}>
                    {formatTeamMemberSummary(standings[2].memberNames)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {!completed && isTeamLeague && teamCount > 0 ? (
          <Text style={styles.standingsMeta}>
            {teamCount} teams · {playerCount} players
          </Text>
        ) : null}

        {league.format !== 'match_play' || isLegacyMp ? (
        <View style={styles.tableCard}>
          {isLegacyMp ? (
            <>
              <View style={styles.tableHead}>
                <Text style={[styles.th, styles.colRank]}>#</Text>
                <Text style={[styles.th, styles.colNameMp]}>Player</Text>
                <Text style={[styles.th, styles.colMp]}>MP</Text>
                <Text style={[styles.th, styles.colMp]}>W</Text>
                <Text style={[styles.th, styles.colMp]}>L</Text>
                <Text style={[styles.th, styles.colMp]}>H</Text>
                <Text style={[styles.th, styles.colPts]}>Pts</Text>
              </View>
              {standings.map((s) => (
                <View key={s.entryId} style={styles.tr}>
                  <Text style={[styles.td, styles.colRank]}>{s.rank}</Text>
                  <Text style={[styles.td, styles.colNameMp]} numberOfLines={1}>
                    {s.displayName}
                  </Text>
                  <Text style={[styles.td, styles.colMp]}>{s.roundsPlayed}</Text>
                  <Text style={[styles.td, styles.colMp]}>{s.mpWins ?? 0}</Text>
                  <Text style={[styles.td, styles.colMp]}>{s.mpLosses ?? 0}</Text>
                  <Text style={[styles.td, styles.colMp]}>{s.mpHalved ?? 0}</Text>
                  <Text style={[styles.td, styles.colPts]}>{s.points}</Text>
                </View>
              ))}
            </>
          ) : league.format !== 'match_play' ? (
            <>
              <View style={styles.tableHead}>
                <Text style={[styles.th, styles.colRank]}>#</Text>
                <Text style={[styles.th, styles.colName]}>
                  {isTeamLeague ? 'Team' : 'Player'}
                </Text>
                <Text style={[styles.th, styles.colR]}>Rds</Text>
                {league.format === 'scramble' || league.format === 'best_ball' ? (
                  <>
                    <Text style={[styles.th, styles.colGross]}>Gross</Text>
                    <Text style={[styles.th, styles.colScore]}>Low net</Text>
                  </>
                ) : (
                  <Text style={[styles.th, styles.colScore]}>Low net</Text>
                )}
              </View>
              {standings.map((s) => (
                <View
                  key={s.entryId}
                  style={[styles.tr, s.isTeam && styles.trTeam]}
                >
                  <Text style={[styles.td, styles.colRank]}>{s.rank}</Text>
                  <View style={[styles.colName, styles.nameCol]}>
                    <Text style={styles.tdName} numberOfLines={2}>
                      {s.displayName}
                    </Text>
                {s.isTeam && s.memberNames.length > 0 ? (
                  <Text style={styles.tdSub} numberOfLines={2}>
                    {formatTeamMemberSummary(s.memberNames)}
                  </Text>
                ) : null}
                {s.isTeam && s.designatedScorerName ? (
                  <Text style={styles.tdSub} numberOfLines={1}>
                    Scorer: {s.designatedScorerName}
                  </Text>
                ) : null}
                {s.isTeam && s.hasPartialPending ? (
                  <Text style={styles.tdPartial} numberOfLines={2}>
                    Partial — waiting on teammates
                  </Text>
                ) : null}
                  </View>
                  <Text style={[styles.td, styles.colR]}>{s.roundsPlayed}</Text>
                  {league.format === 'scramble' || league.format === 'best_ball' ? (
                    <>
                      <Text style={[styles.td, styles.colGross]}>
                        {s.bestGross != null ? s.bestGross.toFixed(0) : '—'}
                      </Text>
                      <Text style={[styles.td, styles.colScore]}>
                        {s.lowNet != null ? s.lowNet.toFixed(1) : '—'}
                      </Text>
                    </>
                  ) : (
                    <Text style={[styles.td, styles.colScore]}>
                      {s.lowNet != null ? s.lowNet.toFixed(1) : '—'}
                    </Text>
                  )}
                </View>
              ))}
            </>
          ) : null}
        </View>
        ) : null}

        {(myStanding || myTeamStanding || user?.id) && !isBracketMp ? (
          <View style={styles.myStats}>
            <Text style={styles.myStatsTitle}>My stats</Text>
            {league.format === 'scramble' && myTeamStanding ? (
              <>
                <Text style={styles.myStatsLine}>
                  Team: {myTeamStanding.displayName} · Position: {myTeamStanding.rank} · Rounds:{' '}
                  {myTeamStanding.roundsPlayed}
                </Text>
                {myTeamStanding.lowNet != null ? (
                  <Text style={styles.myStatsLine}>
                    Team low net: {myTeamStanding.lowNet.toFixed(1)}
                  </Text>
                ) : null}
                {!isScrambleScorer ? (
                  <Text style={styles.myStatsLine}>
                    Your team&apos;s designated scorer logs rounds for the crew.
                  </Text>
                ) : null}
              </>
            ) : league.format === 'best_ball' && myTeamStanding ? (
              <>
                <Text style={styles.myStatsLine}>
                  Team: {myTeamStanding.displayName} · Position: {myTeamStanding.rank} · Rounds:{' '}
                  {myTeamStanding.roundsPlayed}
                </Text>
                {myTeamStanding.lowNet != null ? (
                  <Text style={styles.myStatsLine}>
                    Team low net: {myTeamStanding.lowNet.toFixed(1)}
                  </Text>
                ) : null}
                {myTeamStanding.hasPartialPending ? (
                  <Text style={styles.myStatsLine}>
                    Your team has a partial scorecard — standings update when all teammates submit.
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.myStatsLine}>
                  Position: {myStanding?.rank ?? myTeamStanding?.rank ?? '—'} ·{' '}
                  {league.format === 'match_play'
                    ? `Matches: ${myStanding?.roundsPlayed ?? 0} · Points: ${myStanding?.points ?? 0}`
                    : `Rounds: ${myStanding?.roundsPlayed ?? myTeamStanding?.roundsPlayed ?? 0}`}
                </Text>
                {league.format === 'match_play' && myStanding ? (
                  <Text style={styles.myStatsLine}>
                    W–L–H: {myStanding.mpWins ?? 0}–{myStanding.mpLosses ?? 0}–{myStanding.mpHalved ?? 0}
                  </Text>
                ) : null}
                {league.format !== 'match_play' &&
                (myStanding?.lowNet != null || myTeamStanding?.lowNet != null) ? (
                  <Text style={styles.myStatsLine}>
                    Low net: {(myStanding?.lowNet ?? myTeamStanding?.lowNet)?.toFixed(1)}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        {canManage ? (
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
  podiumHint: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginBottom: 4,
  },
  standingsMeta: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 10,
    lineHeight: 17,
  },
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
  trophyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 8,
    textAlign: 'center',
  },
  trophySub: { fontSize: 13, color: colors.muted, marginTop: 4 },
  trophyMembers: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 17,
  },
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
  trTeam: { alignItems: 'flex-start', paddingVertical: 12 },
  td: { fontSize: 13, color: colors.ink },
  tdName: { fontSize: 14, fontWeight: '600', color: colors.ink },
  tdSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  tdPartial: { fontSize: 11, color: '#9a5a00', marginTop: 2, fontWeight: '600' },
  colRank: { width: 28 },
  colName: { flex: 1 },
  colNameMp: { flex: 1, paddingRight: 4 },
  colR: { width: 36, textAlign: 'center' },
  colMp: { width: 28, textAlign: 'center', fontSize: 12 },
  colPts: { width: 32, textAlign: 'right', fontSize: 12 },
  colScore: { width: 56, textAlign: 'right' },
  colGross: { width: 48, textAlign: 'right' },
  nameCol: { paddingRight: 8 },
  pairingsCard: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  pairingsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.sage,
    textTransform: 'uppercase',
  },
  pairingRow: { paddingVertical: 4 },
  pairingLine: { fontSize: 15, fontWeight: '600', color: colors.ink },
  pairingsEmpty: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  matchCard: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  matchCardTitle: { fontSize: 12, fontWeight: '700', color: colors.sage, textTransform: 'uppercase' },
  matchCardLine: { fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 6 },
  matchCardLink: { fontSize: 13, fontWeight: '700', color: colors.sage, marginTop: 8 },
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
