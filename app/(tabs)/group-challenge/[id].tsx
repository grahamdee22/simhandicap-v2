import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthContext';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { useTranslation } from '../../../src/i18n';
import { confirmDestructive, showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { getCourseById } from '../../../src/lib/courses';
import { todayLocalYmd } from '../../../src/lib/dates';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import {
  activateGroupChallenge,
  cancelGroupChallenge,
  canSubmitChallengeRound,
  challengeResultLabel,
  challengeRoundBadgeKey,
  disputeGroupChallengeRound,
  fetchGroupChallengeBundle,
  finalizeGroupChallenge,
  GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS,
  GROUP_CHALLENGE_ROSTER_SIZE,
  markGroupChallengeBundleDirty,
  respondGroupChallenge,
  opposingRosterUserIds,
  resolveChallengeViewGroupId,
  setChallengedGroupRoster,
  takeGroupChallengeBundleDirty,
  teamTotalFromRounds,
  verifyGroupChallengeRound,
  type DbGroupChallengeRound,
  type DbGroupChallengeRoster,
  type GroupChallengeBundle,
  type GroupChallengeEligibility,
} from '../../../src/lib/groupChallenges';
import { clearTournamentSectionCache } from '../../../src/lib/tournamentSectionCache';
import {
  cachedGroupName,
  friendlyChallengeError,
  resolveGroupNames,
  truncatedGroupId,
} from '../../../src/lib/groupChallengeGroupNames';
import { createGroupChallengeScorecardSignedUrl } from '../../../src/lib/groupChallengeScorecardStorage';
import { formatLeagueDateRange } from '../../../src/lib/leagueStandings';
import { useResponsive } from '../../../src/lib/responsive';
import { isSocialGroupManager } from '../../../src/lib/socialGroupCreator';
import {
  isSocialGroupManagerViaRpc,
  resolveSocialGroupsAccessToken,
} from '../../../src/lib/socialGroups';
import { useAppStore } from '../../../src/store/useAppStore';

type Side = 'challenging' | 'challenged';

function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(digits);
}

function isCountingRound(
  r: Pick<DbGroupChallengeRound, 'verification_status'>,
  mode: 'verified' | 'casual'
): boolean {
  return mode === 'verified'
    ? r.verification_status === 'verified'
    : r.verification_status === 'verified' || r.verification_status === 'pending';
}

export default function GroupChallengeDetailScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    id: string | string[];
    fromGroupId?: string | string[];
  }>();
  const challengeId = typeof params.id === 'string' ? params.id : params.id?.[0] ?? '';
  const fromGroupIdRaw = params.fromGroupId;
  const fromGroupId =
    typeof fromGroupIdRaw === 'string'
      ? fromGroupIdRaw
      : Array.isArray(fromGroupIdRaw)
        ? fromGroupIdRaw[0]
        : undefined;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user, session } = useAuth();
  const groups = useAppStore((s) => s.groups);
  const authUserId = session?.user?.id ?? user?.id ?? null;

  const [bundle, setBundle] = useState<GroupChallengeBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [remoteNames, setRemoteNames] = useState<Record<string, string>>({});
  const [rpcManages, setRpcManages] = useState<Record<string, boolean>>({});
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const [editingRoster, setEditingRoster] = useState(false);
  const [disputeTarget, setDisputeTarget] = useState<DbGroupChallengeRound | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const loadGenRef = useRef(0);

  const getToken = useCallback(
    async () => googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined,
    []
  );

  const load = useCallback(
    async (silent = false) => {
      if (!challengeId) {
        setLoading(false);
        return;
      }
      const gen = ++loadGenRef.current;
      if (!silent) setLoading(true);
      const token = await getToken();
      const res = await fetchGroupChallengeBundle(challengeId, token);
      // Ignore stale responses from an earlier in-flight fetch.
      if (gen !== loadGenRef.current) return;
      setBundle(res.data);
      setLoading(false);
    },
    [challengeId, getToken]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      const dirty = takeGroupChallengeBundleDirty(challengeId);
      void load(!dirty);
    }, [challengeId, load])
  );

  const challenge = bundle?.challenge ?? null;
  const challengingId = challenge?.challenging_group_id ?? '';
  const challengedId = challenge?.challenged_group_id ?? '';

  // Opponent / unknown group names (prefer lookup_groups_for_challenge with the uuid).
  useEffect(() => {
    if (!challengingId || !challengedId) return;
    let cancelled = false;
    void (async () => {
      const token = await getToken();
      const names = await resolveGroupNames([challengingId, challengedId], groups, token);
      if (!cancelled) setRemoteNames((prev) => ({ ...prev, ...names }));
    })();
    return () => {
      cancelled = true;
    };
  }, [challengingId, challengedId, groups, getToken]);

  const groupName = useCallback(
    (gid: string) =>
      groups.find((g) => g.id === gid)?.name ??
      remoteNames[gid] ??
      cachedGroupName(gid, groups) ??
      truncatedGroupId(gid),
    [groups, remoteNames]
  );

  // Manager flags: store first, RPC fallback for groups we belong to but where store lacks admin flag.
  const storeManages = useCallback(
    (gid: string) => {
      const g = groups.find((x) => x.id === gid);
      return g ? isSocialGroupManager(g, authUserId) : false;
    },
    [groups, authUserId]
  );

  useEffect(() => {
    if (!authUserId) return;
    let cancelled = false;
    const ids = [challengingId, challengedId].filter(Boolean);
    void (async () => {
      const token = await getToken();
      for (const gid of ids) {
        const inStore = groups.some((g) => g.id === gid);
        if (!inStore || storeManages(gid)) continue;
        const { isManager } = await isSocialGroupManagerViaRpc(gid, token);
        if (!cancelled) setRpcManages((prev) => ({ ...prev, [gid]: isManager }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authUserId, challengingId, challengedId, groups, storeManages, getToken]);

  const managesGroup = useCallback(
    (gid: string) => storeManages(gid) || rpcManages[gid] === true,
    [storeManages, rpcManages]
  );

  const managesChallenging = challengingId ? managesGroup(challengingId) : false;
  const managesChallenged = challengedId ? managesGroup(challengedId) : false;
  const managesEither = managesChallenging || managesChallenged;

  const memberNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const g of groups) {
      for (const mem of g.members) {
        if (mem.userId) m[mem.userId] = mem.displayName.replace(' (you)', '');
      }
    }
    return { ...m, ...(bundle?.displayNames ?? {}) };
  }, [groups, bundle?.displayNames]);

  const playerName = useCallback(
    (userId: string) =>
      memberNames[userId] ??
      (userId === authUserId ? t('groupChallenge.you') : t('groupChallenge.player')),
    [memberNames, authUserId, t]
  );

  const rosterBySide = useMemo(() => {
    const out: Record<Side, DbGroupChallengeRoster[]> = { challenging: [], challenged: [] };
    if (!bundle) return out;
    for (const r of bundle.rosters) {
      if (r.withdrawn_at) continue;
      if (r.group_id === bundle.challenge.challenging_group_id) out.challenging.push(r);
      else if (r.group_id === bundle.challenge.challenged_group_id) out.challenged.push(r);
    }
    for (const side of ['challenging', 'challenged'] as const) {
      out[side].sort((a, b) => playerName(a.user_id).localeCompare(playerName(b.user_id)));
    }
    return out;
  }, [bundle, playerName]);

  const rosterSize = challenge?.roster_size ?? GROUP_CHALLENGE_ROSTER_SIZE;
  const challengingFull =
    rosterBySide.challenging.filter((r) => r.eligibility_status === 'eligible').length ===
    rosterSize;
  const challengedFull =
    rosterBySide.challenged.filter((r) => r.eligibility_status === 'eligible').length ===
    rosterSize;
  const challengedRosterIncomplete = rosterBySide.challenged.length !== rosterSize;

  const myRoster = useMemo(() => {
    if (!bundle || !authUserId) return null;
    return (
      bundle.rosters.find(
        (r) =>
          r.user_id === authUserId && !r.withdrawn_at && r.eligibility_status === 'eligible'
      ) ?? null
    );
  }, [bundle, authUserId]);

  const myGroupId = useMemo(() => {
    if (!challenge) return '';
    return resolveChallengeViewGroupId({
      challengingGroupId: challenge.challenging_group_id,
      challengedGroupId: challenge.challenged_group_id,
      fromGroupId,
      rosterGroupId: myRoster?.group_id ?? null,
      memberGroupIds: groups.map((g) => g.id),
    });
  }, [challenge, myRoster, groups, fromGroupId]);

  const roundsByRoster = useMemo(() => {
    const m = new Map<string, DbGroupChallengeRound>();
    for (const r of bundle?.rounds ?? []) m.set(r.roster_entry_id, r);
    return m;
  }, [bundle?.rounds]);

  const myRound = myRoster ? roundsByRoster.get(myRoster.id) ?? null : null;
  const today = todayLocalYmd();

  const submitCheck = useMemo((): { ok: boolean; reason?: string } => {
    if (!challenge) return { ok: false };
    return canSubmitChallengeRound({
      challenge,
      roster: myRoster,
      existingRound: myRound,
      todayYmd: today,
    });
  }, [challenge, myRoster, myRound, today]);

  const countingBySide = useMemo(() => {
    const out: Record<Side, DbGroupChallengeRound[]> = { challenging: [], challenged: [] };
    if (!challenge) return out;
    for (const side of ['challenging', 'challenged'] as const) {
      for (const roster of rosterBySide[side]) {
        if (roster.eligibility_status !== 'eligible') continue;
        const round = roundsByRoster.get(roster.id);
        if (round && isCountingRound(round, challenge.verification_mode)) {
          out[side].push(round);
        }
      }
    }
    return out;
  }, [challenge, rosterBySide, roundsByRoster]);

  const canFinalize =
    !!challenge &&
    (challenge.status === 'active' || challenge.status === 'disputed') &&
    managesEither &&
    countingBySide.challenging.length >= rosterSize &&
    countingBySide.challenged.length >= rosterSize;

  const runAction = useCallback(
    async (
      key: string,
      fn: (token: string | undefined) => Promise<{ error: string | null }>,
      onDone?: () => void
    ) => {
      setBusyKey(key);
      try {
        const token = await getToken();
        const res = await fn(token);
        if (res.error) {
          showAppAlert(t('groupChallenge.errorTitle'), friendlyChallengeError(res.error));
          return;
        }
        onDone?.();
        markGroupChallengeBundleDirty(challengeId);
        if (challengingId) clearTournamentSectionCache(challengingId);
        if (challengedId) clearTournamentSectionCache(challengedId);
        // Force a non-silent refetch so activate / roster / verify never flash stale UI.
        await load(false);
      } finally {
        setBusyKey(null);
      }
    },
    [getToken, load, t, challengeId, challengingId, challengedId]
  );

  const onRespond = (accept: boolean) => {
    if (!challenge) return;
    const run = () =>
      void runAction(accept ? 'accept' : 'decline', (token) =>
        respondGroupChallenge(challenge.id, accept, token)
      );
    if (accept) {
      run();
      return;
    }
    void confirmDestructive(
      t('groupChallenge.declineConfirmTitle'),
      t('groupChallenge.declineConfirmBody'),
      t('groupChallenge.decline')
    ).then((ok) => {
      if (ok) run();
    });
  };

  const onCancel = () => {
    if (!challenge) return;
    void confirmDestructive(
      t('groupChallenge.cancelConfirmTitle'),
      t('groupChallenge.cancelConfirmBody'),
      t('groupChallenge.cancel')
    ).then((ok) => {
      if (ok) {
        void runAction('cancel', (token) => cancelGroupChallenge(challenge.id, token));
      }
    });
  };

  const onActivate = () => {
    if (!challenge) return;
    void runAction('activate', (token) => activateGroupChallenge(challenge.id, token));
  };

  const onFinalize = () => {
    if (!challenge) return;
    void confirmDestructive(
      t('groupChallenge.finalizeConfirmTitle'),
      t('groupChallenge.finalizeConfirmBody'),
      t('groupChallenge.finalize')
    ).then((ok) => {
      if (ok) {
        void runAction('finalize', (token) => finalizeGroupChallenge(challenge.id, token));
      }
    });
  };

  const onVerify = (round: DbGroupChallengeRound, approve: boolean) => {
    void runAction(`verify:${round.id}`, (token) =>
      verifyGroupChallengeRound(round.id, approve, undefined, token)
    );
  };

  const onSubmitDispute = () => {
    const target = disputeTarget;
    if (!target) return;
    const reason = disputeReason.trim();
    if (!reason) {
      showAppAlert(t('groupChallenge.disputeReasonRequiredTitle'), t('groupChallenge.disputeReasonRequiredBody'));
      return;
    }
    void runAction(
      `dispute:${target.id}`,
      (token) => disputeGroupChallengeRound(target.id, reason, token),
      () => {
        setDisputeTarget(null);
        setDisputeReason('');
      }
    );
  };

  const onViewEvidence = async (round: DbGroupChallengeRound) => {
    if (!round.evidence_path) return;
    setBusyKey(`evidence:${round.id}`);
    try {
      const token = await getToken();
      const res = await createGroupChallengeScorecardSignedUrl({
        path: round.evidence_path,
        accessToken: token,
      });
      if ('error' in res) {
        showAppAlert(t('groupChallenge.errorTitle'), res.error);
        return;
      }
      await Linking.openURL(res.signedUrl);
    } catch (e) {
      showAppAlert(t('groupChallenge.errorTitle'), String(e));
    } finally {
      setBusyKey(null);
    }
  };

  // Challenged-side roster picker
  const challengedGroup = groups.find((g) => g.id === challengedId) ?? null;
  const takenByOpposing = useMemo(
    () =>
      challenge
        ? opposingRosterUserIds(bundle?.rosters ?? [], challenge.challenged_group_id)
        : new Set<string>(),
    [bundle?.rosters, challenge]
  );
  const pickableMembers = useMemo(
    () =>
      (challengedGroup?.members ?? [])
        .filter((m) => !!m.userId)
        .map((m) => {
          const onOtherSide = takenByOpposing.has(m.userId);
          const enoughRounds =
            (m.roundsLogged ?? 0) >= GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS;
          return {
            userId: m.userId,
            name: m.displayName.replace(' (you)', ''),
            roundsLogged: m.roundsLogged ?? 0,
            eligible: enoughRounds && !onOtherSide,
            onOtherSide,
            index: m.index,
          };
        }),
    [challengedGroup?.members, takenByOpposing]
  );

  const showRosterPicker =
    !!challenge &&
    challenge.status === 'accepted' &&
    managesChallenged &&
    !!challengedGroup &&
    (challengedRosterIncomplete || editingRoster);

  useEffect(() => {
    if (!showRosterPicker) return;
    setPickedIds((prev) => {
      if (prev.length > 0) {
        // Drop anyone who became unavailable (e.g. already on the other side).
        return prev.filter((id) => !takenByOpposing.has(id));
      }
      return rosterBySide.challenged
        .map((r) => r.user_id)
        .filter((id) => !takenByOpposing.has(id));
    });
    // Only seed when the picker opens / opposing roster changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRosterPicker, takenByOpposing]);

  const togglePick = (userId: string, eligible: boolean) => {
    if (!eligible) return;
    setPickedIds((prev) => {
      if (prev.includes(userId)) return prev.filter((id) => id !== userId);
      if (prev.length >= rosterSize) return prev;
      return [...prev, userId];
    });
  };

  const onSaveRoster = () => {
    if (!challenge || busyKey != null) return;
    if (pickedIds.length !== rosterSize) {
      showAppAlert(
        t('groupChallenge.rosterPick.needExactlyTitle'),
        t('groupChallenge.rosterPick.needExactlyBody', { count: rosterSize })
      );
      return;
    }
    const blocked = pickedIds.filter((id) => takenByOpposing.has(id));
    if (blocked.length > 0) {
      showAppAlert(
        t('groupChallenge.rosterPick.otherSideTitle'),
        t('groupChallenge.rosterPick.otherSideBody')
      );
      return;
    }
    const rosterMeta: Record<
      string,
      { eligibility: GroupChallengeEligibility; qualifyingRounds: number }
    > = {};
    for (const id of pickedIds) {
      const m = pickableMembers.find((x) => x.userId === id);
      const rounds = m?.roundsLogged ?? 0;
      rosterMeta[id] = {
        eligibility:
          rounds >= GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS ? 'eligible' : 'ineligible',
        qualifyingRounds: rounds,
      };
    }
    void runAction(
      'roster',
      (token) =>
        setChallengedGroupRoster({
          challengeId: challenge.id,
          groupId: challenge.challenged_group_id,
          userIds: pickedIds,
          rosterMeta,
          opposingUserIds: takenByOpposing,
          accessToken: token,
        }),
      () => {
        setEditingRoster(false);
        // Keep picks until reload seeds from the saved roster (avoid flashing 0/5).
      }
    );
  };

  if (loading && !bundle) {
    return (
      <ContentWidth bg={colors.surface}>
        <ActivityIndicator color={colors.header} style={{ marginTop: 40 }} />
      </ContentWidth>
    );
  }

  if (!bundle || !challenge) {
    return (
      <ContentWidth bg={colors.surface}>
        <Text style={{ padding: gutter, color: colors.ink }}>{t('groupChallenge.notFound')}</Text>
      </ContentWidth>
    );
  }

  const course = getCourseById(challenge.course_id);
  const courseName = course?.name ?? challenge.course_id;
  const isVerifiedMode = challenge.verification_mode === 'verified';
  const isLive = challenge.status === 'active' || challenge.status === 'disputed';
  const isCompleted = challenge.status === 'completed';
  const canActivate =
    challenge.status === 'accepted' &&
    managesEither &&
    challengingFull &&
    challengedFull &&
    today >= challenge.start_date;
  const canCancel =
    managesEither &&
    !['completed', 'canceled', 'declined'].includes(challenge.status);
  const showRespond = challenge.status === 'pending' && managesChallenged;
  const dualAdminPending =
    challenge.status === 'pending' && managesChallenging && managesChallenged;
  const busy = busyKey != null;

  const resultFor = (gid: string) => bundle.results.find((r) => r.group_id === gid) ?? null;

  const outcome = myGroupId
    ? challengeResultLabel({
        status: challenge.status,
        myGroupId,
        winnerGroupId: challenge.winner_group_id,
      })
    : null;

  const renderRosterSide = (side: Side) => {
    const gid = side === 'challenging' ? challengingId : challengedId;
    const entries = rosterBySide[side];
    const sideRounds = entries
      .map((r) => roundsByRoster.get(r.id))
      .filter((r): r is DbGroupChallengeRound => !!r);
    const total = teamTotalFromRounds(sideRounds, challenge.verification_mode);
    return (
      <View style={styles.card} key={side}>
        <View style={styles.cardHeadRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {groupName(gid)}
          </Text>
          {gid === myGroupId ? (
            <View style={styles.pillMuted}>
              <Text style={styles.pillMutedTxt}>{t('groupChallenge.yourGroup')}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.sideLabel}>
          {side === 'challenging' ? t('groupChallenge.challenging') : t('groupChallenge.challenged')}
          {' · '}
          {t('groupChallenge.rosterCount', { count: entries.length, size: rosterSize })}
        </Text>
        {entries.length === 0 ? (
          <Text style={styles.muted}>{t('groupChallenge.rosterEmpty')}</Text>
        ) : (
          entries.map((r) => {
            const round = roundsByRoster.get(r.id);
            const ineligible = r.eligibility_status === 'ineligible';
            return (
              <View key={r.id} style={styles.rosterRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={styles.playerName} numberOfLines={1}>
                    {playerName(r.user_id)}
                    {r.user_id === authUserId ? ` ${t('groupChallenge.youTag')}` : ''}
                  </Text>
                  <Text style={styles.rowSub}>
                    {r.handicap_snapshot != null
                      ? t('groupChallenge.handicapSnapshot', {
                          value: fmtNum(r.handicap_snapshot),
                          source:
                            r.handicap_source === 'ghin'
                              ? t('groupChallenge.sourceGhin')
                              : t('groupChallenge.sourceSimcap'),
                        })
                      : t('groupChallenge.handicapPending')}
                    {' · '}
                    {t('groupChallenge.qualifyingRounds', { count: r.qualifying_rounds_count })}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={ineligible ? styles.pillDanger : styles.pillMuted}>
                    <Text style={ineligible ? styles.pillDangerTxt : styles.pillMutedTxt}>
                      {t(`groupChallenge.eligibility.${r.eligibility_status}`)}
                    </Text>
                  </View>
                  {round ? (
                    <Text style={styles.rowScore}>
                      {t('groupChallenge.netShort', { value: fmtNum(round.net_score) })}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
        {isLive || isCompleted ? (
          <Text style={styles.sideTotal}>
            {t('groupChallenge.teamNet', { value: fmtNum(total) })}
            {' · '}
            {t('groupChallenge.countingScores', {
              count: countingBySide[side].length,
              size: rosterSize,
            })}
          </Text>
        ) : null}
      </View>
    );
  };

  const orderedRounds = [...bundle.rounds].sort((a, b) =>
    a.submitted_at.localeCompare(b.submitted_at)
  );
  const rosterById = new Map(bundle.rosters.map((r) => [r.id, r]));

  return (
    <ContentWidth bg={colors.surface}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: 14,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <View style={styles.badgeRow}>
          <View style={styles.pill}>
            <Text style={styles.pillTxt}>{t(`groupChallenge.status.${challenge.status}`)}</Text>
          </View>
          <View style={isVerifiedMode ? styles.pillVerified : styles.pillMuted}>
            <Text style={isVerifiedMode ? styles.pillVerifiedTxt : styles.pillMutedTxt}>
              {isVerifiedMode ? t('groupChallenge.mode.verified') : t('groupChallenge.mode.casual')}
            </Text>
          </View>
        </View>
        <Text style={styles.title}>{challenge.name}</Text>
        <Text style={styles.vsLine}>
          {t('groupChallenge.vsLine', {
            a: groupName(challengingId),
            b: groupName(challengedId),
          })}
        </Text>
        <Text style={styles.modeHelp}>
          {isVerifiedMode ? t('groupChallenge.mode.verifiedHelp') : t('groupChallenge.mode.casualHelp')}
        </Text>

        <View style={styles.card}>
          <Text style={styles.metaLine}>
            🗓 {formatLeagueDateRange(challenge.start_date, challenge.end_date)}
          </Text>
          <Text style={styles.metaLine}>📍 {courseName}</Text>
          <Text style={styles.metaLine}>
            ⛳ {challenge.tee_name?.trim() ? challenge.tee_name.trim() : t('groupChallenge.anyTee')}
            {' · '}
            {challenge.holes_per_round === '9'
              ? t('groupChallenge.holes9')
              : t('groupChallenge.holes18')}
            {' · '}
            {t('groupChallenge.noMulligans')}
          </Text>
          {challenge.notes?.trim() ? (
            <Text style={styles.notes}>{challenge.notes.trim()}</Text>
          ) : null}
        </View>

        {isCompleted ? (
          <View style={[styles.card, styles.resultCard]}>
            <Text style={styles.resultTitle}>
              {outcome === 'win'
                ? t('groupChallenge.result.win')
                : outcome === 'loss'
                  ? t('groupChallenge.result.loss')
                  : outcome === 'tie' || !challenge.winner_group_id
                    ? t('groupChallenge.result.tie')
                    : t('groupChallenge.result.winner', {
                        name: groupName(challenge.winner_group_id),
                      })}
            </Text>
            {outcome !== 'tie' && challenge.winner_group_id && (outcome === 'win' || outcome === 'loss') ? (
              <Text style={styles.resultSub}>
                {t('groupChallenge.result.winner', { name: groupName(challenge.winner_group_id) })}
              </Text>
            ) : null}
            <Text style={styles.sectionLabel}>{t('groupChallenge.result.teamTotals')}</Text>
            {[challengingId, challengedId].map((gid) => {
              const res = resultFor(gid);
              const isWinner = challenge.winner_group_id === gid;
              return (
                <View key={gid} style={styles.totalRow}>
                  <Text style={[styles.totalName, isWinner && styles.totalWinner]} numberOfLines={1}>
                    {isWinner ? '🏆 ' : ''}
                    {groupName(gid)}
                  </Text>
                  <Text style={[styles.totalValue, isWinner && styles.totalWinner]}>
                    {res ? fmtNum(res.total_net) : '—'}
                  </Text>
                </View>
              );
            })}
            <Text style={styles.sectionLabel}>{t('groupChallenge.result.individualNets')}</Text>
            {[challengingId, challengedId].map((gid) => (
              <View key={`ind-${gid}`} style={{ marginTop: 6 }}>
                <Text style={styles.sideLabel}>{groupName(gid)}</Text>
                {(gid === challengingId ? rosterBySide.challenging : rosterBySide.challenged).map((r) => {
                  const round = roundsByRoster.get(r.id);
                  return (
                    <View key={r.id} style={styles.totalRow}>
                      <Text style={styles.totalName} numberOfLines={1}>
                        {playerName(r.user_id)}
                      </Text>
                      <Text style={styles.totalValue}>
                        {round
                          ? t('groupChallenge.grossNet', {
                              gross: round.gross_score,
                              net: fmtNum(round.net_score),
                            })
                          : '—'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        ) : null}

        {/* Pending: sender waiting (also shown for dual-member admins) */}
        {challenge.status === 'pending' && managesChallenging ? (
          <Text style={styles.infoNote}>
            {t('groupChallenge.sentWaiting', {
              sent: groupName(challengingId),
              other: groupName(challengedId),
            })}
          </Text>
        ) : null}

        {/* Pending actions (challenged-side admin) */}
        {showRespond ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {dualAdminPending
                ? t('groupChallenge.respondDualTitle', { name: groupName(challengedId) })
                : t('groupChallenge.respondTitle')}
            </Text>
            <Text style={styles.muted}>
              {dualAdminPending
                ? t('groupChallenge.respondDualBody', { name: groupName(challengedId) })
                : t('groupChallenge.respondBody', { name: groupName(challengingId) })}
            </Text>
            <View style={styles.btnRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  styles.btnFlex,
                  (pressed || busy) && styles.pressed,
                ]}
                disabled={busy}
                onPress={() => onRespond(true)}
                accessibilityRole="button"
              >
                {busyKey === 'accept' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnTxt}>{t('groupChallenge.accept')}</Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.dangerBtn,
                  styles.btnFlex,
                  (pressed || busy) && styles.pressed,
                ]}
                disabled={busy}
                onPress={() => onRespond(false)}
                accessibilityRole="button"
              >
                <Text style={styles.dangerBtnTxt}>{t('groupChallenge.decline')}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {challenge.status === 'pending' && !managesChallenging && !managesChallenged ? (
          <Text style={styles.infoNote}>
            {t('groupChallenge.waitingForResponse', { name: groupName(challengedId) })}
          </Text>
        ) : null}

        {showRosterPicker ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('groupChallenge.rosterPick.title')}</Text>
            <Text style={styles.muted}>
              {t('groupChallenge.rosterPick.help', {
                count: rosterSize,
                min: GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS,
              })}
            </Text>
            <Text style={styles.pickCount}>
              {t('groupChallenge.rosterPick.selected', {
                selected: pickedIds.length,
                count: rosterSize,
              })}
            </Text>
            {pickableMembers.length === 0 ? (
              <Text style={styles.muted}>{t('groupChallenge.rosterPick.noMembers')}</Text>
            ) : (
              pickableMembers.map((m) => {
                const on = pickedIds.includes(m.userId);
                const missing = Math.max(0, GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS - m.roundsLogged);
                return (
                  <Pressable
                    key={m.userId}
                    onPress={() => togglePick(m.userId, m.eligible)}
                    disabled={!m.eligible}
                    style={({ pressed }) => [
                      styles.pickRow,
                      on && styles.pickRowOn,
                      !m.eligible && styles.pickRowDisabled,
                      pressed && m.eligible && styles.pressed,
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: !m.eligible }}
                  >
                    <View style={[styles.checkbox, on && styles.checkboxOn]}>
                      {on ? <Text style={styles.checkboxTick}>✓</Text> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.playerName} numberOfLines={1}>
                        {m.name}
                      </Text>
                      <Text style={styles.rowSub}>
                        {t('groupChallenge.qualifyingRounds', { count: m.roundsLogged })}
                        {m.index != null ? ` · ${t('groupChallenge.indexShort', { value: fmtNum(m.index) })}` : ''}
                      </Text>
                    </View>
                    {m.onOtherSide ? (
                      <View style={styles.pillDanger}>
                        <Text style={styles.pillDangerTxt}>
                          {t('groupChallenge.rosterPick.onOtherSide')}
                        </Text>
                      </View>
                    ) : !m.eligible ? (
                      <View style={styles.pillDanger}>
                        <Text style={styles.pillDangerTxt}>
                          {t('groupChallenge.rosterPick.ineligible', { missing })}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })
            )}
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                (pressed || busy || pickedIds.length !== rosterSize) && styles.pressed,
                pickedIds.length !== rosterSize && styles.btnDisabled,
              ]}
              disabled={busy || pickedIds.length !== rosterSize}
              onPress={onSaveRoster}
              accessibilityRole="button"
            >
              {busyKey === 'roster' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnTxt}>{t('groupChallenge.rosterPick.save')}</Text>
              )}
            </Pressable>
            {editingRoster ? (
              <Pressable
                style={styles.linkBtn}
                onPress={() => {
                  setEditingRoster(false);
                  setPickedIds([]);
                }}
              >
                <Text style={styles.linkBtnTxt}>{t('groupChallenge.rosterPick.cancelEdit')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {challenge.status === 'accepted' && !managesChallenged && challengedRosterIncomplete ? (
          <Text style={styles.infoNote}>
            {t('groupChallenge.waitingForRoster', { name: groupName(challengedId) })}
          </Text>
        ) : null}

        {challenge.status === 'accepted' && managesChallenged && !showRosterPicker && !challengedRosterIncomplete ? (
          <Pressable style={styles.linkBtn} onPress={() => setEditingRoster(true)}>
            <Text style={styles.linkBtnTxt}>{t('groupChallenge.rosterPick.edit')}</Text>
          </Pressable>
        ) : null}

        {challenge.status === 'accepted' && managesEither ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('groupChallenge.activateTitle')}</Text>
            <Text style={styles.muted}>
              {!challengingFull || !challengedFull
                ? t('groupChallenge.activateNeedRosters', { count: rosterSize })
                : today < challenge.start_date
                  ? t('groupChallenge.activateNotYet', { date: challenge.start_date })
                  : t('groupChallenge.activateBody')}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                (pressed || busy) && styles.pressed,
                !canActivate && styles.btnDisabled,
              ]}
              disabled={busy || !canActivate}
              onPress={onActivate}
              accessibilityRole="button"
            >
              {busyKey === 'activate' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnTxt}>{t('groupChallenge.activate')}</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {/* Rosters */}
        <Text style={styles.sectionHeader}>{t('groupChallenge.rostersTitle')}</Text>
        {renderRosterSide('challenging')}
        {renderRosterSide('challenged')}

        {/* Active: my CTA */}
        {isLive && myRoster && !myRound ? (
          <View style={[styles.card, styles.ctaCard]}>
            <Text style={styles.cardTitle}>{t('groupChallenge.yourRoundTitle')}</Text>
            <Text style={styles.muted}>
              {submitCheck.ok
                ? isVerifiedMode
                  ? t('groupChallenge.yourRoundBodyVerified')
                  : t('groupChallenge.yourRoundBodyCasual')
                : submitCheck.reason ?? t('groupChallenge.cannotSubmit')}
            </Text>
            {submitCheck.ok ? (
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
                onPress={() =>
                  router.push(`/(tabs)/group-challenge-log/${challenge.id}` as never)
                }
                accessibilityRole="button"
              >
                <Text style={styles.primaryBtnTxt}>{t('groupChallenge.logCta')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {myRound ? (
          <Text style={styles.infoNote}>
            {t('groupChallenge.youSubmitted', {
              gross: myRound.gross_score,
              net: fmtNum(myRound.net_score),
            })}
          </Text>
        ) : null}

        {/* Rounds */}
        {(isLive || isCompleted) && (
          <>
            <Text style={styles.sectionHeader}>{t('groupChallenge.roundsTitle')}</Text>
            {orderedRounds.length === 0 ? (
              <Text style={styles.muted}>{t('groupChallenge.roundsEmpty')}</Text>
            ) : (
              orderedRounds.map((round) => {
                const roster = rosterById.get(round.roster_entry_id);
                if (!roster) return null;
                const ownGid = roster.group_id;
                const opposingGid =
                  ownGid === challengingId ? challengedId : challengingId;
                const isOwnRound = roster.user_id === authUserId;
                const canVerify =
                  isVerifiedMode &&
                  isLive &&
                  (round.verification_status === 'pending' ||
                    round.verification_status === 'disputed') &&
                  !isOwnRound &&
                  managesGroup(ownGid);
                const canDispute =
                  round.verification_status === 'verified' &&
                  isLive &&
                  managesGroup(opposingGid);
                const badgeKey = challengeRoundBadgeKey(
                  round.verification_status,
                  challenge.verification_mode
                );
                const statusStyle =
                  badgeKey === 'verified' || badgeKey === 'counted'
                    ? styles.pillVerified
                    : badgeKey === 'pending'
                      ? styles.pillWarn
                      : styles.pillDanger;
                const statusTxtStyle =
                  badgeKey === 'verified' || badgeKey === 'counted'
                    ? styles.pillVerifiedTxt
                    : badgeKey === 'pending'
                      ? styles.pillWarnTxt
                      : styles.pillDangerTxt;
                return (
                  <View key={round.id} style={styles.card}>
                    <View style={styles.cardHeadRow}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.playerName} numberOfLines={1}>
                          {playerName(roster.user_id)}
                        </Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {groupName(ownGid)}
                        </Text>
                      </View>
                      <View style={statusStyle}>
                        <Text style={statusTxtStyle}>
                          {t(`groupChallenge.verification.${badgeKey}`)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.roundScores}>
                      {t('groupChallenge.grossNet', {
                        gross: round.gross_score,
                        net: fmtNum(round.net_score),
                      })}
                    </Text>
                    {round.verification_notes?.trim() ? (
                      <Text style={styles.rowSub}>{round.verification_notes.trim()}</Text>
                    ) : null}
                    {round.dispute_reason?.trim() ? (
                      <Text style={[styles.rowSub, { color: colors.danger }]}>
                        {t('groupChallenge.disputeReasonLine', { reason: round.dispute_reason.trim() })}
                      </Text>
                    ) : null}
                    {round.evidence_path ? (
                      <Pressable
                        style={styles.linkBtn}
                        onPress={() => void onViewEvidence(round)}
                        disabled={busy}
                      >
                        <Text style={styles.linkBtnTxt}>
                          {busyKey === `evidence:${round.id}`
                            ? t('groupChallenge.loading')
                            : t('groupChallenge.viewScorecard')}
                        </Text>
                      </Pressable>
                    ) : null}
                    {canVerify ? (
                      <View style={styles.btnRow}>
                        <Pressable
                          style={({ pressed }) => [
                            styles.primaryBtn,
                            styles.btnFlex,
                            (pressed || busy) && styles.pressed,
                          ]}
                          disabled={busy}
                          onPress={() => onVerify(round, true)}
                          accessibilityRole="button"
                        >
                          {busyKey === `verify:${round.id}` ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <Text style={styles.primaryBtnTxt}>{t('groupChallenge.approve')}</Text>
                          )}
                        </Pressable>
                        <Pressable
                          style={({ pressed }) => [
                            styles.dangerBtn,
                            styles.btnFlex,
                            (pressed || busy) && styles.pressed,
                          ]}
                          disabled={busy}
                          onPress={() => onVerify(round, false)}
                          accessibilityRole="button"
                        >
                          <Text style={styles.dangerBtnTxt}>{t('groupChallenge.reject')}</Text>
                        </Pressable>
                      </View>
                    ) : null}
                    {isVerifiedMode && round.verification_status === 'pending' && isOwnRound ? (
                      <Text style={styles.rowSub}>{t('groupChallenge.cannotVerifyOwn')}</Text>
                    ) : null}
                    {canDispute ? (
                      <Pressable
                        style={({ pressed }) => [styles.dangerBtn, (pressed || busy) && styles.pressed]}
                        disabled={busy}
                        onPress={() => {
                          setDisputeReason('');
                          setDisputeTarget(round);
                        }}
                        accessibilityRole="button"
                      >
                        <Text style={styles.dangerBtnTxt}>{t('groupChallenge.dispute')}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })
            )}
          </>
        )}

        {/* Finalize */}
        {isLive && managesEither ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('groupChallenge.finalizeTitle')}</Text>
            <Text style={styles.muted}>
              {canFinalize
                ? t('groupChallenge.finalizeReady')
                : t('groupChallenge.finalizeWaiting', { count: rosterSize })}
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                (pressed || busy) && styles.pressed,
                !canFinalize && styles.btnDisabled,
              ]}
              disabled={busy || !canFinalize}
              onPress={onFinalize}
              accessibilityRole="button"
            >
              {busyKey === 'finalize' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnTxt}>{t('groupChallenge.finalize')}</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {canCancel ? (
          <Pressable
            style={({ pressed }) => [styles.cancelBtn, (pressed || busy) && styles.pressed]}
            disabled={busy}
            onPress={onCancel}
            accessibilityRole="button"
          >
            {busyKey === 'cancel' ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <Text style={styles.cancelBtnTxt}>{t('groupChallenge.cancel')}</Text>
            )}
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal
        visible={disputeTarget != null}
        transparent
        animationType="slide"
        onRequestClose={() => setDisputeTarget(null)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setDisputeTarget(null)} />
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.cardTitle}>{t('groupChallenge.disputeTitle')}</Text>
            <Text style={[styles.muted, { marginBottom: 10 }]}>{t('groupChallenge.disputeBody')}</Text>
            <TextInput
              value={disputeReason}
              onChangeText={setDisputeReason}
              placeholder={t('groupChallenge.disputePlaceholder')}
              placeholderTextColor={colors.subtle}
              style={styles.textInput}
              multiline
              maxLength={500}
            />
            <View style={styles.btnRow}>
              <Pressable
                style={[styles.secondaryBtn, styles.btnFlex]}
                onPress={() => setDisputeTarget(null)}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryBtnTxt}>{t('groupChallenge.close')}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.dangerSolidBtn,
                  styles.btnFlex,
                  (pressed || busy) && styles.pressed,
                ]}
                disabled={busy}
                onPress={onSubmitDispute}
                accessibilityRole="button"
              >
                {disputeTarget && busyKey === `dispute:${disputeTarget.id}` ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnTxt}>{t('groupChallenge.submitDispute')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  pill: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
  },
  pillTxt: { fontSize: 11, fontWeight: '700', color: colors.accentDark },
  pillMuted: {
    backgroundColor: colors.bg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pillMutedTxt: { fontSize: 11, fontWeight: '600', color: colors.muted },
  pillVerified: {
    backgroundColor: '#e6f4ec',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accentMuted,
  },
  pillVerifiedTxt: { fontSize: 11, fontWeight: '700', color: colors.accent },
  pillWarn: {
    backgroundColor: '#fff5e7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#dd9a3f',
  },
  pillWarnTxt: { fontSize: 11, fontWeight: '700', color: '#9a5a00' },
  pillDanger: {
    backgroundColor: '#fdecec',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.danger,
  },
  pillDangerTxt: { fontSize: 11, fontWeight: '700', color: colors.danger },
  title: { fontSize: 22, fontWeight: '700', color: colors.ink },
  vsLine: { fontSize: 15, fontWeight: '600', color: colors.accent, marginTop: 4 },
  modeHelp: { fontSize: 12, color: colors.muted, marginTop: 6, marginBottom: 14, lineHeight: 17 },
  card: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 12,
    gap: 6,
  },
  resultCard: { backgroundColor: '#f0f7f3', borderColor: colors.sage },
  ctaCard: { backgroundColor: '#f0f7f3', borderColor: colors.sage },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  sideLabel: { fontSize: 11, fontWeight: '700', color: colors.sage, textTransform: 'uppercase' },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.sage,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.subtle,
    textTransform: 'uppercase',
    marginTop: 10,
  },
  metaLine: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  notes: { fontSize: 13, color: colors.muted, lineHeight: 18, marginTop: 4 },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  infoNote: { fontSize: 13, color: colors.muted, lineHeight: 18, marginBottom: 12 },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  playerName: { fontSize: 14, fontWeight: '600', color: colors.ink },
  rowSub: { fontSize: 12, color: colors.subtle, marginTop: 2 },
  rowScore: { fontSize: 12, fontWeight: '700', color: colors.ink, marginTop: 4 },
  sideTotal: { fontSize: 13, fontWeight: '700', color: colors.accentDark, marginTop: 6 },
  roundScores: { fontSize: 15, fontWeight: '700', color: colors.ink },
  resultTitle: { fontSize: 20, fontWeight: '800', color: colors.accentDark },
  resultSub: { fontSize: 13, color: colors.muted },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 8,
  },
  totalName: { flex: 1, fontSize: 14, color: colors.ink },
  totalValue: { fontSize: 14, fontWeight: '600', color: colors.ink },
  totalWinner: { fontWeight: '800', color: colors.accentDark },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  btnFlex: { flex: 1 },
  btnDisabled: { opacity: 0.4 },
  primaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.header,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 6,
    minHeight: 44,
  },
  primaryBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    marginTop: 6,
  },
  secondaryBtnTxt: { color: colors.ink, fontWeight: '700', fontSize: 15 },
  dangerBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.danger,
    marginTop: 6,
    minHeight: 44,
  },
  dangerBtnTxt: { color: colors.danger, fontWeight: '700', fontSize: 15 },
  dangerSolidBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: colors.danger,
    marginTop: 6,
    minHeight: 44,
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  cancelBtnTxt: { color: colors.danger, fontWeight: '700', fontSize: 14 },
  linkBtn: { paddingVertical: 8, alignSelf: 'flex-start' },
  linkBtnTxt: { fontSize: 13, fontWeight: '700', color: colors.sage },
  pressed: { opacity: 0.85 },
  pickCount: { fontSize: 12, fontWeight: '700', color: colors.accentDark, marginTop: 4 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginTop: 6,
  },
  pickRowOn: { backgroundColor: colors.accentSoft, borderColor: colors.sage },
  pickRowDisabled: { opacity: 0.6, backgroundColor: '#fafafa' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.pillBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkboxTick: { color: '#fff', fontSize: 14, fontWeight: '800', lineHeight: 16 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    minHeight: 80,
    fontSize: 14,
    color: colors.ink,
    textAlignVertical: 'top',
  },
});
