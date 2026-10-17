import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { TournamentHoleScorecard } from '../../../src/components/tournament/TournamentHoleScorecard';
import { ScoreReconciliationBanner } from '../../../src/components/tournament/ScoreReconciliationBanner';
import { useTranslation } from '../../../src/i18n';
import { showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { getCourseById } from '../../../src/lib/courses';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import { fetchLeagueBundle, type LeagueFormat } from '../../../src/lib/leagues';
import { resolveSocialGroupsAccessToken } from '../../../src/lib/socialGroups';
import { restSelect } from '../../../src/lib/tournamentApi';
import { invokeCalculateMatchPlayResult, type MatchPlayCompareHandicap } from '../../../src/lib/matchPlayTournament';
import {
  fetchLeagueMatchPairings,
  opponentEntryIdForPairing,
} from '../../../src/lib/matchPlayTournamentPairings';
import { invokeCalculateTeamHoleScores } from '../../../src/lib/tournamentTeamScores';
import {
  expectedTournamentHoleCount,
  type HolesPerRound,
} from '../../../src/lib/tournamentTypes';
import {
  emptyTournamentHoleDraft,
  fetchTournamentHoleScores,
  isScorecardComplete,
  reconcileGrossWithHoles,
  rowsToHoleDraft,
  upsertTournamentHoleScores,
  type TournamentHoleInput,
} from '../../../src/lib/tournamentHoleScores';
import type { DbLeagueMatchPairingRow } from '../../../src/lib/matchPlayTournamentPairings';
import { useResponsive } from '../../../src/lib/responsive';

type QueueItem = {
  leagueRoundId: string;
  leagueId: string;
  format: LeagueFormat;
  leagueName: string;
  grossScore: string;
  courseId: string;
};

function parseQueue(raw: string | string[] | undefined): QueueItem[] {
  if (!raw || Array.isArray(raw)) return [];
  try {
    const parsed = JSON.parse(raw) as QueueItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function TournamentHolesScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    leagueRoundId: string | string[];
    leagueId?: string | string[];
    format?: string | string[];
    grossScore?: string | string[];
    courseId?: string | string[];
    leagueName?: string | string[];
    queue?: string | string[];
    shareRoundId?: string | string[];
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user } = useAuth();

  const leagueRoundId =
    typeof params.leagueRoundId === 'string' ? params.leagueRoundId : params.leagueRoundId?.[0] ?? '';
  const leagueId = typeof params.leagueId === 'string' ? params.leagueId : params.leagueId?.[0] ?? '';
  const formatParam =
    (typeof params.format === 'string' ? params.format : params.format?.[0]) as LeagueFormat | undefined;
  const grossScore = parseInt(
    typeof params.grossScore === 'string' ? params.grossScore : params.grossScore?.[0] ?? '0',
    10
  );
  const courseId =
    typeof params.courseId === 'string' ? params.courseId : params.courseId?.[0] ?? 'pebble';
  const leagueName =
    typeof params.leagueName === 'string'
      ? params.leagueName
      : params.leagueName?.[0] ?? t('tabs.league.title');
  const queue = parseQueue(params.queue);
  const shareRoundId =
    typeof params.shareRoundId === 'string' ? params.shareRoundId : params.shareRoundId?.[0];

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<LeagueFormat>(formatParam ?? 'stroke');
  const [holesPerRound, setHolesPerRound] = useState<HolesPerRound>('18');
  const [matchPlayNine, setMatchPlayNine] = useState<'front' | 'back' | null>(null);
  const [roundNine, setRoundNine] = useState<'front' | 'back' | null>(null);
  const [holes, setHoles] = useState<TournamentHoleInput[]>(() => emptyTournamentHoleDraft());
  const [opponentHoles, setOpponentHoles] = useState<TournamentHoleInput[] | null>(null);
  const [matchHandicap, setMatchHandicap] = useState<MatchPlayCompareHandicap | null>(null);
  const [scrambleBlocked, setScrambleBlocked] = useState<string | null>(null);

  const course = useMemo(() => getCourseById(courseId), [courseId]);
  const holeCount = useMemo(
    () => expectedTournamentHoleCount({ format, holes_per_round: holesPerRound }),
    [format, holesPerRound]
  );
  const pars = useMemo(() => {
    const full = course?.pars ?? Array.from({ length: 18 }, () => 4);
    if (holeCount === 9) {
      const nine = matchPlayNine ?? roundNine;
      return nine === 'back' ? full.slice(9, 18) : full.slice(0, 9);
    }
    return full;
  }, [course, holeCount, matchPlayNine, roundNine]);

  const reconciliation = useMemo(
    () => reconcileGrossWithHoles(holes, grossScore),
    [holes, grossScore]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const token = googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
    let bundle = null as Awaited<ReturnType<typeof fetchLeagueBundle>>['data'];

    const roundRes = await restSelect<{
      rounds: { holes_played: string | null } | { holes_played: string | null }[] | null;
    }>(
      `league_rounds?id=eq.${encodeURIComponent(leagueRoundId)}&select=rounds(holes_played)`,
      token
    );
    const joined = roundRes.data?.[0]?.rounds;
    const played = Array.isArray(joined) ? joined[0]?.holes_played : joined?.holes_played;
    setRoundNine(played === 'front' || played === 'back' ? played : null);

    if (leagueId) {
      const bundleRes = await fetchLeagueBundle(leagueId, token);
      bundle = bundleRes.data ?? null;
      if (bundle) {
        setFormat(bundle.league.format);
        setHolesPerRound(bundle.league.holes_per_round === '9' ? '9' : '18');
        setMatchPlayNine(bundle.league.match_play_nine ?? null);
        if (bundle.league.format === 'scramble' && user?.id) {
          const entry = bundle.entries.find((e) => e.user_id === user.id);
          const team = bundle.teams.find((t) => t.id === entry?.league_team_id);
          if (team?.designated_scorer_id && team.designated_scorer_id !== user.id) {
            setScrambleBlocked(t('league.holes.scrambleBlocked'));
          } else {
            setScrambleBlocked(null);
          }
        }
      }
    }

    const cardHoles = bundle?.league ? expectedTournamentHoleCount(bundle.league) : 18;

    const existing = await fetchTournamentHoleScores(leagueRoundId, token);
    if (existing.data?.length) {
      setHoles(rowsToHoleDraft(existing.data, cardHoles));
    } else {
      setHoles(emptyTournamentHoleDraft(cardHoles));
    }

    setOpponentHoles(null);
    setMatchHandicap(null);
    let opponentRoundId: string | null = null;
    if (bundle?.league.format === 'match_play' && user?.id && leagueId) {
      const entry = bundle.entries.find((e) => e.user_id === user.id);
      const pr = await fetchLeagueMatchPairings(leagueId, token);
      const myPairing: DbLeagueMatchPairingRow | undefined = pr.data?.find(
        (p) =>
          entry &&
          (p.player_1_entry_id === entry.id || p.player_2_entry_id === entry.id)
      );
      if (myPairing && entry) {
        const oppEntryId = opponentEntryIdForPairing(myPairing, entry.id);
        const oppEntry = bundle.entries.find((e) => e.id === oppEntryId);
        const oppRound = bundle.rounds.find(
          (r) => r.user_id === oppEntry?.user_id && r.hole_entry_status === 'complete'
        );
        if (oppRound) {
          opponentRoundId = oppRound.round_id;
          const oppScores = await fetchTournamentHoleScores(oppRound.id, token);
          if (oppScores.data?.length) {
            setOpponentHoles(rowsToHoleDraft(oppScores.data, cardHoles));
          }
        }
      }
    }

    if (bundle?.league.format === 'match_play' && bundle.league.use_handicap) {
      const mine = bundle.rounds.find((r) => r.id === leagueRoundId);
      const roundIds = [mine?.round_id, opponentRoundId].filter((id): id is string => !!id);
      if (roundIds.length > 0) {
        const snaps = await restSelect<{
          id: string;
          course_rating: number | null;
          slope: number | null;
          course_par: number | null;
          simcap_index_at_time: number | null;
          stroke_index_by_hole: number[] | null;
        }>(
          `rounds?id=in.(${roundIds.join(',')})&select=id,course_rating,slope,course_par,simcap_index_at_time,stroke_index_by_hole`,
          token
        );
        const byId = new Map((snaps.data ?? []).map((row) => [row.id, row]));
        const toSnap = (roundId: string | null | undefined) => {
          const row = roundId ? byId.get(roundId) : undefined;
          return {
            index: row?.simcap_index_at_time ?? null,
            courseRating: row?.course_rating ?? null,
            slope: row?.slope ?? null,
            coursePar: row?.course_par ?? null,
            strokeIndexByHole: row?.stroke_index_by_hole ?? null,
          };
        };
        const nine =
          bundle.league.match_play_nine ??
          (played === 'front' || played === 'back' ? played : null);
        setMatchHandicap({
          enabled: true,
          nine,
          me: toSnap(mine?.round_id),
          opponent: toSnap(opponentRoundId),
        });
      }
    }

    setLoading(false);
  }, [leagueRoundId, leagueId, user?.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onChangeHole = useCallback((holeNumber: number, patch: Partial<TournamentHoleInput>) => {
    setHoles((prev) =>
      prev.map((h) =>
        h.hole_number === holeNumber
          ? {
              ...h,
              ...patch,
              hole_number: holeNumber,
              is_team_score: format === 'scramble',
            }
          : h
      )
    );
  }, [format]);

  const goNext = useCallback(
    (banner?: string) => {
      if (queue.length > 0) {
        const next = queue[0];
        const rest = queue.slice(1);
        router.replace({
          pathname: '/(tabs)/tournament-holes/[leagueRoundId]',
          params: {
            leagueRoundId: next.leagueRoundId,
            leagueId: next.leagueId,
            format: next.format,
            grossScore: next.grossScore,
            courseId: next.courseId,
            leagueName: next.leagueName,
            queue: rest.length > 0 ? JSON.stringify(rest) : undefined,
            shareRoundId,
          },
        } as never);
        return;
      }
      router.replace({
        pathname: '/(tabs)/analyze',
        params: {
          ...(banner ? { leagueBanner: banner } : {}),
          ...(shareRoundId ? { shareRoundId } : {}),
        },
      });
    },
    [queue, router, shareRoundId]
  );

  const onSubmit = async () => {
    if (scrambleBlocked) {
      showAppAlert(t('league.holes.cannotSubmit'), scrambleBlocked);
      return;
    }
    if (!isScorecardComplete(holes, format, holeCount)) {
      showAppAlert(
        t('league.holes.incompleteTitle'),
        t('league.holes.incompleteBody', { count: holeCount })
      );
      return;
    }

    setBusy(true);
    const token = googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;

    const up = await upsertTournamentHoleScores(leagueRoundId, holes, token);
    if (up.error) {
      setBusy(false);
      showAppAlert(t('league.holes.couldNotSave'), up.error);
      return;
    }

    let teamPartialNote: string | null = null;
    if (format === 'scramble' || format === 'best_ball') {
      const teamRes = await invokeCalculateTeamHoleScores(leagueRoundId, token);
      if (teamRes.error) {
        setBusy(false);
        showAppAlert(t('league.holes.teamScores'), teamRes.error);
        return;
      }
      if (format === 'best_ball' && teamRes.data?.is_partial) {
        const submitted = teamRes.data.teammates_submitted ?? 0;
        const expected = teamRes.data.teammates_expected ?? 0;
        const waiting = Math.max(0, expected - submitted);
        teamPartialNote =
          waiting <= 0
            ? t('league.holes.teamScorecardComplete')
            : t('league.holes.partialTeamScore', { count: waiting });
      }
    }

    if (format === 'match_play') {
      const mpRes = await invokeCalculateMatchPlayResult(leagueRoundId, token);
      if (mpRes.error) {
        setBusy(false);
        showAppAlert(t('league.holes.matchPlay'), mpRes.error);
        return;
      }
      if (mpRes.data?.pairing_error) {
        setBusy(false);
        showAppAlert(t('league.holes.matchNotUpdated'), mpRes.data.pairing_error);
        return;
      }
    }

    setBusy(false);
    let banner = t('league.holes.savedBanner', { leagueName });
    if (teamPartialNote) {
      banner = `${banner} ${teamPartialNote}`;
    }
    goNext(banner);
  };

  const formatLabel = t(`league.create.formats.${format}.title`);

  if (loading) {
    return (
      <ContentWidth bg={colors.bg}>
        <ActivityIndicator color={colors.header} style={{ marginTop: 40 }} />
      </ContentWidth>
    );
  }

  if (scrambleBlocked) {
    return (
      <ContentWidth bg={colors.bg}>
        <View style={{ padding: gutter }}>
          <Text style={styles.title}>{t('tabs.tournamentHoles.title')}</Text>
          <Text style={styles.blocked}>{scrambleBlocked}</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnTxt}>{t('match.create.goBack')}</Text>
          </Pressable>
        </View>
      </ContentWidth>
    );
  }

  return (
    <ContentWidth bg={colors.bg}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: 14,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t('tabs.tournamentHoles.title')}</Text>
        <Text style={styles.sub}>
          {t('league.holes.subMeta', {
            leagueName,
            format: formatLabel,
            grossScore,
          })}
        </Text>

        <ScoreReconciliationBanner reconciliation={reconciliation} />

        <TournamentHoleScorecard
          format={format}
          pars={pars}
          holes={holes}
          onChangeHole={onChangeHole}
          holeCount={holeCount}
          nine={matchPlayNine ?? roundNine}
          handicap={format === 'match_play' ? matchHandicap : null}
          opponentHoles={format === 'match_play' ? opponentHoles : undefined}
          teamScoreLabel={
            format === 'scramble'
              ? t('league.holes.teamScoreScramble')
              : format === 'best_ball'
                ? t('league.holes.teamScoreBestBall')
                : undefined
          }
        />

        <Pressable
          style={[styles.submitBtn, busy && styles.submitDisabled]}
          disabled={busy}
          onPress={() => void onSubmit()}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitTxt}>{t('league.holes.submitRound')}</Text>
          )}
        </Pressable>

        <Pressable style={styles.laterBtn} onPress={() => goNext()} disabled={busy}>
          <Text style={styles.laterTxt}>{t('league.holes.finishLater')}</Text>
        </Pressable>
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 13, color: colors.muted, marginTop: 6, marginBottom: 16, lineHeight: 18 },
  blocked: { fontSize: 14, color: colors.muted, marginTop: 12, lineHeight: 20 },
  submitBtn: {
    marginTop: 20,
    backgroundColor: colors.header,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.65 },
  submitTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  laterBtn: { marginTop: 12, paddingVertical: 10, alignItems: 'center' },
  laterTxt: { fontSize: 14, fontWeight: '600', color: colors.muted },
  secondaryBtn: {
    marginTop: 20,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.sage,
    alignItems: 'center',
  },
  secondaryBtnTxt: { color: colors.accentDark, fontWeight: '700' },
});
