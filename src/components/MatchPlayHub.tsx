import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
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
import { formatHandicapIndexDisplay } from '../lib/handicap';
import { settingsScreenshotPickerOptions } from '../lib/settingsScreenshotPicker';
import { socialPageSectionTitleStyles } from '../lib/socialPageSectionTitle';
import {
  deleteMatchById,
  fetchMatchPlayerDisplayNames,
  listMyMatches,
  listOpenFeedMatches,
  processFutureOpenChallenges,
  updateMatchById,
  type DbMatchRow,
} from '../lib/matchPlay';
import { uploadMatchSettingsScreenshot } from '../lib/matchPlayStorage';
import {
  DEFAULT_OPEN_FEED_FILTERS,
  filterAndSortOpenFeedRows,
  uniqueCourseNamesFromOpenFeed,
  type OpenFeedFilterState,
} from '../lib/openFeedFilters';
import { googleOAuthAccessToken } from '../lib/googleOAuthAccessToken';
import { supabase } from '../lib/supabase';
import { OpenFeedFilterPanel } from './OpenFeedFilterPanel';
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

function challengeLifecycle(m: DbMatchRow): 'scheduled' | 'awaiting_photo' | 'active' | 'expired' {
  const s = m.challenge_status;
  if (s === 'scheduled' || s === 'awaiting_photo' || s === 'active' || s === 'expired') return s;
  return 'active';
}

function formatScheduledWhenAndCountdown(
  v: string | null | undefined
): { whenLabel: string; countdownLabel: string } {
  if (!v) return { whenLabel: 'Scheduled', countdownLabel: 'soon' };
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return { whenLabel: 'Scheduled', countdownLabel: 'soon' };
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const sameDay = d.toDateString() === now.toDateString();
  const sameTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  const diffHours = Math.max(0, Math.floor(diffMs / (60 * 60 * 1000)));
  const whenLabel = sameDay
    ? `Today at ${time}`
    : sameTomorrow
      ? `Tomorrow at ${time}`
      : diffDays <= 7
        ? `In ${diffDays + 1} days at ${time}`
        : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const countdownLabel =
    diffDays >= 2 ? `in ${diffDays} days` : diffHours >= 1 ? `in ${diffHours} hours` : 'soon';
  return { whenLabel, countdownLabel };
}

function statusLabel(m: DbMatchRow, uid: string): string {
  if (m.status === 'pending' && !m.is_open && m.player_2_id === uid) return 'Needs your response';
  if (m.status === 'pending' && !m.is_open && m.player_1_id === uid) return 'Awaiting opponent';
  if (m.status === 'open' && m.is_open) {
    const cs = challengeLifecycle(m);
    if (cs === 'scheduled') return 'Scheduled';
    if (cs === 'awaiting_photo') return 'Awaiting photo';
    if (cs === 'expired') return 'Expired';
    return 'Open challenge';
  }
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

  const awaitingPhotoOwnOpen = my.filter(
    (m) =>
      m.is_open &&
      m.status === 'open' &&
      m.player_1_id === uid &&
      challengeLifecycle(m) === 'awaiting_photo'
  );

  const myOpenPostedActive = my.filter(
    (m) =>
      m.is_open &&
      m.status === 'open' &&
      m.player_1_id === uid &&
      challengeLifecycle(m) === 'active'
  );

  // Top section includes direct challenges, in-progress matches, and own awaiting-photo open challenges.
  const section1 = uniqById([
    ...incomingDirect,
    ...outgoingPending,
    ...activeOrWaiting,
    ...awaitingPhotoOwnOpen,
    ...myOpenPostedActive,
  ]);

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
  const [awaitingPhotoBusyId, setAwaitingPhotoBusyId] = useState<string | null>(null);
  const [seenP1AcceptedIds, setSeenP1AcceptedIds] = useState<Set<string>>(() => new Set());
  const [seenP1Hydrated, setSeenP1Hydrated] = useState(false);
  const [openFeedFilters, setOpenFeedFilters] = useState<OpenFeedFilterState>(DEFAULT_OPEN_FEED_FILTERS);
  const [draftOpenFeedFilters, setDraftOpenFeedFilters] =
    useState<OpenFeedFilterState>(DEFAULT_OPEN_FEED_FILTERS);
  const [openFeedFiltersExpanded, setOpenFeedFiltersExpanded] = useState(false);
  const [futureLifecycleBusy, setFutureLifecycleBusy] = useState(false);
  const refetchMatchesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myMatchesRef = useRef<DbMatchRow[]>([]);
  const activeHubUserIdRef = useRef<string | undefined>(undefined);
  const mergeSeenDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocused = useIsFocused();

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
        return () => {};
      }
      return () => {
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
    if (!supabaseOn || !userId || userId.trim() === '' || !isFocused) {
      return undefined;
    }

    activeHubUserIdRef.current = userId;
    let cancelled = false;
    setLoading(true);
    setFetchError(false);

    const fetchHubRows = async () => {
      const client = supabase;
      const [myRes, openRes] = await Promise.all([
        listMyMatches(userId, googleOAuthAccessToken ?? undefined),
        listOpenFeedMatches(userId, googleOAuthAccessToken ?? undefined),
      ]);
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
      const sessionTok = client ? (await client.auth.getSession()).data.session?.access_token : undefined;
      const nameBearer = googleOAuthAccessToken ?? sessionTok ?? undefined;
      const nm = await fetchMatchPlayerDisplayNames(nameRows, nameBearer ?? undefined);
      if (!cancelled) setNames(nm);
      setLoading(false);
    };

    void (async () => {
      const proc = await processFutureOpenChallenges(googleOAuthAccessToken ?? undefined);
      if (!cancelled && proc.ok && proc.readyForUid) {
        showAppAlert(
          'Future open challenge ready',
          'Your Future Open Challenge is ready — upload your sim setup photo to go live.',
          {
            onOk: () => {
              if (!cancelled) {
                void fetchHubRows();
              }
            },
          }
        );
      }
      await fetchHubRows();
    })();

    return () => {
      cancelled = true;
    };
  }, [isFocused, supabaseOn, userId, onIncomingDirectCount, onOutgoingAcceptedUnseenCount, googleOAuthAccessToken]);

  useEffect(() => {
    const client = supabase;
    if (!supabaseOn || !userId || !client) return;

    const scheduleRefetch = () => {
      if (refetchMatchesTimerRef.current) clearTimeout(refetchMatchesTimerRef.current);
      refetchMatchesTimerRef.current = setTimeout(() => {
        refetchMatchesTimerRef.current = null;
        void Promise.all([
          listMyMatches(userId, googleOAuthAccessToken ?? undefined),
          listOpenFeedMatches(userId, googleOAuthAccessToken ?? undefined),
        ]).then(([myRes, openRes]) => {
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

  const [unreadByMatchId, setUnreadByMatchId] = useState<Record<string, number>>({});

  const onOpenLiveScoring = useCallback(
    (m: DbMatchRow) => {
      setUnreadByMatchId((prev) => {
        if (!prev[m.id]) return prev;
        const next = { ...prev };
        delete next[m.id];
        return next;
      });
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
      const res = await updateMatchById(m.id, { status: 'declined' }, googleOAuthAccessToken ?? undefined);
      setDeclineBusyId(null);
      if (res.error) {
        showAppAlert('Could not decline', res.error);
        return;
      }
      setMyMatches((prev) =>
        prev.map((row) => (row.id === m.id ? { ...row, status: 'declined' as const } : row))
      );
    },
    [names, googleOAuthAccessToken]
  );

  const onCancelOpenPosted = useCallback(async (m: DbMatchRow) => {
    const ok = await confirmDestructive(
      'Cancel this open challenge?',
      'It will be removed from the feed for everyone. This cannot be undone.',
      'Cancel challenge'
    );
    if (!ok) return;
    setCancelOpenBusyId(m.id);
    const res = await deleteMatchById(m.id, googleOAuthAccessToken ?? undefined);
    setCancelOpenBusyId(null);
    if (!res.ok) {
      showAppAlert('Could not cancel', res.error ?? 'Unknown error');
      return;
    }
    setMyMatches((prev) => prev.filter((row) => row.id !== m.id));
    setOpenFeed((prev) => prev.filter((row) => row.id !== m.id));
  }, [googleOAuthAccessToken]);

  const onWithdrawPendingDirectChallenge = useCallback(async (m: DbMatchRow) => {
    const ok = await confirmDestructive(
      'Withdraw challenge?',
      'This removes the challenge before your opponent accepts. This cannot be undone.',
      'Withdraw'
    );
    if (!ok) return;
    setCancelOpenBusyId(m.id);
    const res = await deleteMatchById(m.id, googleOAuthAccessToken ?? undefined);
    setCancelOpenBusyId(null);
    if (!res.ok) {
      showAppAlert('Could not withdraw', res.error ?? 'Unknown error');
      return;
    }
    setMyMatches((prev) => prev.filter((row) => row.id !== m.id));
    setOpenFeed((prev) => prev.filter((row) => row.id !== m.id));
  }, [googleOAuthAccessToken]);

  const onUploadAwaitingPhoto = useCallback(async (m: DbMatchRow) => {
    if (!userId) return;
    setAwaitingPhotoBusyId(m.id);
    try {
      let perm = await ImagePicker.getMediaLibraryPermissionsAsync(false);
      if (!perm.granted) perm = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
      if (!perm.granted) {
        showAppAlert('Photos access needed', 'Allow photo library access to upload your sim settings screenshot.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync(settingsScreenshotPickerOptions());
      if (result.canceled || !result.assets[0]) return;
      const up = await uploadMatchSettingsScreenshot({
        matchId: m.id,
        userId,
        localUri: result.assets[0].uri,
        mimeType: result.assets[0].mimeType ?? undefined,
        accessToken: googleOAuthAccessToken ?? undefined,
      });
      if ('error' in up) {
        showAppAlert('Upload failed', up.error);
        return;
      }
      const upd = await updateMatchById(
        m.id,
        {
          player_1_settings_photo_url: up.signedUrl,
          challenge_status: 'active',
        },
        googleOAuthAccessToken ?? undefined
      );
      if (upd.error) {
        showAppAlert('Could not go live', upd.error);
        return;
      }
      setMyMatches((prev) =>
        prev.map((row) =>
          row.id === m.id
            ? { ...row, player_1_settings_photo_url: up.signedUrl, challenge_status: 'active' as const }
            : row
        )
      );
      setOpenFeed((prev) =>
        prev.map((row) =>
          row.id === m.id
            ? { ...row, player_1_settings_photo_url: up.signedUrl, challenge_status: 'active' as const }
            : row
        )
      );
      showAppAlert('Challenge is live', 'Your Future Open Challenge is now active in the feed.', {
        onOk: () => {
          void Promise.all([
            listMyMatches(userId, googleOAuthAccessToken ?? undefined),
            listOpenFeedMatches(userId, googleOAuthAccessToken ?? undefined),
          ]).then(async ([myRes, openRes]) => {
            if (myRes.error || openRes.error) return;
            const my = myRes.data ?? [];
            const open = openRes.data ?? [];
            myMatchesRef.current = my;
            setMyMatches(my);
            setOpenFeed(open);
            const { incomingDirect } = partitionHubData(my, userId);
            onIncomingDirectCount(incomingDirect.length);
            const nameRows = uniqById([...my, ...open]);
            const sessionTok = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
            const nameBearer = googleOAuthAccessToken ?? sessionTok ?? undefined;
            const nm = await fetchMatchPlayerDisplayNames(nameRows, nameBearer ?? undefined);
            setNames(nm);
          });
        },
      });
    } finally {
      setAwaitingPhotoBusyId(null);
    }
  }, [onIncomingDirectCount, userId, googleOAuthAccessToken]);

  const onDevRunFutureLifecycleNow = useCallback(async () => {
    if (!__DEV__) return;
    setFutureLifecycleBusy(true);
    const proc = await processFutureOpenChallenges(googleOAuthAccessToken ?? undefined);
    setFutureLifecycleBusy(false);
    if (!proc.ok) {
      showAppAlert('Future lifecycle check failed', proc.error ?? 'Unknown error');
      return;
    }
    if (proc.readyForUid) {
      showAppAlert(
        'Future open challenge ready',
        'Your Future Open Challenge is ready — upload your sim setup photo to go live.'
      );
    } else {
      showAppAlert(
        'Future lifecycle (dev)',
        `Activated: ${proc.activatedCount} · Expired: ${proc.expiredCount}`
      );
    }
  }, [googleOAuthAccessToken]);

  useEffect(() => {
    if (!supabaseOn || !userId || !supabase) return;
    const client = supabase;
    const channel = client
      .channel(`match-hub-chat:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'match_messages',
        },
        (payload) => {
          const row = payload.new as { match_id: string; user_id: string };
          if (!row.match_id || !row.user_id || row.user_id === userId) return;
          setUnreadByMatchId((prev) => ({
            ...prev,
            [row.match_id]: (prev[row.match_id] ?? 0) + 1,
          }));
        }
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [supabaseOn, userId]);

  const hubPartition = useMemo(() => {
    if (!supabaseOn || !userId) {
      return {
        incomingDirect: [] as DbMatchRow[],
        section1: [] as DbMatchRow[],
        completed: [] as DbMatchRow[],
      };
    }
    return partitionHubData(myMatches, userId);
  }, [supabaseOn, userId, myMatches]);

  const { section1, completed } = hubPartition;

  const openFeedForOthers = useMemo(() => {
    if (!supabaseOn || !userId) return [];
    return openFeed.filter((m) => m.player_1_id !== userId);
  }, [openFeed, userId, supabaseOn]);

  const openFeedCourseOptions = useMemo(() => {
    if (!supabaseOn || !userId) return [];
    return uniqueCourseNamesFromOpenFeed(openFeed);
  }, [openFeed, supabaseOn, userId]);

  const openFeedFilteredForOthers = useMemo(() => {
    if (!supabaseOn || !userId) return [];
    return filterAndSortOpenFeedRows(openFeedForOthers, openFeedFilters);
  }, [openFeedForOthers, openFeedFilters, supabaseOn, userId]);

  const openFeedFilteredAll = useMemo(() => {
    if (!supabaseOn || !userId) return [];
    return filterAndSortOpenFeedRows(openFeed, openFeedFilters);
  }, [openFeed, openFeedFilters, supabaseOn, userId]);

  const openFeedScheduled = useMemo(() => {
    if (!supabaseOn || !userId) return [];
    return openFeedFilteredAll.filter((m) => challengeLifecycle(m) === 'scheduled');
  }, [openFeedFilteredAll, supabaseOn, userId]);

  const openFeedActive = useMemo(() => {
    if (!supabaseOn || !userId) return [];
    return openFeedFilteredForOthers.filter((m) => challengeLifecycle(m) === 'active');
  }, [openFeedFilteredForOthers, supabaseOn, userId]);

  const openOpenFeedFilters = useCallback(() => {
    if (!supabaseOn || !userId) return;
    setDraftOpenFeedFilters({ ...openFeedFilters });
    setOpenFeedFiltersExpanded(true);
  }, [openFeedFilters, supabaseOn, userId]);

  const applyOpenFeedFiltersPanel = useCallback(() => {
    if (!supabaseOn || !userId) return;
    setOpenFeedFilters({ ...draftOpenFeedFilters });
    setOpenFeedFiltersExpanded(false);
  }, [draftOpenFeedFilters, supabaseOn, userId]);

  const resetOpenFeedFilters = useCallback(() => {
    if (!supabaseOn || !userId) return;
    setOpenFeedFilters(DEFAULT_OPEN_FEED_FILTERS);
    setDraftOpenFeedFilters(DEFAULT_OPEN_FEED_FILTERS);
    setOpenFeedFiltersExpanded(false);
  }, [supabaseOn, userId]);

  const onRemoveOpenFeedHandicapChip = useCallback(() => {
    if (!supabaseOn || !userId) return;
    setOpenFeedFilters((f) => ({ ...f, handicapRanges: [] }));
    setDraftOpenFeedFilters((f) => ({ ...f, handicapRanges: [] }));
  }, [supabaseOn, userId]);

  const onRemoveOpenFeedCourseChip = useCallback(() => {
    if (!supabaseOn || !userId) return;
    setOpenFeedFilters((f) => ({ ...f, courseName: null }));
    setDraftOpenFeedFilters((f) => ({ ...f, courseName: null }));
  }, [supabaseOn, userId]);

  const onClearOpenFeedPlatformsChip = useCallback(() => {
    if (!supabaseOn || !userId) return;
    setOpenFeedFilters((f) => ({ ...f, platforms: [] }));
    setDraftOpenFeedFilters((f) => ({ ...f, platforms: [] }));
  }, [supabaseOn, userId]);

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

  const nameFor = (id: string | null) => (id ? names[id] ?? 'Golfer' : '—');

  const renderCard = (
    m: DbMatchRow,
    uid: string,
    listKind: 'hub' | 'openFeed' | 'openFeedScheduled' | 'recentHistory' = 'hub'
  ) => {
    const p1 = nameFor(m.player_1_id);
    const p2 = nameFor(m.player_2_id);
    const peopleLine =
      m.is_open && m.status === 'open'
        ? listKind === 'openFeed' || listKind === 'openFeedScheduled'
          ? (() => {
              const idx = m.player_1_ghin_index_at_post;
              if (idx != null && Number.isFinite(Number(idx)))
                return `Posted by ${p1} · ${formatHandicapIndexDisplay(Number(idx))}`;
              return `Posted by ${p1}`;
            })()
          : `Posted by ${p1}`
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
    const isMyDirectAwaitingOpponent =
      listKind === 'hub' &&
      !m.is_open &&
      m.status === 'pending' &&
      m.player_1_id === uid &&
      m.player_2_id != null;
    const showChallengerTrash = isMyOpenPostedCancelable || isMyDirectAwaitingOpponent;
    const isMyAwaitingPhoto =
      isMyOpenPostedCancelable &&
      challengeLifecycle(m) === 'awaiting_photo' &&
      (!m.player_1_settings_photo_url || m.player_1_settings_photo_url.trim() === '');
    const declineBusy = declineBusyId === m.id;
    const isLiveScoring =
      (m.status === 'active' || m.status === 'waiting') &&
      m.player_2_id != null &&
      (m.player_1_id === uid || m.player_2_id === uid);

    const hubBadge = listKind === 'hub' ? incomingActiveBadge(m, uid) : null;
    const openFeedPlatform =
      listKind === 'openFeed' || listKind === 'openFeedScheduled'
        ? m.player_1_platform?.trim()
          ? m.player_1_platform.trim()
          : null
        : null;
    const metaLine = (() => {
      if (listKind === 'hub') return `${formatHoles(m)} · Stroke play`;
      const status = statusLabel(m, uid);
      const holes = formatHoles(m);
      if (listKind === 'openFeed' || listKind === 'openFeedScheduled') {
        const cs = challengeLifecycle(m);
        if (cs === 'scheduled') {
          const when = formatScheduledWhenAndCountdown(m.scheduled_for);
          return openFeedPlatform
            ? `${when.whenLabel} · ${when.countdownLabel} · ${holes} · ${openFeedPlatform}`
            : `${when.whenLabel} · ${when.countdownLabel} · ${holes}`;
        }
        return openFeedPlatform ? `${status} · ${holes} · ${openFeedPlatform}` : `${status} · ${holes}`;
      }
      return `${status} · ${holes} · Stroke play`;
    })();

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
        {m.verification_required &&
        (m.status === 'active' || m.status === 'waiting') &&
        m.player_2_id != null ? (
          <View style={[styles.cardStatusBadge, styles.cardStatusBadgeVerification]}>
            <Text style={styles.cardStatusBadgeTxtVerification}>Verification required</Text>
          </View>
        ) : null}
        <Text style={styles.cardTitle} numberOfLines={1}>
          {m.course_name}
        </Text>
        <Text style={styles.cardMeta}>{metaLine}</Text>
        <Text style={styles.cardPeople} numberOfLines={2}>
          {peopleLine}
        </Text>
        {isLiveScoring && unreadByMatchId[m.id] ? (
          <View style={styles.chatBadge}>
            <View style={styles.chatBadgeDot} />
            <Text style={styles.chatBadgeTxt}>
              {unreadByMatchId[m.id] > 9 ? '9+' : unreadByMatchId[m.id]}
            </Text>
          </View>
        ) : null}
      </>
    );

    if (listKind === 'openFeed') {
      const idx = m.player_1_ghin_index_at_post;
      const idxOk = idx != null && Number.isFinite(Number(idx));
      const idxA11y = idxOk ? `, index ${formatHandicapIndexDisplay(Number(idx))}` : '';
      const platA11y = openFeedPlatform ? `, ${openFeedPlatform}` : '';
      const openA11y = `Open challenge on ${m.course_name}${platA11y}${idxA11y}`;
      return (
        <Pressable
          key={m.id}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push(`/(tabs)/match-open-accept/${m.id}` as never)}
          accessibilityRole="button"
          accessibilityLabel={openA11y}
        >
          {cardInner}
          <Text style={styles.cardTapHint}>Tap for details</Text>
        </Pressable>
      );
    }
    if (listKind === 'openFeedScheduled') {
      const canDeleteScheduled = m.player_1_id === uid && challengeLifecycle(m) === 'scheduled';
      return (
        <View key={m.id} style={styles.card}>
          {canDeleteScheduled ? (
            <View style={styles.cardTopRow}>
              <View style={styles.cardBodyFlex}>{cardInner}</View>
              <Pressable
                onPress={() => void onCancelOpenPosted(m)}
                disabled={cancelOpenBusyId === m.id}
                style={({ pressed }) => [styles.groupDeleteBtn, pressed && styles.groupDeleteBtnPressed]}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Delete scheduled challenge"
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
        </View>
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
        {showChallengerTrash ? (
          <View style={styles.cardTopRow}>
            <View style={styles.cardBodyFlex}>{cardInner}</View>
            <Pressable
              onPress={() =>
                void (isMyOpenPostedCancelable ? onCancelOpenPosted(m) : onWithdrawPendingDirectChallenge(m))
              }
              disabled={cancelOpenBusyId === m.id}
              style={({ pressed }) => [styles.groupDeleteBtn, pressed && styles.groupDeleteBtnPressed]}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={
                isMyOpenPostedCancelable ? 'Cancel open challenge' : 'Withdraw direct challenge'
              }
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
        {isMyAwaitingPhoto ? (
          <View style={styles.cardActions}>
            <Pressable
              style={({ pressed }) => [styles.acceptBtn, pressed && styles.cardActionPressed]}
              onPress={() => void onUploadAwaitingPhoto(m)}
              disabled={awaitingPhotoBusyId === m.id}
              accessibilityRole="button"
              accessibilityLabel="Upload settings photo to activate challenge"
            >
              {awaitingPhotoBusyId === m.id ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.acceptBtnTxt}>Upload photo to go live</Text>
              )}
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

      <Text style={[styles.sectionTitle, styles.sectionSpaced]} accessibilityRole="header">
        Open challenge feed
      </Text>
      <Text style={styles.sectionSub}>Anyone on SimCap can accept these.</Text>
      {__DEV__ ? (
        <Pressable
          onPress={() => void onDevRunFutureLifecycleNow()}
          disabled={futureLifecycleBusy}
          style={({ pressed }) => [styles.devFutureBtn, pressed && styles.devFutureBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Run future open lifecycle check now, development only"
        >
          {futureLifecycleBusy ? (
            <ActivityIndicator size="small" color="#9a5a00" />
          ) : (
            <Text style={styles.devFutureBtnTxt}>DEV ONLY · Run future lifecycle now</Text>
          )}
        </Pressable>
      ) : null}
      <OpenFeedFilterPanel
        gutter={gutter}
        coursesInFeed={openFeedCourseOptions}
        applied={openFeedFilters}
        draft={draftOpenFeedFilters}
        expanded={openFeedFiltersExpanded}
        onOpen={openOpenFeedFilters}
        onDraftChange={setDraftOpenFeedFilters}
        onApply={applyOpenFeedFiltersPanel}
        onResetAll={resetOpenFeedFilters}
        onRemoveHandicapChip={onRemoveOpenFeedHandicapChip}
        onRemoveCourseChip={onRemoveOpenFeedCourseChip}
        onClearPlatformsChip={onClearOpenFeedPlatformsChip}
      />
      {openFeedActive.length === 0 && openFeedScheduled.length === 0 ? (
        <Text style={styles.empty}>No open challenges match these filters. Clear filters or adjust your choices.</Text>
      ) : (
        <>
          <Text style={styles.feedSplitTitle}>Open now</Text>
          {openFeedActive.length === 0 ? (
            <Text style={styles.empty}>No active open challenges right now.</Text>
          ) : (
            openFeedActive.map((m) => renderCard(m, userId, 'openFeed'))
          )}
          <Text style={[styles.feedSplitTitle, styles.feedSplitTitleSpaced]}>Scheduled challenges</Text>
          <Text style={styles.feedSplitSub}>Coming soon — not yet open for acceptance</Text>
          {openFeedScheduled.length === 0 ? (
            <Text style={styles.empty}>No scheduled open challenges right now.</Text>
          ) : (
            openFeedScheduled.map((m) => renderCard(m, userId, 'openFeedScheduled'))
          )}
        </>
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
  devFutureBtn: {
    alignSelf: 'flex-start',
    marginBottom: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#dd9a3f',
    backgroundColor: '#fff5e7',
  },
  devFutureBtnPressed: { opacity: 0.85 },
  devFutureBtnTxt: { fontSize: 11, fontWeight: '700', color: '#9a5a00' },
  feedSplitTitle: { fontSize: 12, fontWeight: '700', color: colors.ink, marginBottom: 6, marginTop: 2 },
  feedSplitTitleSpaced: { marginTop: 10 },
  feedSplitSub: { fontSize: 11, color: colors.muted, marginTop: -2, marginBottom: 8, lineHeight: 16 },
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
  cardStatusBadgeVerification: {
    backgroundColor: colors.forestDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
  },
  cardStatusBadgeTxtVerification: { fontSize: 11, fontWeight: '700', color: colors.sage },
  cardTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  cardMeta: { fontSize: 11, color: colors.muted, marginTop: 4, lineHeight: 16 },
  cardPeople: { fontSize: 11, color: colors.subtle, marginTop: 6, lineHeight: 15 },
  chatBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  chatBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.sage,
    marginRight: 4,
  },
  chatBadgeTxt: {
    fontSize: 11,
    color: colors.forestMid,
    fontWeight: '600',
  },
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
