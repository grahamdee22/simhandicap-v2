import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthContext';
import { ContentWidth } from '../../src/components/ContentWidth';
import { IconPlus } from '../../src/components/SvgUiIcons';
import { showAppAlert } from '../../src/lib/alertCompat';
import { colors } from '../../src/lib/constants';
import { formatHandicapIndexDisplay } from '../../src/lib/handicap';
import { headToHeadFromLoggedRound } from '../../src/lib/h2hFromRound';
import { useResponsive } from '../../src/lib/responsive';
import {
  cancelOutboundGroupInvite,
  createSocialGroup,
  fetchGroupMatchesFromSupabase,
  fetchInboundGroupInvitesIntoStore,
  fetchMySocialGroupsIntoStore,
  respondToGroupInvite,
  sendGroupInvite,
} from '../../src/lib/socialGroups';
import { isSupabaseConfigured } from '../../src/lib/supabase';
import {
  useAppStore,
  type GroupMember,
  type HeadToHead,
} from '../../src/store/useAppStore';

const APP_INVITE_URL = 'https://simhandicap-v2.vercel.app';

function openMailtoSimCapInvite(email: string, inviterName: string) {
  const who = inviterName.trim() || 'A friend';
  const body = `${who} invited you to join their SimCap group. SimCap tracks your simulator golf handicap — sign up free at ${APP_INVITE_URL} and you'll be added to the group automatically.`;
  const subject = 'Join SimCap';
  const url = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  void Linking.openURL(url);
}

const avColors = [
  ['#e1f5ee', '#0f6e56'],
  ['#eeedfe', '#3c3489'],
  ['#faeeda', '#854f0b'],
  ['#faece7', '#712b13'],
  ['#e6f1fb', '#0c447c'],
] as const;

function avatarStyle(i: number) {
  const [bg, fg] = avColors[i % avColors.length];
  return { backgroundColor: bg, color: fg as string };
}

function trendLabel(t: GroupMember['trend']): { text: string; style: object } {
  if (t === 'down') return { text: '↓ improving', style: styles.trendUp };
  if (t === 'up') return { text: '↑ needs work', style: styles.trendDn };
  return { text: '→ steady', style: styles.trendFl };
}

function indexSortKey(m: GroupMember): number {
  return m.index ?? 999;
}

export default function GroupsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { gutter, isVeryWide } = useResponsive();
  const insets = useSafeAreaInsets();
  const supabaseOn = isSupabaseConfigured();

  const groups = useAppStore((s) => s.groups);
  const inboundGroupInvites = useAppStore((s) => s.inboundGroupInvites);
  const rounds = useAppStore((s) => s.rounds);
  const displayName = useAppStore((s) => s.displayName);
  const addGroup = useAppStore((s) => s.addGroup);
  const recomputeGroupsFromYou = useAppStore((s) => s.recomputeGroupsFromYou);

  const [tab, setTab] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhase, setInvitePhase] = useState<'form' | 'success'>('form');
  const [inviteSuccessDetail, setInviteSuccessDetail] = useState('');
  const [listRefreshing, setListRefreshing] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inboundBusy, setInboundBusy] = useState(false);
  const [matches, setMatches] = useState<HeadToHead[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  /** Bumped when the Social screen gains focus so head-to-head refetches after tab blur. */
  const [h2hFocusEpoch, setH2hFocusEpoch] = useState(0);

  /** Bumps on blur so in-flight fetches don’t leave `listRefreshing` stuck true (e.g. switch tabs mid-request). */
  const groupsRefreshSessionRef = useRef(0);
  /** Invalidates in-flight head-to-head fetches (blur, crew change, or stale completion). */
  const h2hFetchGenRef = useRef(0);
  /** Tracks which crew `matches` belongs to — avoids a blocking spinner on tab refocus (stale-while-revalidate). */
  const h2hMatchesGroupIdRef = useRef<string | undefined>(undefined);

  const g = groups[tab] ?? groups[0];

  useFocusEffect(
    useCallback(() => {
      if (!supabaseOn) return;
      const session = ++groupsRefreshSessionRef.current;
      const emptyShell = useAppStore.getState().groups.length === 0;
      if (emptyShell) setListRefreshing(true);

      void (async () => {
        try {
          await fetchMySocialGroupsIntoStore();
          await fetchInboundGroupInvitesIntoStore();
          if (groupsRefreshSessionRef.current !== session) return;
          useAppStore.getState().recomputeGroupsFromYou();
        } finally {
          if (groupsRefreshSessionRef.current === session && emptyShell) {
            setListRefreshing(false);
          }
        }
      })();

      return () => {
        groupsRefreshSessionRef.current += 1;
        setListRefreshing(false);
      };
    }, [supabaseOn])
  );

  useEffect(() => {
    if (groups.length === 0) {
      setTab(0);
      return;
    }
    if (tab >= groups.length) setTab(groups.length - 1);
  }, [groups.length, tab]);

  useFocusEffect(
    useCallback(() => {
      if (supabaseOn) {
        setH2hFocusEpoch((n) => n + 1);
      }
      return () => {
        h2hFetchGenRef.current += 1;
        setMatchesLoading(false);
      };
    }, [supabaseOn])
  );

  useEffect(() => {
    if (!g?.id || !supabaseOn) {
      h2hFetchGenRef.current += 1;
      h2hMatchesGroupIdRef.current = undefined;
      setMatches([]);
      setMatchesLoading(false);
      return;
    }
    const switchedCrew = h2hMatchesGroupIdRef.current !== g.id;
    if (switchedCrew) {
      h2hMatchesGroupIdRef.current = g.id;
      setMatches([]);
      setMatchesLoading(true);
    }

    const gen = ++h2hFetchGenRef.current;

    const safetyMs = 25000;
    const safetyTimer = setTimeout(() => {
      if (h2hFetchGenRef.current !== gen) return;
      setMatches([]);
      setMatchesLoading(false);
    }, safetyMs);

    void fetchGroupMatchesFromSupabase(g.id)
      .then((rows) => {
        clearTimeout(safetyTimer);
        if (h2hFetchGenRef.current !== gen) return;
        setMatches(Array.isArray(rows) ? rows : []);
        setMatchesLoading(false);
      })
      .catch(() => {
        clearTimeout(safetyTimer);
        if (h2hFetchGenRef.current !== gen) return;
        setMatches([]);
        setMatchesLoading(false);
      });

    return () => {
      clearTimeout(safetyTimer);
      h2hFetchGenRef.current += 1;
      setMatchesLoading(false);
    };
  }, [g?.id, supabaseOn, h2hFocusEpoch]);

  const ranked = useMemo(() => {
    if (!g) return [];
    return [...g.members].sort((a, b) => indexSortKey(a) - indexSortKey(b));
  }, [g]);

  const pendingInAppRows = g?.pendingInApp ?? [];
  const pendingEmailRows = g?.pendingEmail ?? [];
  const hasMemberOrPending =
    ranked.length > 0 || pendingInAppRows.length > 0 || pendingEmailRows.length > 0;

  const mergedHeadToHead = useMemo((): HeadToHead[] => {
    if (!g) return [];
    if (supabaseOn) {
      return matches;
    }
    const fromRounds = rounds
      .filter((r) => r.h2hGroupId === g.id && r.h2hOpponentMemberId)
      .map((r) => headToHeadFromLoggedRound(r, displayName))
      .filter((h): h is HeadToHead => h != null);
    return fromRounds.sort((a, b) => {
      const dt = new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime();
      if (dt !== 0) return dt;
      return b.id.localeCompare(a.id);
    });
  }, [g, rounds, displayName, supabaseOn, matches]);

  const onCreate = () => {
    setNewName('');
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    const n = newName.trim();
    if (!n) return;
    if (supabaseOn) {
      setCreateBusy(true);
      try {
        const res = await createSocialGroup(n);
        if ('error' in res) {
          showAppAlert('Create group', res.error);
          return;
        }
        setNewName('');
        setCreateOpen(false);
        void (async () => {
          try {
            await fetchMySocialGroupsIntoStore();
            recomputeGroupsFromYou();
            const ng = useAppStore.getState().groups;
            const i = ng.findIndex((gr) => gr.id === res.id);
            if (i >= 0) setTab(i);
            else setTab(Math.max(0, ng.length - 1));
          } catch (e) {
            console.warn('[groups] refresh after create', e);
            showAppAlert(
              'Group created',
              'Your group was saved. Pull to refresh or revisit this tab if it does not appear yet.'
            );
          }
        })();
      } catch (e) {
        showAppAlert('Create group', e instanceof Error ? e.message : 'Something went wrong');
      } finally {
        setCreateBusy(false);
      }
      return;
    }
    const nextTab = groups.length;
    addGroup(n);
    setNewName('');
    setCreateOpen(false);
    setTab(nextTab);
  };

  const openInvite = () => {
    setInviteEmail('');
    setInvitePhase('form');
    setInviteSuccessDetail('');
    setInviteOpen(true);
  };

  const closeInvite = () => {
    setInviteOpen(false);
    setInviteEmail('');
    setInvitePhase('form');
    setInviteSuccessDetail('');
  };

  const emailLooksValid = (raw: string) => {
    const e = raw.trim();
    if (e.length < 5) return false;
    const at = e.indexOf('@');
    const dot = e.lastIndexOf('.');
    return at > 0 && dot > at + 1 && dot < e.length - 1;
  };

  const submitInvite = async () => {
    if (!g) return;
    const email = inviteEmail.trim();
    if (!emailLooksValid(email)) {
      showAppAlert('Check email', 'Enter a valid email address.');
      return;
    }
    if (supabaseOn) {
      setInviteBusy(true);
      const { error, result } = await sendGroupInvite(g.id, email);
      setInviteBusy(false);
      if (error) {
        showAppAlert('Invite', error);
        return;
      }
      if (result?.kind === 'already_member') {
        showAppAlert('Already in crew', `${email} is already a member of this group.`);
        return;
      }
      if (result?.kind === 'in_app') {
        const detail = result.duplicate
          ? `${email} already has a pending invite from this crew.`
          : `They will see it at the top of the Social tab with Accept and Decline.`;
        setInviteSuccessDetail(`Invite sent to ${email}.\n\n${detail}`);
        if (!result.duplicate) {
          await fetchMySocialGroupsIntoStore();
          recomputeGroupsFromYou();
        }
        setInvitePhase('success');
        return;
      }
      if (result?.kind === 'email') {
        const detail = result.duplicate
          ? `We already have an open email invite for that address.`
          : `Your email app should open with a signup message. They can join at ${APP_INVITE_URL}.`;
        if (!result.duplicate) {
          openMailtoSimCapInvite(email, displayName);
          await fetchMySocialGroupsIntoStore();
          recomputeGroupsFromYou();
        }
        setInviteSuccessDetail(`Invite sent to ${email}.\n\n${detail}`);
        setInvitePhase('success');
        return;
      }
      showAppAlert('Invite', 'Something went wrong.');
      return;
    }
    showAppAlert(
      'Invite',
      `Sign in with Supabase to send invites. (Offline mode: no server.)`
    );
    closeInvite();
  };

  const onAcceptInboundInvite = async (inv: { id: string; groupId: string }) => {
    setInboundBusy(true);
    const { error } = await respondToGroupInvite(inv.id, true);
    setInboundBusy(false);
    if (error) {
      showAppAlert('Accept invite', error);
      return;
    }
    await fetchMySocialGroupsIntoStore();
    await fetchInboundGroupInvitesIntoStore();
    recomputeGroupsFromYou();
    const ng = useAppStore.getState().groups;
    const gi = ng.findIndex((gr) => gr.id === inv.groupId);
    if (gi >= 0) setTab(gi);
    showAppAlert('Welcome', "You've joined the crew.");
  };

  const onDeclineInboundInvite = async (inviteId: string) => {
    setInboundBusy(true);
    const { error } = await respondToGroupInvite(inviteId, false);
    setInboundBusy(false);
    if (error) {
      showAppAlert('Decline invite', error);
      return;
    }
    await fetchInboundGroupInvitesIntoStore();
  };

  const onCancelOutboundInvite = async (kind: 'in_app' | 'email', id: string) => {
    const { error } = await cancelOutboundGroupInvite(kind, id);
    if (error) {
      showAppAlert('Cancel invite', error);
      return;
    }
    await fetchMySocialGroupsIntoStore();
    recomputeGroupsFromYou();
  };

  const isGroupCreator =
    supabaseOn && !!user?.id && !!g?.createdByUserId && g.createdByUserId === user.id;

  const inboundInviteCards =
    supabaseOn && inboundGroupInvites.length > 0
      ? inboundGroupInvites.map((inv) => (
          <View key={inv.id} style={styles.inboundCard}>
            <Text style={styles.inboundText}>
              <Text style={styles.inboundStrong}>{inv.inviterName}</Text>
              {` invited you to join `}
              <Text style={styles.inboundStrong}>{inv.groupName}</Text>
            </Text>
            <View style={styles.inboundActions}>
              <Pressable
                onPress={() => void onAcceptInboundInvite(inv)}
                disabled={inboundBusy}
                style={[styles.inboundBtn, styles.inboundBtnAccept, inboundBusy && styles.modalBtnDisabled]}
              >
                <Text style={styles.inboundBtnAcceptTxt}>Accept</Text>
              </Pressable>
              <Pressable
                onPress={() => void onDeclineInboundInvite(inv.id)}
                disabled={inboundBusy}
                style={[styles.inboundBtn, styles.inboundBtnDecline, inboundBusy && styles.modalBtnDisabled]}
              >
                <Text style={styles.inboundBtnDeclineTxt}>Decline</Text>
              </Pressable>
            </View>
          </View>
        ))
      : [];

  if (groups.length === 0) {
    return (
      <View style={[styles.page, { paddingTop: insets.top }]}>
        <ContentWidth bg={colors.surface} style={styles.contentWidthOuter} contentStyle={styles.contentWidthInner}>
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: gutter,
              paddingBottom: insets.bottom + 32,
              paddingTop: 24,
            }}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.emptyTitle}>Social</Text>
            {inboundInviteCards.length > 0 ? (
              <View style={{ gap: 10, marginBottom: 18 }}>{inboundInviteCards}</View>
            ) : null}
            <Text style={styles.emptyLead}>
              Crews you create or join show up here. Each tab is a group — with a live leaderboard, recent head-to-head,
              and invites.
            </Text>
            <Text style={styles.emptyMuted}>
              You don’t have any groups yet. Create one to get started, then invite friends from the Social tab once
              they’re on SimHandicap.
            </Text>
            {listRefreshing ? (
              <View style={styles.inlineLoader}>
                <ActivityIndicator color={colors.header} />
              </View>
            ) : null}
            <Pressable style={styles.emptyCta} onPress={onCreate}>
              <IconPlus size={18} color="#fff" />
              <Text style={styles.emptyCtaTxt}>Create your first group</Text>
            </Pressable>
          </ScrollView>
        </ContentWidth>

        <Modal visible={createOpen} animationType="fade" transparent>
          <Pressable style={styles.modalBackdrop} onPress={() => !createBusy && setCreateOpen(false)}>
            <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.modalTitle}>New group</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Group name"
                placeholderTextColor={colors.subtle}
                value={newName}
                onChangeText={setNewName}
                autoFocus
                editable={!createBusy}
              />
              <View style={styles.modalActions}>
                <Pressable onPress={() => !createBusy && setCreateOpen(false)} style={styles.modalBtn}>
                  <Text style={styles.modalBtnTxt}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void submitCreate()}
                  disabled={createBusy}
                  style={[styles.modalBtn, styles.modalBtnPrimary, createBusy && styles.modalBtnDisabled]}
                >
                  {createBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={[styles.modalBtnTxt, styles.modalBtnTxtPri]}>Create</Text>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={[styles.tabs, { paddingHorizontal: gutter }]}>
        {groups.map((gr, i) => (
          <Pressable
            key={gr.id}
            style={[styles.groupTab, tab === i && styles.groupTabOn]}
            onPress={() => setTab(i)}
          >
            <Text style={[styles.groupTabTxt, tab === i && styles.groupTabTxtOn]} numberOfLines={1}>
              {gr.name}
            </Text>
          </Pressable>
        ))}
      </View>

      <ContentWidth bg={colors.surface} style={styles.contentWidthOuter} contentStyle={styles.contentWidthInner}>
        <View style={styles.root}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
            showsVerticalScrollIndicator={false}
          >
            {inboundInviteCards.length > 0 ? (
              <View style={{ marginHorizontal: gutter, marginTop: 12, gap: 10 }}>{inboundInviteCards}</View>
            ) : null}

            <View style={[styles.card, { marginHorizontal: gutter }]}>
              <View style={styles.cardHdr}>
                <View>
                  <Text style={styles.groupName}>{g.name}</Text>
                  {g.lastRoundSummary ? <Text style={styles.groupMeta}>{g.lastRoundSummary}</Text> : null}
                </View>
                <Pressable
                  onPress={openInvite}
                  accessibilityRole="button"
                  accessibilityLabel={`Invite someone to ${g.name}`}
                >
                  <Text style={styles.invite}>+ Invite</Text>
                </Pressable>
              </View>
              {!hasMemberOrPending ? (
                <Text style={[styles.membersEmpty, { paddingHorizontal: 12, paddingVertical: 14 }]}>
                  No members in this crew yet. Invited friends will appear here after they join.
                </Text>
              ) : (
                <>
                  {ranked.map((m, rank) => {
                    const tr = trendLabel(m.trend);
                    const av = avatarStyle(rank);
                    return (
                      <View key={m.id} style={[styles.lbRow, m.isYou && styles.lbRowMe]}>
                        <Text
                          style={[
                            styles.lbRank,
                            rank === 0 && styles.rankGold,
                            rank === 1 && styles.rankSilver,
                            rank === 2 && styles.rankBronze,
                          ]}
                        >
                          {rank + 1}
                        </Text>
                        <View style={[styles.lbAv, { backgroundColor: av.backgroundColor }]}>
                          <Text style={[styles.lbAvTxt, { color: av.color }]}>{m.initials}</Text>
                        </View>
                        <View style={styles.lbInfo}>
                          <Text style={[styles.lbName, m.isYou && styles.lbNameMe]} numberOfLines={1}>
                            {m.displayName}
                          </Text>
                          <Text style={styles.lbSub} numberOfLines={1}>
                            {m.roundsLogged} rounds · {m.platform}
                          </Text>
                        </View>
                        <View style={styles.lbRight}>
                          <Text style={styles.lbIdx}>
                            {formatHandicapIndexDisplay(m.index)}
                          </Text>
                          <Text style={tr.style}>{tr.text}</Text>
                        </View>
                      </View>
                    );
                  })}
                  {pendingInAppRows.map((p) => (
                    <View key={p.id} style={[styles.lbRow, styles.lbRowPending]}>
                      <Text style={styles.lbRank}>—</Text>
                      <View style={[styles.lbAv, styles.lbAvMuted]}>
                        <Text style={styles.lbAvMutedTxt}>…</Text>
                      </View>
                      <View style={styles.lbInfo}>
                        <Text style={styles.lbName} numberOfLines={1}>
                          {p.label}
                        </Text>
                        <Text style={styles.lbSub} numberOfLines={1}>
                          Pending invite
                        </Text>
                      </View>
                      {isGroupCreator ? (
                        <Pressable
                          onPress={() => void onCancelOutboundInvite('in_app', p.id)}
                          hitSlop={8}
                          style={styles.cancelInvitePress}
                        >
                          <Text style={styles.cancelInviteTxt}>Cancel</Text>
                        </Pressable>
                      ) : (
                        <View style={styles.lbRight}>
                          <Text style={styles.pendingBadge}>Pending</Text>
                        </View>
                      )}
                    </View>
                  ))}
                  {pendingEmailRows.map((p) => (
                    <View key={p.id} style={[styles.lbRow, styles.lbRowPending]}>
                      <Text style={styles.lbRank}>—</Text>
                      <View style={[styles.lbAv, styles.lbAvMuted]}>
                        <Text style={styles.lbAvMutedTxt}>@</Text>
                      </View>
                      <View style={styles.lbInfo}>
                        <Text style={styles.lbName} numberOfLines={1}>
                          {p.email}
                        </Text>
                        <Text style={styles.lbSub} numberOfLines={1}>
                          Pending · email invite
                        </Text>
                      </View>
                      {isGroupCreator ? (
                        <Pressable
                          onPress={() => void onCancelOutboundInvite('email', p.id)}
                          hitSlop={8}
                          style={styles.cancelInvitePress}
                        >
                          <Text style={styles.cancelInviteTxt}>Cancel</Text>
                        </Pressable>
                      ) : (
                        <View style={styles.lbRight}>
                          <Text style={styles.pendingBadge}>Pending</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </>
              )}
            </View>

            <Pressable
              style={[styles.toolCard, { marginHorizontal: gutter }]}
              onPress={() => router.push('/(tabs)/net-calculator')}
              accessibilityRole="button"
              accessibilityLabel="Open net score calculator"
            >
              <View style={styles.toolCardInner}>
                <View style={styles.toolTextCol}>
                  <Text style={styles.toolTitle}>Net score calculator</Text>
                  <Text style={styles.toolSub}>
                    Match strokes from indexes, course, and sim settings — then start logging vs your opponent.
                  </Text>
                </View>
                <Text style={styles.toolChev} accessible={false}>
                  ›
                </Text>
              </View>
            </Pressable>

            <View style={[styles.sectionHead, { paddingHorizontal: gutter }]}>
              <Text style={styles.sectionTitle}>Recent head-to-head</Text>
            </View>
            {matchesLoading && supabaseOn ? (
              <View style={[styles.h2hLoading, { paddingHorizontal: gutter }]}>
                <ActivityIndicator color={colors.subtle} />
              </View>
            ) : mergedHeadToHead.length === 0 ? (
              <Text style={[styles.h2hEmpty, { paddingHorizontal: gutter }]}>
                No head-to-head results yet. Log a round from the Log tab and tag an opponent from this crew — it will
                show up here for everyone in the group.
              </Text>
            ) : isVeryWide ? (
              <View style={[styles.h2hGrid, { paddingHorizontal: gutter }]}>
                {mergedHeadToHead.map((h) => (
                  <View key={h.id} style={[styles.matchCard, styles.matchCardGrid]}>
                    <Text style={styles.matchCourse}>
                      {h.courseName} ·{' '}
                      {new Date(h.playedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </Text>
                    <View style={styles.matchRow}>
                      <View style={styles.matchSide}>
                        <Text style={styles.matchNm}>{h.left.name}</Text>
                        <Text style={[styles.matchGross, h.left.won && styles.matchWin]}>{h.left.gross}</Text>
                        {h.left.net != null ? (
                          <Text style={styles.matchNet}>net {h.left.net.toFixed(1)}</Text>
                        ) : null}
                      </View>
                      <Text style={styles.vs}>vs</Text>
                      <View style={[styles.matchSide, { alignItems: 'flex-end' }]}>
                        <Text style={styles.matchNm}>{h.right.name}</Text>
                        <Text
                          style={[
                            styles.matchGross,
                            h.right.won && styles.matchWin,
                            h.right.gross == null && styles.matchPending,
                          ]}
                        >
                          {h.right.gross != null ? h.right.gross : '—'}
                        </Text>
                        {h.right.net != null ? (
                          <Text style={styles.matchNet}>net {h.right.net.toFixed(1)}</Text>
                        ) : h.right.gross == null ? (
                          <Text style={styles.matchPendingLbl}>Their score not logged</Text>
                        ) : null}
                      </View>
                    </View>
                    <Text style={styles.matchCond}>{h.conditionsLine}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <>
                {mergedHeadToHead.map((h) => (
                  <View key={h.id} style={[styles.matchCard, { marginHorizontal: gutter }]}>
                    <Text style={styles.matchCourse}>
                      {h.courseName} ·{' '}
                      {new Date(h.playedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </Text>
                    <View style={styles.matchRow}>
                      <View style={styles.matchSide}>
                        <Text style={styles.matchNm}>{h.left.name}</Text>
                        <Text style={[styles.matchGross, h.left.won && styles.matchWin]}>{h.left.gross}</Text>
                        {h.left.net != null ? (
                          <Text style={styles.matchNet}>net {h.left.net.toFixed(1)}</Text>
                        ) : null}
                      </View>
                      <Text style={styles.vs}>vs</Text>
                      <View style={[styles.matchSide, { alignItems: 'flex-end' }]}>
                        <Text style={styles.matchNm}>{h.right.name}</Text>
                        <Text
                          style={[
                            styles.matchGross,
                            h.right.won && styles.matchWin,
                            h.right.gross == null && styles.matchPending,
                          ]}
                        >
                          {h.right.gross != null ? h.right.gross : '—'}
                        </Text>
                        {h.right.net != null ? (
                          <Text style={styles.matchNet}>net {h.right.net.toFixed(1)}</Text>
                        ) : h.right.gross == null ? (
                          <Text style={styles.matchPendingLbl}>Their score not logged</Text>
                        ) : null}
                      </View>
                    </View>
                    <Text style={styles.matchCond}>{h.conditionsLine}</Text>
                  </View>
                ))}
              </>
            )}

            <Pressable style={[styles.newGrp, { marginHorizontal: gutter }]} onPress={onCreate}>
              <IconPlus size={16} color={colors.subtle} />
              <Text style={styles.newGrpTxt}>Create a new group</Text>
            </Pressable>
          </ScrollView>

          <Modal visible={createOpen} animationType="fade" transparent>
            <Pressable style={styles.modalBackdrop} onPress={() => !createBusy && setCreateOpen(false)}>
              <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
                <Text style={styles.modalTitle}>New group</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Group name"
                  placeholderTextColor={colors.subtle}
                  value={newName}
                  onChangeText={setNewName}
                  autoFocus
                  editable={!createBusy}
                />
                <View style={styles.modalActions}>
                  <Pressable onPress={() => !createBusy && setCreateOpen(false)} style={styles.modalBtn}>
                    <Text style={styles.modalBtnTxt}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void submitCreate()}
                    disabled={createBusy}
                    style={[styles.modalBtn, styles.modalBtnPrimary, createBusy && styles.modalBtnDisabled]}
                  >
                    {createBusy ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={[styles.modalBtnTxt, styles.modalBtnTxtPri]}>Create</Text>
                    )}
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </Modal>

          <Modal visible={inviteOpen} animationType="fade" transparent>
            <Pressable style={styles.modalBackdrop} onPress={() => !inviteBusy && closeInvite()}>
              <Pressable style={styles.modalBox} onPress={(e) => e.stopPropagation()}>
                {invitePhase === 'form' ? (
                  <>
                    <Text style={styles.modalTitle}>Invite to group</Text>
                    <Text style={styles.modalSub}>
                      If they already use SimCap, they’ll get an in-app invite. Otherwise we’ll record the invite and open
                      your email app with a signup message for{' '}
                      <Text style={styles.modalSubStrong}>{g.name}</Text>.
                    </Text>
                    <TextInput
                      style={styles.modalInput}
                      placeholder="Email address"
                      placeholderTextColor={colors.subtle}
                      value={inviteEmail}
                      onChangeText={setInviteEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      autoFocus
                      editable={!inviteBusy}
                    />
                    <View style={styles.modalActions}>
                      <Pressable onPress={() => !inviteBusy && closeInvite()} style={styles.modalBtn}>
                        <Text style={styles.modalBtnTxt}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void submitInvite()}
                        disabled={inviteBusy}
                        style={[styles.modalBtn, styles.modalBtnPrimary, inviteBusy && styles.modalBtnDisabled]}
                      >
                        {inviteBusy ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={[styles.modalBtnTxt, styles.modalBtnTxtPri]}>Send invite</Text>
                        )}
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.modalTitle}>Invite sent</Text>
                    <Text style={styles.modalSuccessBody}>{inviteSuccessDetail}</Text>
                    <View style={styles.modalActionsCol}>
                      <Pressable
                        onPress={() => {
                          setInvitePhase('form');
                          setInviteEmail('');
                          setInviteSuccessDetail('');
                        }}
                        style={[styles.modalBtn, styles.modalBtnGhost]}
                      >
                        <Text style={styles.modalBtnGhostTxt}>Invite someone else</Text>
                      </Pressable>
                      <Pressable onPress={closeInvite} style={[styles.modalBtn, styles.modalBtnPrimary]}>
                        <Text style={[styles.modalBtnTxt, styles.modalBtnTxtPri]}>Done</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </Pressable>
            </Pressable>
          </Modal>
        </View>
      </ContentWidth>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, width: '100%', minHeight: 0, backgroundColor: colors.surface },
  contentWidthOuter: { flex: 1, minHeight: 0, width: '100%' },
  contentWidthInner: { flex: 1, minHeight: 0, width: '100%' },
  root: { flex: 1, minHeight: 0, backgroundColor: colors.surface, width: '100%' },
  scroll: { flex: 1, minHeight: 0, width: '100%' },
  h2hGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  matchCardGrid: {
    width: '48%',
    flexGrow: 1,
    minWidth: 280,
    maxWidth: 520,
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 24, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  emptyLead: { fontSize: 15, color: colors.muted, lineHeight: 22, marginBottom: 12 },
  emptyMuted: { fontSize: 13, color: colors.subtle, lineHeight: 19, marginBottom: 24 },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.header,
    paddingVertical: 14,
    borderRadius: 12,
  },
  emptyCtaTxt: { fontSize: 16, fontWeight: '700', color: '#fff' },
  inlineLoader: { alignItems: 'center', marginBottom: 16 },
  membersEmpty: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  h2hLoading: { paddingVertical: 16, alignItems: 'flex-start' },
  modalBtnDisabled: { opacity: 0.7 },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    paddingVertical: 12,
    backgroundColor: colors.header,
    alignItems: 'center',
  },
  groupTab: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 99,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.15)',
    maxWidth: 160,
  },
  groupTabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  groupTabTxt: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.45)' },
  groupTabTxtOn: { color: '#fff' },
  card: {
    marginTop: 12,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  cardHdr: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  groupName: { fontSize: 13, fontWeight: '600', color: colors.ink },
  groupMeta: { fontSize: 10, color: colors.subtle, marginTop: 1 },
  invite: { fontSize: 11, color: colors.sage, fontWeight: '700' },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  lbRowMe: { backgroundColor: colors.accentSoft },
  lbRank: { width: 18, textAlign: 'center', fontSize: 12, fontWeight: '600', color: colors.subtle },
  rankGold: { color: colors.gold },
  rankSilver: { color: colors.silver },
  rankBronze: { color: colors.bronze },
  lbAv: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lbAvTxt: { fontSize: 10, fontWeight: '600' },
  lbInfo: { flex: 1, minWidth: 0 },
  lbName: { fontSize: 12, fontWeight: '600', color: colors.ink },
  lbNameMe: { color: colors.accentDark },
  lbSub: { fontSize: 10, color: colors.subtle, marginTop: 1 },
  lbRight: { alignItems: 'flex-end' },
  lbIdx: { fontSize: 14, fontWeight: '600', color: colors.ink },
  trendUp: { fontSize: 10, color: colors.accent },
  trendDn: { fontSize: 10, color: colors.danger },
  trendFl: { fontSize: 10, color: colors.subtle },
  toolCard: {
    marginTop: 12,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.bg,
  },
  toolCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 10,
  },
  toolTextCol: { flex: 1, minWidth: 0 },
  toolTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  toolSub: { fontSize: 11, color: colors.muted, marginTop: 4, lineHeight: 15 },
  toolChev: { fontSize: 22, color: colors.subtle, fontWeight: '300' },
  sectionHead: { paddingTop: 14, paddingBottom: 6 },
  sectionTitle: { fontSize: 12, fontWeight: '600', color: colors.ink },
  h2hEmpty: { fontSize: 12, color: colors.muted, lineHeight: 18 },
  matchCard: {
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
  },
  matchCourse: { fontSize: 12, fontWeight: '600', color: colors.ink, marginBottom: 7 },
  matchRow: { flexDirection: 'row', alignItems: 'center' },
  matchSide: { flex: 1 },
  matchNm: { fontSize: 11, color: colors.muted },
  matchGross: { fontSize: 17, fontWeight: '600', color: colors.ink, marginTop: 2 },
  matchWin: { color: colors.accent },
  matchPending: { color: colors.subtle },
  matchNet: { fontSize: 10, color: colors.subtle, marginTop: 2 },
  matchPendingLbl: { fontSize: 9, color: colors.subtle, marginTop: 2, fontStyle: 'italic' },
  vs: { fontSize: 10, color: colors.subtle, paddingHorizontal: 6 },
  matchCond: { fontSize: 10, color: colors.subtle, marginTop: 5 },
  newGrp: {
    marginTop: 10,
    borderWidth: 0.5,
    borderStyle: 'dashed',
    borderColor: colors.pillBorder,
    borderRadius: 10,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  newGrpTxt: { fontSize: 12, fontWeight: '600', color: colors.subtle },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 18,
  },
  modalTitle: { fontSize: 17, fontWeight: '600', color: colors.ink, marginBottom: 8 },
  modalSub: { fontSize: 13, color: colors.muted, lineHeight: 18, marginBottom: 14 },
  modalSubStrong: { fontWeight: '600', color: colors.ink },
  modalInput: {
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 16,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalActionsCol: { gap: 10, marginTop: 4 },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 14 },
  modalBtnPrimary: { backgroundColor: colors.header, borderRadius: 8, alignItems: 'center' },
  modalBtnGhost: {
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.sage,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
  },
  modalBtnGhostTxt: { fontSize: 15, fontWeight: '700', color: colors.accent },
  modalBtnTxt: { fontSize: 15, fontWeight: '600', color: colors.accent },
  modalBtnTxtPri: { color: '#fff', fontWeight: '700' },
  modalSuccessBody: { fontSize: 14, color: colors.muted, lineHeight: 21, marginBottom: 8 },
  inboundCard: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
    padding: 14,
  },
  inboundText: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  inboundStrong: { fontWeight: '700', color: colors.header },
  inboundActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  inboundBtn: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
  inboundBtnAccept: { backgroundColor: colors.header },
  inboundBtnAcceptTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  inboundBtnDecline: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.sage,
  },
  inboundBtnDeclineTxt: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  lbRowPending: { backgroundColor: colors.bg },
  lbAvMuted: { backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  lbAvMutedTxt: { fontSize: 12, fontWeight: '600', color: colors.subtle },
  pendingBadge: { fontSize: 10, fontWeight: '700', color: colors.sage },
  cancelInvitePress: { paddingVertical: 4, paddingHorizontal: 4 },
  cancelInviteTxt: { fontSize: 11, fontWeight: '700', color: colors.danger },
});
