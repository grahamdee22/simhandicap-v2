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
import { showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { getCourseById } from '../../../src/lib/courses';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import { fetchLeagueBundle, type LeagueFormat } from '../../../src/lib/leagues';
import { formatLeagueFormatLabel } from '../../../src/lib/leagueStandings';
import { resolveSocialGroupsAccessToken } from '../../../src/lib/socialGroups';
import { formatBestBallPartialNote } from '../../../src/lib/bestBallTournament';
import { invokeCalculateMatchPlayResult } from '../../../src/lib/matchPlayTournament';
import { invokeCalculateTeamHoleScores } from '../../../src/lib/tournamentTeamScores';
import {
  emptyTournamentHoleDraft,
  fetchTournamentHoleScores,
  isScorecardComplete,
  reconcileGrossWithHoles,
  rowsToHoleDraft,
  upsertTournamentHoleScores,
  type TournamentHoleInput,
} from '../../../src/lib/tournamentHoleScores';
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
  const params = useLocalSearchParams<{
    leagueRoundId: string | string[];
    leagueId?: string | string[];
    format?: string | string[];
    grossScore?: string | string[];
    courseId?: string | string[];
    leagueName?: string | string[];
    queue?: string | string[];
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
    typeof params.leagueName === 'string' ? params.leagueName : params.leagueName?.[0] ?? 'Tournament';
  const queue = parseQueue(params.queue);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<LeagueFormat>(formatParam ?? 'stroke');
  const [holes, setHoles] = useState<TournamentHoleInput[]>(() => emptyTournamentHoleDraft());
  const [scrambleBlocked, setScrambleBlocked] = useState<string | null>(null);

  const course = useMemo(() => getCourseById(courseId), [courseId]);
  const pars = course?.pars ?? Array.from({ length: 18 }, () => 4);

  const reconciliation = useMemo(
    () => reconcileGrossWithHoles(holes, grossScore),
    [holes, grossScore]
  );

  const load = useCallback(async () => {
    setLoading(true);
    const token = googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;

    if (leagueId) {
      const bundleRes = await fetchLeagueBundle(leagueId, token);
      if (bundleRes.data) {
        setFormat(bundleRes.data.league.format);
        if (bundleRes.data.league.format === 'scramble' && user?.id) {
          const entry = bundleRes.data.entries.find((e) => e.user_id === user.id);
          const team = bundleRes.data.teams.find((t) => t.id === entry?.league_team_id);
          if (team?.designated_scorer_id && team.designated_scorer_id !== user.id) {
            setScrambleBlocked('Only the designated scorer can enter team hole scores for this tournament.');
          } else {
            setScrambleBlocked(null);
          }
        }
      }
    }

    const existing = await fetchTournamentHoleScores(leagueRoundId, token);
    if (existing.data?.length) {
      setHoles(rowsToHoleDraft(existing.data));
    } else {
      setHoles(emptyTournamentHoleDraft());
    }
    setLoading(false);
  }, [leagueRoundId, leagueId, user?.id]);

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
          },
        } as never);
        return;
      }
      router.replace(
        banner
          ? { pathname: '/(tabs)/analyze', params: { leagueBanner: banner } }
          : '/(tabs)/analyze'
      );
    },
    [queue, router]
  );

  const onSubmit = async () => {
    if (scrambleBlocked) {
      showAppAlert('Cannot submit', scrambleBlocked);
      return;
    }
    if (!isScorecardComplete(holes, format)) {
      showAppAlert('Incomplete scorecard', 'Enter all 18 holes before submitting.');
      return;
    }

    setBusy(true);
    const token = googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;

    const up = await upsertTournamentHoleScores(leagueRoundId, holes, token);
    if (up.error) {
      setBusy(false);
      showAppAlert('Could not save', up.error);
      return;
    }

    let teamPartialNote: string | null = null;
    if (format === 'scramble' || format === 'best_ball') {
      const teamRes = await invokeCalculateTeamHoleScores(leagueRoundId, token);
      if (teamRes.error) {
        setBusy(false);
        showAppAlert('Team scores', teamRes.error);
        return;
      }
      if (format === 'best_ball' && teamRes.data?.is_partial) {
        teamPartialNote = formatBestBallPartialNote(
          teamRes.data.teammates_submitted ?? 0,
          teamRes.data.teammates_expected ?? 0
        );
      }
    }

    if (format === 'match_play') {
      const mpRes = await invokeCalculateMatchPlayResult(leagueRoundId, token);
      if (mpRes.error) {
        setBusy(false);
        showAppAlert('Match play', mpRes.error);
        return;
      }
      if (mpRes.data?.pairing_error) {
        setBusy(false);
        showAppAlert('Match not updated', mpRes.data.pairing_error);
        return;
      }
    }

    setBusy(false);
    let banner = `Hole scores saved for ${leagueName}. Your round now counts toward tournament standings.`;
    if (teamPartialNote) {
      banner = `${banner} ${teamPartialNote}`;
    }
    goNext(banner);
  };

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
          <Text style={styles.title}>Tournament scorecard</Text>
          <Text style={styles.blocked}>{scrambleBlocked}</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnTxt}>Go back</Text>
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
        <Text style={styles.title}>Tournament scorecard</Text>
        <Text style={styles.sub}>
          {leagueName} · {formatLeagueFormatLabel(format)} · Logged gross {grossScore}
        </Text>

        <ScoreReconciliationBanner reconciliation={reconciliation} />

        <TournamentHoleScorecard
          format={format}
          pars={pars}
          holes={holes}
          onChangeHole={onChangeHole}
          teamScoreLabel={
            format === 'scramble'
              ? 'Team score — one gross per hole for your crew'
              : format === 'best_ball'
                ? 'Your gross — best per hole counts for the team'
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
            <Text style={styles.submitTxt}>Submit round</Text>
          )}
        </Pressable>

        <Pressable style={styles.laterBtn} onPress={() => goNext()} disabled={busy}>
          <Text style={styles.laterTxt}>Finish later</Text>
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
