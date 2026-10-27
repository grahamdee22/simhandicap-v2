import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import i18n, { useTranslation } from '../i18n';
import { todayLocalYmd } from '../lib/dates';
import { colors } from '../lib/constants';
import {
  fetchLeaguesForGroup,
  syncLeagueStatuses,
  type DbLeagueRow,
} from '../lib/leagues';
import {
  computeLeagueStandings,
  formatLeagueDateRange,
  formatLeagueFormatLabel,
  isLeagueActive,
  leagueDaysRemaining,
} from '../lib/leagueStandings';
import { fetchLeagueBundle } from '../lib/leagues';
import {
  fetchLeagueMatchPairings,
  formatPairingResultLine,
} from '../lib/matchPlayTournamentPairings';
import { fetchTeamHoleScoresForLeague } from '../lib/tournamentTeamScores';
import { getCourseById } from '../lib/courses';
import { formatSeasonDateRange } from '../lib/seasonPoints';
import { fetchSeasonsForGroup, type DbLeagueSeasonRow } from '../lib/seasons';
import {
  socialPageSectionTitleStyles,
  socialSectionHeaderStyles,
} from '../lib/socialPageSectionTitle';
import { isSocialGroupCreator, isSocialGroupManager } from '../lib/socialGroupCreator';
import {
  isSocialGroupCreatorViaRpc,
  isSocialGroupManagerViaRpc,
  patchGroupCreatorInStore,
  resolveSocialGroupsAccessToken,
} from '../lib/socialGroups';
import {
  getTournamentSectionCache,
  setTournamentSectionCache,
} from '../lib/tournamentSectionCache';
import { supabase } from '../lib/supabase';
import { buildBracketViewModel } from '../lib/matchPlayBracket';
import { useAppStore, type FriendGroup } from '../store/useAppStore';
import {
  challengeResultLabel,
  fetchGroupChallengesForGroup,
  opponentGroupId,
  type DbGroupChallenge,
} from '../lib/groupChallenges';
import { resolveGroupNames, truncatedGroupId } from '../lib/groupChallengeGroupNames';
import { formatOrdinalPlace } from '../lib/formatOrdinal';

/** Stripped from production builds via `__DEV__` (same pattern as MatchPlayHub dev tools). */
const ALLOW_DEV_CREATOR_VIEW = __DEV__;

type PastSummary = {
  dateRange: string;
  resultLine: string;
};

async function summarizePastLeague(
  league: DbLeagueRow,
  accessToken: string | undefined,
  displayNames: Record<string, string>
): Promise<PastSummary> {
  const dateRange = formatLeagueDateRange(league.start_date, league.end_date);
  const bundleRes = await fetchLeagueBundle(league.id, accessToken);
  const bundle = bundleRes.data;
  if (!bundle) {
    const empty =
      league.format === 'match_play' && league.match_play_pairing_method === 'bracket'
        ? i18n.t('tournaments.section.noChampion')
        : i18n.t('tournaments.section.noResult');
    return { dateRange, resultLine: empty };
  }

  if (league.format === 'match_play' && league.match_play_pairing_method === 'bracket') {
    const pr = await fetchLeagueMatchPairings(league.id, accessToken);
    const model = buildBracketViewModel({
      pairings: pr.data ?? [],
      entries: bundle.entries,
      displayNames,
      currentBracketRound: league.current_bracket_round,
      myEntryId: null,
      playerCount: bundle.entries.length,
    });
    return {
      dateRange,
      resultLine: model.championName
        ? i18n.t('tournaments.section.champion', { name: model.championName })
        : i18n.t('tournaments.section.noChampion'),
    };
  }

  let teamHoleScores = undefined;
  if (league.format === 'best_ball' || league.format === 'scramble') {
    const th = await fetchTeamHoleScoresForLeague(league.id, accessToken);
    teamHoleScores = th.data ?? undefined;
  }
  const standings = computeLeagueStandings({
    league: bundle.league,
    entries: bundle.entries,
    rounds: bundle.rounds,
    teams: bundle.teams,
    displayNames,
    teamHoleScores,
  });
  const winner = standings[0]?.displayName;
  return {
    dateRange,
    resultLine: winner
      ? i18n.t('tournaments.section.champion', { name: winner })
      : i18n.t('tournaments.section.noResult'),
  };
}

type ManagerCheck = 'pending' | 'manager' | 'member';

type Props = {
  group: FriendGroup;
  authUserId: string | null;
  gutter: number;
  displayNames: Record<string, string>;
  onInfoPress: () => void;
};

export function GroupTournamentsSection({
  group,
  authUserId,
  gutter,
  displayNames,
  onInfoPress,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const initialCache = getTournamentSectionCache(group.id);
  const storeCreatorId = group.createdByUserId?.trim() || null;
  const [managerCheck, setManagerCheck] = useState<ManagerCheck>(() =>
    isSocialGroupManager(group, authUserId) ? 'manager' : storeCreatorId ? 'member' : 'pending'
  );

  useEffect(() => {
    let cancelled = false;

    if (isSocialGroupManager(group, authUserId)) {
      setManagerCheck('manager');
      return;
    }

    if (!authUserId) {
      setManagerCheck('pending');
      return;
    }

    setManagerCheck('pending');
    void (async () => {
      const accessToken = (await resolveSocialGroupsAccessToken()) ?? undefined;
      const [{ isManager }, { isCreator }] = await Promise.all([
        isSocialGroupManagerViaRpc(group.id, accessToken),
        storeCreatorId
          ? Promise.resolve({ isCreator: false, error: null })
          : isSocialGroupCreatorViaRpc(group.id, accessToken),
      ]);
      if (cancelled) return;
      if (isCreator) {
        patchGroupCreatorInStore(group.id, authUserId);
      }
      setManagerCheck(isManager ? 'manager' : 'member');
    })();

    return () => {
      cancelled = true;
    };
  }, [group.id, group.createdByUserId, group.members, authUserId, storeCreatorId]);

  const isGroupManager = managerCheck === 'manager';
  const [devForceCreatorView, setDevForceCreatorView] = useState(false);
  const showCreatorUi = isGroupManager || (ALLOW_DEV_CREATOR_VIEW && devForceCreatorView);
  const [hasCache, setHasCache] = useState(() => !!initialCache);
  const [loading, setLoading] = useState(() => !initialCache);
  const [leagues, setLeagues] = useState<DbLeagueRow[]>(() => initialCache?.leagues ?? []);
  const [pastOpen, setPastOpen] = useState(false);
  const [pastSummaries, setPastSummaries] = useState<Record<string, PastSummary | null>>({});
  const [previewTop3, setPreviewTop3] = useState<{ name: string; rank: number }[]>(
    () => initialCache?.previewTop3 ?? []
  );
  const [matchPreviewLine, setMatchPreviewLine] = useState<string | null>(null);
  const [scrambleTeamLine, setScrambleTeamLine] = useState<string | null>(null);
  const [bestBallTeamLine, setBestBallTeamLine] = useState<string | null>(null);
  const [seasons, setSeasons] = useState<DbLeagueSeasonRow[]>([]);
  const storeGroups = useAppStore((s) => s.groups);
  const [challenges, setChallenges] = useState<DbGroupChallenge[]>([]);
  const [challengeNames, setChallengeNames] = useState<Record<string, string>>({});
  const [challengeHistoryOpen, setChallengeHistoryOpen] = useState(false);
  const [pastSeasonsOpen, setPastSeasonsOpen] = useState(false);
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const cached = getTournamentSectionCache(group.id);
    if (!cached) setLoading(true);
    const accessToken = (await resolveSocialGroupsAccessToken()) ?? undefined;
    const [res, seasonRes, challengeRes] = await Promise.all([
      fetchLeaguesForGroup(group.id, accessToken),
      fetchSeasonsForGroup(group.id, accessToken),
      fetchGroupChallengesForGroup(group.id, accessToken).catch(() => ({
        data: null,
        error: 'failed',
      })),
    ]);
    setSeasons(seasonRes.data ?? []);
    setChallenges(challengeRes.data ?? []);
    const synced = await syncLeagueStatuses(res.data ?? [], accessToken);
    const active = synced.find((l) => l.status === 'active' && isLeagueActive(l));
    let top3: { name: string; rank: number }[] = [];
    let matchLine: string | null = null;
    let scrambleLine: string | null = null;
    let bestBallLine: string | null = null;
    if (active) {
      const bundle = await fetchLeagueBundle(active.id, accessToken);
      if (bundle.data) {
        let teamHoleScores = undefined;
        if (active.format === 'best_ball' || active.format === 'scramble') {
          const th = await fetchTeamHoleScoresForLeague(active.id, accessToken);
          teamHoleScores = th.data ?? undefined;
        }
        const standings = computeLeagueStandings({
          league: bundle.data.league,
          entries: bundle.data.entries,
          rounds: bundle.data.rounds,
          teams: bundle.data.teams,
          displayNames,
          teamHoleScores,
        });
        top3 = standings.slice(0, 3).map((s) => ({
          name: s.displayName,
          rank: s.rank,
        }));
        if (active.format === 'scramble' && authUserId) {
          const entry = bundle.data.entries.find((e) => e.user_id === authUserId);
          const team = entry?.league_team_id
            ? bundle.data.teams.find((t) => t.id === entry.league_team_id)
            : null;
          const mine = team ? standings.find((s) => s.teamId === team.id) : null;
          if (team && mine) {
            scrambleLine = i18n.t('tournaments.section.teamStandingLine', {
              team: team.name,
              place: formatOrdinalPlace(mine.rank, i18n.language),
              value: mine.lowNet?.toFixed(1) ?? '—',
            });
          }
        }
        if (active.format === 'best_ball' && authUserId) {
          const entry = bundle.data.entries.find((e) => e.user_id === authUserId);
          const team = entry?.league_team_id
            ? bundle.data.teams.find((t) => t.id === entry.league_team_id)
            : null;
          const mine = team ? standings.find((s) => s.teamId === team.id) : null;
          if (team && mine) {
            const key = mine.hasPartialPending
              ? 'tournaments.section.teamStandingLinePartial'
              : 'tournaments.section.teamStandingLine';
            bestBallLine = i18n.t(key, {
              team: team.name,
              place: formatOrdinalPlace(mine.rank, i18n.language),
              value: mine.lowNet?.toFixed(1) ?? '—',
            });
          }
        }
        if (active.format === 'match_play' && authUserId) {
          const myEntry = bundle.data.entries.find((e) => e.user_id === authUserId);
          if (myEntry) {
            const pr = await fetchLeagueMatchPairings(active.id, accessToken);
            const pairing = (pr.data ?? []).find(
              (p) => p.player_1_entry_id === myEntry.id || p.player_2_entry_id === myEntry.id
            );
            if (pairing) {
              const oppId =
                pairing.player_1_entry_id === myEntry.id
                  ? pairing.player_2_entry_id
                  : pairing.player_1_entry_id;
              const opp = bundle.data.entries.find((e) => e.id === oppId);
              const oppName =
                opp
                  ? displayNames[opp.user_id] ?? i18n.t('tournaments.section.opponent')
                  : i18n.t('tournaments.section.opponent');
              matchLine = formatPairingResultLine(pairing, myEntry.id, oppName);
            }
          }
        }
      }
    }
    setLeagues(synced);
    setPreviewTop3(top3);
    setMatchPreviewLine(matchLine);
    setScrambleTeamLine(scrambleLine);
    setBestBallTeamLine(bestBallLine);
    setTournamentSectionCache(group.id, { leagues: synced, previewTop3: top3 });
    setHasCache(true);
    setLoading(false);
  }, [group.id, displayNames, authUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const activeLeague = useMemo(
    () => leagues.find((l) => l.status === 'active' && isLeagueActive(l)) ?? null,
    [leagues]
  );
  const scheduledLeagues = useMemo(() => {
    const today = todayLocalYmd();
    return leagues
      .filter((l) => l.status === 'active' && l.start_date > today)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [leagues]);
  const pastLeagues = useMemo(
    () => leagues.filter((l) => l.status === 'completed' || l.status === 'archived'),
    [leagues]
  );
  const activeSeason = useMemo(
    () => seasons.find((s) => s.status === 'active') ?? null,
    [seasons]
  );
  const pastSeasons = useMemo(
    () => seasons.filter((s) => s.status !== 'active'),
    [seasons]
  );
  const liveChallenges = useMemo(() => {
    const rank: Record<string, number> = { active: 0, disputed: 1, accepted: 2, pending: 3 };
    return challenges
      .filter((c) => c.status in rank)
      .sort((a, b) => rank[a.status] - rank[b.status] || a.start_date.localeCompare(b.start_date));
  }, [challenges]);
  const completedChallenges = useMemo(
    () => challenges.filter((c) => c.status === 'completed'),
    [challenges]
  );
  const challengeRecord = useMemo(() => {
    let w = 0;
    let l = 0;
    let tie = 0;
    for (const c of completedChallenges) {
      const r = challengeResultLabel({
        status: c.status,
        myGroupId: group.id,
        winnerGroupId: c.winner_group_id,
      });
      if (r === 'win') w += 1;
      else if (r === 'loss') l += 1;
      else if (r === 'tie') tie += 1;
    }
    return { w, l, t: tie };
  }, [completedChallenges, group.id]);

  useEffect(() => {
    if (challenges.length === 0) return;
    let cancelled = false;
    void (async () => {
      const accessToken = (await resolveSocialGroupsAccessToken()) ?? undefined;
      const names = await resolveGroupNames(
        challenges.map((c) => opponentGroupId(c, group.id)),
        storeGroups,
        accessToken
      );
      if (!cancelled) setChallengeNames((prev) => ({ ...prev, ...names }));
    })();
    return () => {
      cancelled = true;
    };
  }, [challenges, group.id, storeGroups]);

  const opponentLabel = useCallback(
    (c: DbGroupChallenge) => {
      const oppId = opponentGroupId(c, group.id);
      return (
        storeGroups.find((g) => g.id === oppId)?.name ??
        challengeNames[oppId] ??
        truncatedGroupId(oppId)
      );
    },
    [group.id, storeGroups, challengeNames]
  );

  useEffect(() => {
    const client = supabase;
    if (!client || !group.id) return;

    let cancelled = false;
    let channel: ReturnType<typeof client.channel> | null = null;

    const scheduleLoad = () => {
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current);
      }
      realtimeDebounceRef.current = setTimeout(() => {
        realtimeDebounceRef.current = null;
        void load();
      }, 280);
    };

    const activeId = activeLeague?.id;
    const activeFormat = activeLeague?.format;

    void (async () => {
      const token = (await resolveSocialGroupsAccessToken()) ?? null;
      await client.realtime.setAuth(token);
      if (cancelled) return;

      let next = client
        .channel(`group-tournaments:${group.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'leagues',
            filter: `group_id=eq.${group.id}`,
          },
          scheduleLoad
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'group_challenges',
            filter: `challenging_group_id=eq.${group.id}`,
          },
          scheduleLoad
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'group_challenges',
            filter: `challenged_group_id=eq.${group.id}`,
          },
          scheduleLoad
        );

      if (activeId) {
        const leagueFilter = `league_id=eq.${activeId}`;
        next = next.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'league_rounds', filter: leagueFilter },
          scheduleLoad
        );
        if (activeFormat === 'scramble' || activeFormat === 'best_ball') {
          next = next.on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'tournament_team_hole_scores',
              filter: leagueFilter,
            },
            scheduleLoad
          );
        }
        if (activeFormat === 'match_play') {
          next = next.on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'league_match_pairings',
              filter: leagueFilter,
            },
            scheduleLoad
          );
        }
      }

      channel = next.subscribe();
    })();

    return () => {
      cancelled = true;
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current);
        realtimeDebounceRef.current = null;
      }
      if (channel) {
        void client.removeChannel(channel);
      }
    };
  }, [group.id, activeLeague?.id, activeLeague?.format, load]);

  useEffect(() => {
    if (!pastOpen) return;
    const missing = pastLeagues.filter((l) => !(l.id in pastSummaries));
    if (missing.length === 0) return;
    let alive = true;
    void (async () => {
      const accessToken = (await resolveSocialGroupsAccessToken()) ?? undefined;
      const rows = await Promise.all(
        missing.map(async (league) => {
          try {
            const summary = await summarizePastLeague(league, accessToken, displayNames);
            return [league.id, summary] as const;
          } catch {
            return [league.id, null] as const;
          }
        })
      );
      if (!alive) return;
      setPastSummaries((prev) => {
        const next = { ...prev };
        for (const [id, summary] of rows) next[id] = summary;
        return next;
      });
    })();
    return () => {
      alive = false;
    };
  }, [pastOpen, pastLeagues, pastSummaries, displayNames]);

  const showLoadingSpinner = loading && !hasCache && !activeLeague;
  const showCreateBtn = managerCheck !== 'pending' && showCreatorUi;
  const showStartSeason = !activeSeason && managerCheck !== 'pending' && showCreatorUi;

  return (
    <View style={{ marginTop: 16 }}>
      <View style={[socialSectionHeaderStyles.headerWrap, { paddingHorizontal: gutter }]}>
        <View style={socialSectionHeaderStyles.row}>
          <Text style={socialPageSectionTitleStyles.text} accessibilityRole="header">
            {t('tournaments.section.title')}
          </Text>
          <Pressable
            style={socialSectionHeaderStyles.infoBtn}
            onPress={onInfoPress}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('tournaments.section.aboutA11y')}
          >
            <Text style={socialSectionHeaderStyles.infoBtnTxt}>ⓘ</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.sectionBody, { marginHorizontal: gutter, marginTop: 8 }]}>
        {activeSeason ? (
          <Pressable
            onPress={() => router.push(`/(tabs)/season/${activeSeason.id}` as never)}
            style={({ pressed }) => [styles.seasonCard, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('tournaments.section.seasonA11y', { name: activeSeason.name })}
          >
            <Text style={styles.pastMeta}>{t('tournaments.section.seasonActive')}</Text>
            <Text style={styles.tournamentName}>{activeSeason.name}</Text>
            <Text style={styles.matchPreview}>
              {formatSeasonDateRange(activeSeason.start_date, activeSeason.end_date)}
              {' · '}
              {activeSeason.events_that_count == null
                ? t('tournaments.section.everyEventCounts')
                : t('tournaments.section.bestEvents', { count: activeSeason.events_that_count })}
            </Text>
            <Text style={styles.seeAll}>{t('tournaments.section.seasonStandings')}</Text>
          </Pressable>
        ) : null}
        {showLoadingSpinner ? (
          <ActivityIndicator color={colors.header} style={{ marginVertical: 16 }} />
        ) : activeLeague ? (
          <View style={styles.activeCardWrap}>
            <Pressable
              onPress={() => router.push(`/(tabs)/league/${activeLeague.id}` as never)}
              style={({ pressed }) => [styles.activeCard, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <View style={styles.badgeRow}>
                <View style={styles.formatBadge}>
                  <Text style={styles.formatBadgeTxt}>
                    {formatLeagueFormatLabel(activeLeague.format)}
                  </Text>
                </View>
                <View style={styles.daysBadge}>
                  <Text style={styles.daysBadgeTxt}>
                    {t('tournaments.section.daysLeft', { count: leagueDaysRemaining(activeLeague) })}
                  </Text>
                </View>
              </View>
              <Text style={styles.tournamentName}>{activeLeague.name}</Text>
              {activeLeague.course_id ? (
                <Text style={styles.matchPreview}>
                  📍 {getCourseById(activeLeague.course_id)?.name ?? activeLeague.course_id}
                </Text>
              ) : null}
              {activeLeague.notes?.trim() ? (
                <Text style={styles.tournamentNotes}>{activeLeague.notes.trim()}</Text>
              ) : null}
              {activeLeague.format === 'match_play' && matchPreviewLine ? (
                <Text style={styles.matchPreview}>{matchPreviewLine}</Text>
              ) : null}
              {activeLeague.format === 'scramble' && scrambleTeamLine ? (
                <Text style={styles.matchPreview}>{scrambleTeamLine}</Text>
              ) : null}
              {activeLeague.format === 'best_ball' && bestBallTeamLine ? (
                <Text style={styles.matchPreview}>{bestBallTeamLine}</Text>
              ) : null}
              {previewTop3.length > 0 ? (
                <View style={styles.preview}>
                  {previewTop3.map((p) => (
                    <Text
                      key={`${p.rank}-${p.name}`}
                      style={styles.previewLine}
                      numberOfLines={1}
                    >
                      {p.rank}. {p.name}
                    </Text>
                  ))}
                </View>
              ) : (
                <Text style={styles.previewMuted}>{t('tournaments.section.noScoresYet')}</Text>
              )}
              <Text style={styles.seeAll}>{t('tournaments.section.seeFullStandings')}</Text>
            </Pressable>
          </View>
        ) : managerCheck === 'pending' ? (
          <View
            style={styles.neutralPending}
            accessibilityLabel={t('tournaments.section.loadingOptionsA11y')}
            accessibilityRole="progressbar"
          />
        ) : !activeLeague &&
          scheduledLeagues.length === 0 &&
          liveChallenges.length === 0 &&
          !showCreateBtn ? (
          <Text style={styles.emptyMuted}>{t('tournaments.section.noActive')}</Text>
        ) : null}

        {scheduledLeagues.length > 0 ? (
          <View style={styles.comingUpWrap}>
            <Text style={styles.comingUpTitle}>{t('tournaments.section.comingUp')}</Text>
            {scheduledLeagues.map((league) => (
              <Pressable
                key={league.id}
                onPress={() => router.push(`/(tabs)/league/${league.id}` as never)}
                style={({ pressed }) => [styles.comingUpRow, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t('tournaments.section.scheduledA11y', { name: league.name })}
              >
                <Text style={styles.pastMeta}>
                  {formatLeagueFormatLabel(league.format)} ·{' '}
                  {formatLeagueDateRange(league.start_date, league.end_date)}
                </Text>
                <Text style={styles.tournamentName}>{league.name}</Text>
                {league.course_id ? (
                  <Text style={styles.matchPreview}>
                    📍 {getCourseById(league.course_id)?.name ?? league.course_id}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        {liveChallenges.length > 0 ? (
          <View style={styles.comingUpWrap}>
            <Text style={styles.comingUpTitle}>{t('groupChallenge.section.title')}</Text>
            {liveChallenges.map((c) => {
              const opp = opponentLabel(c);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => router.push(`/(tabs)/group-challenge/${c.id}` as never)}
                  style={({ pressed }) => [
                    c.status === 'active' ? styles.challengeCardActive : styles.comingUpRow,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t('groupChallenge.section.cardA11y', { name: c.name, opponent: opp })}
                >
                  <View style={styles.badgeRow}>
                    <View style={styles.formatBadge}>
                      <Text style={styles.formatBadgeTxt}>
                        {t(`groupChallenge.status.${c.status}`)}
                      </Text>
                    </View>
                    <View style={styles.daysBadge}>
                      <Text style={styles.daysBadgeTxt}>
                        {c.verification_mode === 'verified'
                          ? t('groupChallenge.mode.verified')
                          : t('groupChallenge.mode.casual')}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.tournamentName}>
                    {t('groupChallenge.vsOpponent', { name: opp })}
                  </Text>
                  <Text style={styles.pastMeta}>
                    {c.name} · {formatLeagueDateRange(c.start_date, c.end_date)}
                  </Text>
                  <Text style={styles.matchPreview}>
                    📍 {getCourseById(c.course_id)?.name ?? c.course_id}
                  </Text>
                  <Text style={styles.seeAll}>{t('groupChallenge.section.viewChallenge')}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {showStartSeason ? (
          <Pressable
            style={({ pressed }) => [styles.createBtn, pressed && styles.pressed]}
            onPress={() => router.push(`/(tabs)/season-create/${group.id}` as never)}
            accessibilityRole="button"
            accessibilityLabel={t('tournaments.section.startSeason')}
          >
            <Text style={styles.createBtnTxt}>{t('tournaments.section.startSeason')}</Text>
          </Pressable>
        ) : null}

        {showCreateBtn ? (
          <Pressable
            style={({ pressed }) => [styles.createBtn, pressed && styles.pressed]}
            onPress={() => router.push(`/(tabs)/league-create/${group.id}` as never)}
            accessibilityRole="button"
            accessibilityLabel={
              activeLeague
                ? t('tournaments.section.scheduleNext')
                : t('tournaments.section.createTournamentA11y')
            }
          >
            <Text style={styles.createBtnTxt}>
              {activeLeague
                ? t('tournaments.section.scheduleNext')
                : t('tournaments.section.createTournament')}
            </Text>
          </Pressable>
        ) : null}

        {ALLOW_DEV_CREATOR_VIEW && !isGroupManager ? (
          <Pressable
            onPress={() => setDevForceCreatorView((v) => !v)}
            style={({ pressed }) => [styles.devCreatorBtn, pressed && styles.devCreatorBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Toggle developer creator view for tournaments"
          >
            <Text style={styles.devCreatorBtnTxt}>
              {devForceCreatorView
                ? 'DEV ONLY · Creator view ON (tap to reset)'
                : 'DEV ONLY · Show creator view (test Create Tournament)'}
            </Text>
          </Pressable>
        ) : null}

        {pastSeasons.length > 0 ? (
          <View style={styles.pastCard}>
            <Pressable
              onPress={() => setPastSeasonsOpen((o) => !o)}
              style={styles.pastToggle}
              accessibilityRole="button"
            >
              <Text style={styles.pastToggleTxt}>
                {t('tournaments.section.pastSeasons', { count: pastSeasons.length })}
              </Text>
              <Text style={styles.pastChev}>{pastSeasonsOpen ? '▾' : '▸'}</Text>
            </Pressable>
            {pastSeasonsOpen
              ? pastSeasons.map((s) => (
                  <Pressable
                    key={s.id}
                    onPress={() => router.push(`/(tabs)/season/${s.id}` as never)}
                    style={styles.pastRow}
                  >
                    <Text style={styles.pastName}>{s.name}</Text>
                    <Text style={styles.pastMeta}>
                      {s.status} · {formatSeasonDateRange(s.start_date, s.end_date)}
                    </Text>
                  </Pressable>
                ))
              : null}
          </View>
        ) : null}


        {completedChallenges.length > 0 ? (
          <View style={styles.pastCard}>
            <Pressable
              onPress={() => setChallengeHistoryOpen((o) => !o)}
              style={styles.pastToggle}
              accessibilityRole="button"
            >
              <Text style={styles.pastToggleTxt}>
                {t('groupChallenge.section.history', {
                  w: challengeRecord.w,
                  l: challengeRecord.l,
                  t: challengeRecord.t,
                })}
              </Text>
              <Text style={styles.pastChev}>{challengeHistoryOpen ? '▾' : '▸'}</Text>
            </Pressable>
            {challengeHistoryOpen
              ? completedChallenges.map((c) => {
                  const result = challengeResultLabel({
                    status: c.status,
                    myGroupId: group.id,
                    winnerGroupId: c.winner_group_id,
                  });
                  const resultKey = result === 'win' || result === 'loss' ? result : 'tie';
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => router.push(`/(tabs)/group-challenge/${c.id}` as never)}
                      style={styles.pastRow}
                      accessibilityRole="button"
                    >
                      <View style={styles.challengeHistoryRow}>
                        <View
                          style={[
                            styles.resultPill,
                            resultKey === 'win' && styles.resultPillWin,
                            resultKey === 'loss' && styles.resultPillLoss,
                          ]}
                        >
                          <Text
                            style={[
                              styles.resultPillTxt,
                              resultKey === 'win' && styles.resultPillTxtWin,
                              resultKey === 'loss' && styles.resultPillTxtLoss,
                            ]}
                          >
                            {t(`groupChallenge.section.result.${resultKey}`)}
                          </Text>
                        </View>
                        <Text style={styles.pastName} numberOfLines={1}>
                          {t('groupChallenge.vsOpponent', { name: opponentLabel(c) })}
                        </Text>
                      </View>
                      <Text style={styles.pastMeta}>
                        {c.name} · {formatLeagueDateRange(c.start_date, c.end_date)}
                      </Text>
                    </Pressable>
                  );
                })
              : null}
          </View>
        ) : null}

        {pastLeagues.length > 0 ? (
          <View style={styles.pastCard}>
            <Pressable
              onPress={() => setPastOpen((o) => !o)}
              style={styles.pastToggle}
              accessibilityRole="button"
            >
              <Text style={styles.pastToggleTxt}>
                {t('tournaments.section.pastTournaments', { count: pastLeagues.length })}
              </Text>
              <Text style={styles.pastChev}>{pastOpen ? '▾' : '▸'}</Text>
            </Pressable>
            {pastOpen
              ? pastLeagues.map((l) => {
                  const summary = pastSummaries[l.id];
                  return (
                    <Pressable
                      key={l.id}
                      onPress={() => router.push(`/(tabs)/league/${l.id}` as never)}
                      style={styles.pastRow}
                    >
                      <Text style={styles.pastName}>{l.name}</Text>
                      <Text style={styles.pastMeta}>
                        {formatLeagueFormatLabel(l.format)} · {l.status}
                      </Text>
                      {summary === undefined ? (
                        <Text style={styles.pastMeta}>{t('tournaments.section.loading')}</Text>
                      ) : summary ? (
                        <Text style={styles.pastMeta}>
                          {summary.dateRange} · {summary.resultLine}
                        </Text>
                      ) : (
                        <Text style={styles.pastMeta}>
                          {formatLeagueDateRange(l.start_date, l.end_date)} ·{' '}
                          {l.format === 'match_play' && l.match_play_pairing_method === 'bracket'
                            ? t('tournaments.section.noChampion')
                            : t('tournaments.section.noResult')}
                        </Text>
                      )}
                    </Pressable>
                  );
                })
              : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionBody: { gap: 12 },
  seasonCard: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
  },
  activeCardWrap: {
    backgroundColor: '#f0f7f3',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
  },
  pastCard: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
  },
  comingUpWrap: {
    gap: 8,
  },
  comingUpTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  comingUpRow: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
  },
  createBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.header,
    borderRadius: 12,
    paddingVertical: 12,
  },
  createBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  emptyMuted: {
    textAlign: 'center',
    color: colors.muted,
    fontSize: 14,
    paddingVertical: 16,
  },
  neutralPending: {
    minHeight: 46,
    paddingVertical: 16,
  },
  activeCard: { paddingVertical: 4 },
  pressed: { opacity: 0.92 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  formatBadge: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
  },
  formatBadgeTxt: { fontSize: 11, fontWeight: '700', color: colors.accentDark },
  daysBadge: {
    backgroundColor: colors.bg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  daysBadgeTxt: { fontSize: 11, fontWeight: '600', color: colors.muted },
  tournamentName: { fontSize: 18, fontWeight: '700', color: colors.ink },
  tournamentNotes: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
    marginTop: 6,
  },
  matchPreview: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
    marginTop: 10,
  },
  preview: { marginTop: 10, gap: 4 },
  previewLine: { fontSize: 13, color: colors.ink },
  previewMuted: { fontSize: 13, color: colors.muted, marginTop: 10 },
  seeAll: { fontSize: 13, fontWeight: '700', color: colors.sage, marginTop: 12 },
  pastToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pastToggleTxt: { fontSize: 13, fontWeight: '600', color: colors.muted },
  pastChev: { fontSize: 14, color: colors.muted },
  pastRow: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pastName: { fontSize: 14, fontWeight: '600', color: colors.ink },
  pastMeta: { fontSize: 12, color: colors.subtle, marginTop: 2 },
  challengeCardActive: {
    backgroundColor: '#f0f7f3',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
    padding: 14,
  },
  challengeHistoryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  resultPillWin: { backgroundColor: '#e6f4ec', borderColor: colors.accentMuted },
  resultPillLoss: { backgroundColor: '#fdecec', borderColor: colors.danger },
  resultPillTxt: { fontSize: 11, fontWeight: '700', color: colors.muted },
  resultPillTxtWin: { color: colors.accent },
  resultPillTxtLoss: { color: colors.danger },
  devCreatorBtn: {
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#dd9a3f',
    backgroundColor: '#fff5e7',
    alignSelf: 'flex-start',
  },
  devCreatorBtnPressed: { opacity: 0.85 },
  devCreatorBtnTxt: { fontSize: 11, fontWeight: '700', color: '#9a5a00' },
});
