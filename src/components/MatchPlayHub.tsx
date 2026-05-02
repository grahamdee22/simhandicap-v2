import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { confirmDestructive, showAppAlert } from '../lib/alertCompat';
import { colors } from '../lib/constants';
import { socialPageSectionTitleStyles } from '../lib/socialPageSectionTitle';
import {
  deleteMatchById,
  fetchMatchPlayerDisplayNames,
  listMyMatches,
  listOpenFeedMatches,
  updateMatchById,
  type DbMatchRow,
} from '../lib/matchPlay';
import { supabase } from '../lib/supabase';

type Props = {
  gutter: number;
  userId: string | undefined;
  supabaseOn: boolean;
  /** Incoming direct challenges only (for tab badge). */
  onIncomingDirectCount: (n: number) => void;
  /** Your posted challenges now active / waiting — unseen since last Social visit (tab badge). */
  onOutgoingAcceptedUnseenCount?: (n: number) => void;
  /** Optional ⓘ next to section title (Social tab explains Match Play). */
  onMatchPlayInfoPress?: () => void;
};

function storageKeyP1AcceptedSeen(userId: string): string {
  return `@simcap/social_p1_accepted_seen_match_ids/${userId}`;
}

/** You created the match (player 1), an opponent joined, and play is underway. */
function isP1AcceptedLiveChallenge(m: DbMatchRow, uid: string): boolean {
  if (m.player_1_id !== uid) return false;
  if (m.player_2_id == null) return false;
  if (m.status !== 'active' && m.status !== 'waiting') return false;
  return true;
}

async function loadSeenP1AcceptedMatchIds(userId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(storageKeyP1AcceptedSeen(userId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

async function mergeSeenP1AcceptedMatchIds(userId: string, ids: string[]): Promise<Set<string>> {
  const prev = await loadSeenP1AcceptedMatchIds(userId);
  for (const id of ids) prev.add(id);
  await AsyncStorage.setItem(storageKeyP1AcceptedSeen(userId), JSON.stringify([...prev]));
  return prev;
}

/** After Social focus + fresh fetch, wait this long before persisting "seen" so the tab badge can render. */
const SOCIAL_SEEN_MERGE_DELAY_MS = 2200;

function uniqById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of items) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

function formatHoles(m: DbMatchRow): string {
  if (m.holes === 18) return '18 holes';
  if (m.nine_selection === 'front') return 'Front 9';
  if (m.nine_selection === 'back') return 'Back 9';
  return `${m.holes} holes`;
}

function statusLabel(m: DbMatchRow, uid: string): string {
  if (m.status === 'pending' && !m.is_open && m.player_2_id === uid) return 'Needs your response';
  if (m.status === 'pending' && !m.is_open && m.player_1_id === uid) return 'Awaiting opponent';
  if (m.status === 'open' && m.is_open) return 'Open challenge';
  if (m.status === 'active') return 'In progress';
  if (m.status === 'waiting') return 'Waiting on opponent';
  if (m.status === 'complete') return 'Complete';
  if (m.status === 'abandoned') return 'Abandoned';
  if (m.status === 'declined') return 'Declined';
  return m.status;
}

/** Status chip for Incoming & active cards only (not open-feed / history). */
function incomingActiveBadge(
  m: DbMatchRow,
  uid: string
): { text: string; tone: 'incoming' | 'muted' | 'yours' } | null {
  if (!m.is_open && m.status === 'pending' && m.player_2_id === uid) {
    return { text: 'Awaiting your response', tone: 'incoming' };
  }
  if (!m.is_open && m.status === 'pending' && m.player_1_id === uid && m.player_2_id != null) {
    return { text: 'Awaiting opponent', tone: 'muted' };
  }
  if (m.status === 'active' || m.status === 'waiting') {
    return { text: 'In Progress', tone: 'muted' };
  }
  if (m.is_open && m.status === 'open' && m.player_1_id === uid) {
    return { text: 'Your open challenge', tone: 'yours' };
  }
  return null;
}

function partitionHubData(my: DbMatchRow[], uid: string) {
  const incomingDirect = my.filter(
    (m) => !m.is_open && m.status === 'pending' && m.player_2_id === uid
  );

  const outgoingPending = my.filter(
    (m) =>
      !m.is_open &&
      m.status === 'pending' &&
      m.player_1_id === uid &&
      m.player_2_id != null
  );

  const activeOrWaiting = my.filter(
    (m) =>
      (m.status === 'active' || m.status === 'waiting') &&
      (m.player_1_id === uid || m.player_2_id === uid)
  );

  const myOpenPosted = my.filter(
    (m) => m.is_open && m.status === 'open' && m.player_1_id === uid
  );

  const section1 = uniqById([...incomingDirect, ...outgoingPending, ...activeOrWaiting, ...myOpenPosted]);

  const completed = my
    .filter((m) => m.status === 'complete' || m.status === 'abandoned')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 3);

  return { incomingDirect, section1, completed };
}

export function MatchPlayHub({
  gutter,
  userId,
  supabaseOn,
  onIncomingDirectCount,
  onOutgoingAcceptedUnseenCount,
  onMatchPlayInfoPress,
}: Props) {
  const router = useRouter();
  const [myMatches, setMyMatches] = useState<DbMatchRow[]>([]);
  const [openFeed, setOpenFeed] = useState<DbMatchRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [declineBusyId, setDeclineBusyId] = useState<string | null>(null);
  const [cancelOpenBusyId, setCancelOpenBusyId] = useState<string | null>(null);
  const [seenP1AcceptedIds, setSeenP1AcceptedIds] = useState<Set<string>>(() => new Set());
  const [seenP1Hydrated, setSeenP1Hydrated] = useState(false);
  const refetchMatchesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myMatchesRef = useRef<DbMatchRow[]>([]);
  const activeHubUserIdRef = useRef<string | undefined>(undefined);
  const mergeSeenDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    myMatchesRef.current = myMatches;
  }, [myMatches]);

  useEffect(() => {
    if (!supabaseOn || !userId) {
      setSeenP1Hydrated(true);
      return;
    }
    let alive = true;
    void loadSeenP1AcceptedMatchIds(userId).then((s) => {
      if (alive) {
        setSeenP1AcceptedIds(s);
        setSeenP1Hydrated(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [supabaseOn, userId]);

  useEffect(() => {
    if (!onOutgoingAcceptedUnseenCount) return;
    if (!supabaseOn || !userId) {
      onOutgoingAcceptedUnseenCount(0);
      return;
    }
    if (!seenP1Hydrated) return;
    const n = myMatches
      .filter((m) => isP1AcceptedLiveChallenge(m, userId))
      .filter((m) => !seenP1AcceptedIds.has(m.id)).length;
    onOutgoingAcceptedUnseenCount(n);
  }, [
    myMatches,
    seenP1AcceptedIds,
    seenP1Hydrated,
    supabaseOn,
    userId,
    onOutgoingAcceptedUnseenCount,
  ]);

  useFocusEffect(
    useCallback(() => {
      if (!supabaseOn || !userId) {
        activeHubUserIdRef.current = undefined;
        if (mergeSeenDelayTimerRef.current) {
          clearTimeout(mergeSeenDelayTimerRef.current);
          mergeSeenDelayTimerRef.current = null;
        }
        setMyMatches([]);
        setOpenFeed([]);
        setFetchError(false);
        setLoading(false);
        onIncomingDirectCount(0);
        onOutgoingAcceptedUnseenCount?.(0);
        return;
      }

      activeHubUserIdRef.current = userId;
      let cancelled = false;
      setLoading(true);
      setFetchError(false);

      void (async () => {
        const [myRes, openRes] = await Promise.all([listMyMatches(), listOpenFeedMatches()]);
        if (cancelled) return;

        if (myRes.error || openRes.error) {
          if (mergeSeenDelayTimerRef.current) {
            clearTimeout(mergeSeenDelayTimerRef.current);
            mergeSeenDelayTimerRef.current = null;
          }
          setFetchError(true);
          setMyMatches([]);
          setOpenFeed([]);
          myMatchesRef.current = [];
          onIncomingDirectCount(0);
          onOutgoingAcceptedUnseenCount?.(0);
          setLoading(false);
          return;
        }

        const my = myRes.data ?? [];
        const open = openRes.data ?? [];
        myMatchesRef.current = my;
        setMyMatches(my);
        setOpenFeed(open);

        const { incomingDirect } = partitionHubData(my, userId);
        onIncomingDirectCount(incomingDirect.length);

        const nameRows = uniqById([...my, ...open]);
        const nm = await fetchMatchPlayerDisplayNames(nameRows);
        if (!cancelled) setNames(nm);
        setLoading(false);
      })();

      return () => {
        cancelled = true;
        if (mergeSeenDelayTimerRef.current) {
          clearTimeout(mergeSeenDelayTimerRef.current);
          mergeSeenDelayTimerRef.current = null;
        }
        const uid = activeHubUserIdRef.current;
        const rows = myMatchesRef.current;
        if (uid && supabaseOn) {
          const markIds = rows.filter((m) => isP1AcceptedLiveChallenge(m, uid)).map((m) => m.id);
          if (markIds.length > 0) {
            void mergeSeenP1AcceptedMatchIds(uid, markIds).then(setSeenP1AcceptedIds);
          }
        }
      };
    }, [supabaseOn, userId, onIncomingDirectCount, onOutgoingAcceptedUnseenCount])
  );

  useEffect(() => {
    const client = supabase;
    if (!supabaseOn || !userId || !client) return;

    const scheduleRefetch = () => {
      if (refetchMatchesTimerRef.current) clearTimeout(refetchMatchesTimerRef.current);
      refetchMatchesTimerRef.current = setTimeout(() => {
        refetchMatchesTimerRef.current = null;
        void Promise.all([listMyMatches(), listOpenFeedMatches()]).then(([myRes, openRes]) => {
          if (!myRes.error && myRes.data) {
            setMyMatches(myRes.data);
            const { incomingDirect } = partitionHubData(myRes.data, userId);
            onIncomingDirectCount(incomingDirect.length);
          }
          if (!openRes.error && openRes.data) setOpenFeed(openRes.data);
        });
      }, 160);
    };

    const channel = client
      .channel(`match-play-hub:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: 'is_open=eq.true',
        },
        scheduleRefetch
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `player_1_id=eq.${userId}`,
        },
        scheduleRefetch
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `player_2_id=eq.${userId}`,
        },
        scheduleRefetch
      )
      .subscribe();

    return () => {
      if (refetchMatchesTimerRef.current) {
        clearTimeout(refetchMatchesTimerRef.current);
        refetchMatchesTimerRef.current = null;
      }
      void client.removeChannel(channel);
    };
  }, [supabaseOn, userId, onIncomingDirectCount]);

  const isFocused = useIsFocused();

  /**
   * After fresh data while Social is focused, debounce persisting "seen" so the tab badge can paint first.
   * Reschedules when `myMatches` changes (e.g. realtime accept) so late accepts still clear after a quiet window.
   */
  useEffect(() => {
    if (!isFocused || !supabaseOn || !userId) return;
    if (mergeSeenDelayTimerRef.current) {
      clearTimeout(mergeSeenDelayTimerRef.current);
      mergeSeenDelayTimerRef.current = null;
    }
    mergeSeenDelayTimerRef.current = setTimeout(() => {
      mergeSeenDelayTimerRef.current = null;
      const uid = activeHubUserIdRef.current;
      if (!uid) return;
      const rows = myMatchesRef.current;
      const markIds = rows.filter((m) => isP1AcceptedLiveChallenge(m, uid)).map((m) => m.id);
      if (markIds.length === 0) return;
      void mergeSeenP1AcceptedMatchIds(uid, markIds).then(setSeenP1AcceptedIds);
    }, SOCIAL_SEEN_MERGE_DELAY_MS);
    return () => {
      if (mergeSeenDelayTimerRef.current) {
        clearTimeout(mergeSeenDelayTimerRef.current);
        mergeSeenDelayTimerRef.current = null;
      }
    };
  }, [isFocused, myMatches, supabaseOn, userId]);

  const onCreateMatch = useCallback(() => {
    // `fresh` forces match-create to reset when opened from here (same screen instance may stay mounted).
    router.push(`/(tabs)/match-create?fresh=${Date.now()}` as never);
  }, [router]);

  const onAcceptDirect = useCallback(
    (m: DbMatchRow) => {
      router.push(`/(tabs)/match-accept/${m.id}` as never);
    },
    [router]
  );

  const onOpenLiveScoring = useCallback(
    (m: DbMatchRow) => {
      router.push(`/(tabs)/match-score/${m.id}` as never);
    },
    [router]
  );

  const onDeclineDirect = useCallback(
    async (m: DbMatchRow) => {
      const challenger = m.player_1_id ? names[m.player_1_id] ?? 'Challenger' : 'Challenger';
      const ok = await confirmDestructive(
        'Decline challenge?',
        `Decline the match on ${m.course_name}? ${challenger} will see this as declined.`,
        'Decline'
      );
      if (!ok) return;
      setDeclineBusyId(m.id);
      const res = await updateMatchById(m.id, { status: 'declined' });
      setDeclineBusyId(null);
      if (res.error) {
        showAppAlert('Could not decline', res.error);
        return;
      }
      setMyMatches((prev) =>
        prev.map((row) => (row.id === m.id ? { ...row, status: 'declined' as const } : row))
      );
    },
    [names]
  );

  const onCancelOpenPosted = useCallback(async (m: DbMatchRow) => {
    const ok = await confirmDestructive(
      'Cancel this open challenge?',
      'It will be removed from the feed for everyone. This cannot be undone.',
      'Cancel challenge'
    );
    if (!ok) return;
    setCancelOpenBusyId(m.id);
    const res = await deleteMatchById(m.id);
    setCancelOpenBusyId(null);
    if (!res.ok) {
      showAppAlert('Could not cancel', res.error ?? 'Unknown error');
      return;
    }
    setMyMatches((prev) => prev.filter((row) => row.id !== m.id));
    setOpenFeed((prev) => prev.filter((row) => row.id !== m.id));
  }, []);

  if (!supabaseOn || !userId) {
    return (
      <View style={[styles.wrap, { marginHorizontal: gutter }]}>
        <View style={styles.matchPlayTitleRow}>
          <Text style={socialPageSectionTitleStyles.text} accessibilityRole="header">
            Match Play
          </Text>
          {onMatchPlayInfoPress ? (
            <Pressable
              style={styles.infoBtn}
              onPress={onMatchPlayInfoPress}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="About Match Play"
            >
              <Text style={styles.infoBtnTxt}>ⓘ</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.offlineHint}>Sign in with Supabase configured to see matches.</Text>
      </View>
    );
  }

  const { section1, completed } = partitionHubData(myMatches, userId);

  const openFeedForOthers = useMemo(
    () => openFeed.filter((m) => m.player_1_id !== userId),
    [openFeed, userId]
  );

  const nameFor = (id: string | null) => (id ? names[id] ?? 'Golfer' : '—');

  const renderCard = (m: DbMatchRow, uid: string, listKind: 'hub' | 'openFeed' | 'recentHistory' = 'hub') => {
    const p1 = nameFor(m.player_1_id);
    const p2 = nameFor(m.player_2_id);
    const peopleLine =
      m.is_open && m.status === 'open'
        ? `Posted by ${p1}`
        : m.player_2_id
          ? `${p1} vs ${p2}`
          : `Challenger ${p1}`;
    const incomingDirect = !m.is_open && m.status === 'pending' && m.player_2_id === uid;
    const isMyOpenPostedCancelable =
      listKind === 'hub' &&
      m.is_open &&
      m.status === 'open' &&
      m.player_1_id === uid &&
      m.player_2_id == null;
    const declineBusy = declineBusyId === m.id;
    const isLiveScoring =
      (m.status === 'active' || m.status === 'waiting') &&
      m.player_2_id != null &&
      (m.player_1_id === uid || m.player_2_id === uid);

    const hubBadge = listKind === 'hub' ? incomingActiveBadge(m, uid) : null;
    const metaLine =
      listKind === 'hub'
        ? `${formatHoles(m)} · Stroke play`
        : `${statusLabel(m, uid)} · ${formatHoles(m)} · Stroke play`;

    const cardInner = (
      <>
        {hubBadge ? (
          <View
            style={[
              styles.cardStatusBadge,
              hubBadge.tone === 'incoming'
                ? styles.cardStatusBadgeIncoming
                : hubBadge.tone === 'yours'
                  ? styles.cardStatusBadgeYours
                  : styles.cardStatusBadgeMuted,
            ]}
          >
            <Text
              style={
                hubBadge.tone === 'incoming'
                  ? styles.cardStatusBadgeTxtIncoming
                  : hubBadge.tone === 'yours'
                    ? styles.cardStatusBadgeTxtYours
                    : styles.cardStatusBadgeTxtMuted
              }
            >
              {hubBadge.text}
            </Text>
          </View>
        ) : null}
        <Text style={styles.cardTitle} numberOfLines={1}>
          {m.course_name}
        </Text>
        <Text style={styles.cardMeta}>{metaLine}</Text>
        <Text style={styles.cardPeople} numberOfLines={2}>
          {peopleLine}
        </Text>
      </>
    );

    if (listKind === 'openFeed') {
      return (
        <Pressable
          key={m.id}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push(`/(tabs)/match-open-accept/${m.id}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`Open challenge on ${m.course_name}`}
        >
          {cardInner}
          <Text style={styles.cardTapHint}>Tap for details</Text>
        </Pressable>
      );
    }

    if (listKind === 'recentHistory') {
      return (
        <Pressable
          key={m.id}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push(`/(tabs)/match-results/${m.id}` as never)}
          accessibilityRole="button"
          accessibilityLabel={`Results for ${m.course_name}`}
        >
          {cardInner}
          <Text style={styles.cardTapHint}>Tap for results</Text>
        </Pressable>
      );
    }

    if (isLiveScoring) {
      return (
        <Pressable
          key={m.id}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => onOpenLiveScoring(m)}
          accessibilityRole="button"
          accessibilityLabel={`Open live scoring for ${m.course_name}`}
        >
          {cardInner}
          <Text style={styles.cardTapHint}>Tap to enter scores</Text>
        </Pressable>
      );
    }

    return (
      <View key={m.id} style={styles.card}>
        {isMyOpenPostedCancelable ? (
          <View style={styles.cardTopRow}>
            <View style={styles.cardBodyFlex}>{cardInner}</View>
            <Pressable
              onPress={() => void onCancelOpenPosted(m)}
              disabled={cancelOpenBusyId === m.id}
              style={({ pressed }) => [styles.groupDeleteBtn, pressed && styles.groupDeleteBtnPressed]}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Cancel open challenge"
            >
              {cancelOpenBusyId === m.id ? (
                <ActivityIndicator size="small" color={colors.subtle} />
              ) : (
                <Ionicons name="trash-outline" size={22} color={colors.subtle} />
              )}
            </Pressable>
          </View>
        ) : (
          cardInner
        )}
        {incomingDirect ? (
          <View style={styles.cardActions}>
            <Pressable
              style={({ pressed }) => [styles.declineOutlineBtn, pressed && styles.cardActionPressed]}
              onPress={() => void onDeclineDirect(m)}
              disabled={declineBusy}
              accessibilityRole="button"
              accessibilityLabel="Decline challenge"
            >
              {declineBusy ? (
                <ActivityIndicator color={colors.header} />
              ) : (
                <Text style={styles.declineOutlineTxt}>Decline</Text>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.acceptBtn, pressed && styles.cardActionPressed]}
              onPress={() => onAcceptDirect(m)}
              disabled={declineBusy}
              accessibilityRole="button"
              accessibilityLabel="Accept challenge"
            >
              <Text style={styles.acceptBtnTxt}>Accept</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.wrap, { marginHorizontal: gutter }]}>
      <View style={styles.matchPlayTitleRow}>
        <Text style={socialPageSectionTitleStyles.text} accessibilityRole="header">
          Match Play
        </Text>
        {onMatchPlayInfoPress ? (
          <Pressable
            style={styles.infoBtn}
            onPress={onMatchPlayInfoPress}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="About Match Play"
          >
            <Text style={styles.infoBtnTxt}>ⓘ</Text>
          </Pressable>
        ) : null}
      </View>

      <Pressable
        onPress={onCreateMatch}
        style={({ pressed }) => [styles.createBtn, pressed && styles.createBtnPressed]}
        accessibilityRole="button"
        accessibilityLabel="Create match"
      >
        <Text style={styles.createBtnTxt}>Create Match</Text>
      </Pressable>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.header} />
        </View>
      ) : null}

      {fetchError ? (
        <Text style={styles.errorTxt}>Couldn&apos;t load matches. Open Social again to retry.</Text>
      ) : null}

      <Text style={styles.sectionTitle}>Incoming &amp; active</Text>
      <Text style={styles.sectionSub}>Direct challenges and rounds in progress.</Text>
      {section1.length === 0 ? (
        <Text style={styles.empty}>No incoming challenges or active matches.</Text>
      ) : (
        section1.map((m) => renderCard(m, userId))
      )}

      <Text style={[styles.sectionTitle, styles.sectionSpaced]}>Open challenge feed</Text>
      <Text style={styles.sectionSub}>Anyone on SimCap can accept these.</Text>
      {openFeedForOthers.length === 0 ? (
        <Text style={styles.empty}>No open challenges right now.</Text>
      ) : (
        openFeedForOthers.map((m) => renderCard(m, userId, 'openFeed'))
      )}

      <Text style={[styles.sectionTitle, styles.sectionSpaced]}>Recent matches</Text>
      <Text style={styles.sectionSub}>Finished or abandoned stroke-play matches.</Text>
      {completed.length === 0 ? (
        <Text style={styles.empty}>No finished or abandoned matches yet.</Text>
      ) : (
        completed.map((m) => renderCard(m, userId, 'recentHistory'))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 0, marginBottom: 4 },
  matchPlayTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  infoBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#7aa390',
    backgroundColor: '#e8f2ed',
  },
  infoBtnTxt: { fontSize: 11, fontWeight: '700', color: '#1a3d2b', lineHeight: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 4 },
  sectionSub: { fontSize: 11, color: colors.muted, marginTop: 3, marginBottom: 8, lineHeight: 16 },
  sectionSpaced: { marginTop: 18 },
  createBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.header,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 14,
  },
  createBtnPressed: { opacity: 0.9 },
  createBtnTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
  loader: { alignItems: 'flex-start', paddingVertical: 8, marginBottom: 8 },
  errorTxt: { fontSize: 12, color: colors.danger, marginBottom: 10, lineHeight: 17 },
  empty: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 18,
    marginBottom: 4,
    paddingVertical: 6,
  },
  offlineHint: { fontSize: 12, color: colors.subtle, lineHeight: 18 },
  /** Slightly stronger than `colors.border` so cards read clearly on the Social surface. */
  card: {
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  cardStatusBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  cardStatusBadgeIncoming: {
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
  },
  cardStatusBadgeMuted: {
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
  },
  cardStatusBadgeYours: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.header,
  },
  cardStatusBadgeTxtIncoming: { fontSize: 11, fontWeight: '700', color: colors.accentDark },
  cardStatusBadgeTxtMuted: { fontSize: 11, fontWeight: '600', color: colors.muted },
  cardStatusBadgeTxtYours: { fontSize: 11, fontWeight: '700', color: colors.header },
  cardTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  cardMeta: { fontSize: 11, color: colors.muted, marginTop: 4, lineHeight: 16 },
  cardPeople: { fontSize: 11, color: colors.subtle, marginTop: 6, lineHeight: 15 },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  cardBodyFlex: { flex: 1, minWidth: 0 },
  groupDeleteBtn: {
    minWidth: 36,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  groupDeleteBtnPressed: { opacity: 0.7 },
  cardPressed: { opacity: 0.92 },
  cardTapHint: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
    marginTop: 10,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: colors.pillBorder,
  },
  cardActionPressed: { opacity: 0.88 },
  acceptBtn: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 9,
    backgroundColor: colors.header,
    minWidth: 96,
    alignItems: 'center',
  },
  acceptBtnTxt: { fontSize: 14, fontWeight: '700', color: '#fff' },
  declineOutlineBtn: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.sage,
    backgroundColor: colors.accentSoft,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
  },
  declineOutlineTxt: { fontSize: 14, fontWeight: '700', color: colors.accent },
});
