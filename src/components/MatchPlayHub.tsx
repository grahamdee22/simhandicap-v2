import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n, { useTranslation } from '../i18n';
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
  if (m.holes === 18) return i18n.t('matchPlay.holes18');
  if (m.nine_selection === 'front') return i18n.t('matchPlay.front9');
  if (m.nine_selection === 'back') return i18n.t('matchPlay.back9');
  return i18n.t('matchPlay.holesCount', { count: m.holes });
}

function challengeLifecycle(m: DbMatchRow): 'scheduled' | 'awaiting_photo' | 'active' | 'expired' {
  const s = m.challenge_status;
  if (s === 'scheduled' || s === 'awaiting_photo' || s === 'active' || s === 'expired') return s;
  return 'active';
}

function formatScheduledWhenAndCountdown(
  v: string | null | undefined
): { whenLabel: string; countdownLabel: string } {
  if (!v) {
    return {
      whenLabel: i18n.t('matchPlay.scheduled.fallback'),
      countdownLabel: i18n.t('matchPlay.scheduled.soon'),
    };
  }
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) {
    return {
      whenLabel: i18n.t('matchPlay.scheduled.fallback'),
      countdownLabel: i18n.t('matchPlay.scheduled.soon'),
    };
  }
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
    ? i18n.t('matchPlay.scheduled.todayAt', { time })
    : sameTomorrow
      ? i18n.t('matchPlay.scheduled.tomorrowAt', { time })
      : diffDays <= 7
        ? i18n.t('matchPlay.scheduled.inDaysAt', { days: diffDays + 1, time })
        : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const countdownLabel =
    diffDays >= 2
      ? i18n.t('matchPlay.scheduled.countdownDays', { count: diffDays })
      : diffHours >= 1
        ? i18n.t('matchPlay.scheduled.countdownHours', { count: diffHours })
        : i18n.t('matchPlay.scheduled.soon');
  return { whenLabel, countdownLabel };
}

function statusLabel(m: DbMatchRow, uid: string): string {
  if (m.status === 'pending' && !m.is_open && m.player_2_id === uid) {
    return i18n.t('matchPlay.status.needsYourResponse');
  }
  if (m.status === 'pending' && !m.is_open && m.player_1_id === uid) {
    return i18n.t('matchPlay.status.awaitingOpponent');
  }
  if (m.status === 'open' && m.is_open) {
    const cs = challengeLifecycle(m);
    if (cs === 'scheduled') return i18n.t('matchPlay.status.scheduled');
    if (cs === 'awaiting_photo') return i18n.t('matchPlay.status.awaitingPhoto');
    if (cs === 'expired') return i18n.t('matchPlay.status.expired');
    return i18n.t('matchPlay.status.openChallenge');
  }
  if (m.status === 'active') return i18n.t('matchPlay.status.inProgress');
  if (m.status === 'waiting') return i18n.t('matchPlay.status.waitingOnOpponent');
  if (m.status === 'complete') return i18n.t('matchPlay.status.complete');
  if (m.status === 'abandoned') return i18n.t('matchPlay.status.abandoned');
  if (m.status === 'declined') return i18n.t('matchPlay.status.declined');
  return m.status;
}

/** Status chip for Incoming & active cards only (not open-feed / history). */
function incomingActiveBadge(
  m: DbMatchRow,
  uid: string
): { text: string; tone: 'incoming' | 'muted' | 'yours' } | null {
  if (!m.is_open && m.status === 'pending' && m.player_2_id === uid) {
    return { text: i18n.t('matchPlay.status.awaitingYourResponse'), tone: 'incoming' };
  }
  if (!m.is_open && m.status === 'pending' && m.player_1_id === uid && m.player_2_id != null) {
    return { text: i18n.t('matchPlay.status.awaitingOpponent'), tone: 'muted' };
  }
  if (m.status === 'active' || m.status === 'waiting') {
    return { text: i18n.t('matchPlay.status.inProgressBadge'), tone: 'muted' };
  }
  if (m.is_open && m.status === 'open' && m.player_1_id === uid) {
    return { text: i18n.t('matchPlay.status.yourOpenChallenge'), tone: 'yours' };
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
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [myMatches, setMyMatches] = useState<DbMatchRow[]>([]);
  const [openFeed, setOpenFeed] = useState<DbMatchRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [awaitingOpponentInfoOpen, setAwaitingOpponentInfoOpen] = useState(false);
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
          t('matchPlay.alerts.futureReadyTitle'),
          t('matchPlay.alerts.futureReadyBody'),
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
  }, [isFocused, supabaseOn, userId, onIncomingDirectCount, onOutgoingAcceptedUnseenCount, googleOAuthAccessToken, t]);

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
      const challenger = m.player_1_id
        ? names[m.player_1_id] ?? t('matchPlay.challengerFallback')
        : t('matchPlay.challengerFallback');
      const ok = await confirmDestructive(
        t('matchPlay.alerts.declineTitle'),
        t('matchPlay.alerts.declineBody', { course: m.course_name, challenger }),
        t('matchPlay.alerts.declineAction')
      );
      if (!ok) return;
      setDeclineBusyId(m.id);
      const res = await updateMatchById(m.id, { status: 'declined' }, googleOAuthAccessToken ?? undefined);
      setDeclineBusyId(null);
      if (res.error) {
        showAppAlert(t('matchPlay.alerts.couldNotDecline'), res.error);
        return;
      }
      setMyMatches((prev) =>
        prev.map((row) => (row.id === m.id ? { ...row, status: 'declined' as const } : row))
      );
    },
    [names, googleOAuthAccessToken, t]
  );

  const onCancelOpenPosted = useCallback(async (m: DbMatchRow) => {
    const ok = await confirmDestructive(
      t('matchPlay.alerts.cancelOpenTitle'),
      t('matchPlay.alerts.cancelOpenBody'),
      t('matchPlay.alerts.cancelOpenAction')
    );
    if (!ok) return;
    setCancelOpenBusyId(m.id);
    const res = await deleteMatchById(m.id, googleOAuthAccessToken ?? undefined);
    setCancelOpenBusyId(null);
    if (!res.ok) {
      showAppAlert(
        t('matchPlay.alerts.couldNotCancel'),
        res.error ?? t('matchPlay.alerts.unknownError')
      );
      return;
    }
    setMyMatches((prev) => prev.filter((row) => row.id !== m.id));
    setOpenFeed((prev) => prev.filter((row) => row.id !== m.id));
  }, [googleOAuthAccessToken, t]);

  const onWithdrawPendingDirectChallenge = useCallback(async (m: DbMatchRow) => {
    const ok = await confirmDestructive(
      t('matchPlay.alerts.withdrawTitle'),
      t('matchPlay.alerts.withdrawBody'),
      t('matchPlay.alerts.withdrawAction')
    );
    if (!ok) return;
    setCancelOpenBusyId(m.id);
    const res = await deleteMatchById(m.id, googleOAuthAccessToken ?? undefined);
    setCancelOpenBusyId(null);
    if (!res.ok) {
      showAppAlert(
        t('matchPlay.alerts.couldNotWithdraw'),
        res.error ?? t('matchPlay.alerts.unknownError')
      );
      return;
    }
    setMyMatches((prev) => prev.filter((row) => row.id !== m.id));
    setOpenFeed((prev) => prev.filter((row) => row.id !== m.id));
  }, [googleOAuthAccessToken, t]);

  const onUploadAwaitingPhoto = useCallback(async (m: DbMatchRow) => {
    if (!userId) return;
    setAwaitingPhotoBusyId(m.id);
    try {
      let perm = await ImagePicker.getMediaLibraryPermissionsAsync(false);
      if (!perm.granted) perm = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
      if (!perm.granted) {
        showAppAlert(
          t('matchPlay.alerts.photosNeededTitle'),
          t('matchPlay.alerts.photosNeededBody')
        );
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
        showAppAlert(t('matchPlay.alerts.uploadFailed'), up.error);
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
        showAppAlert(t('matchPlay.alerts.couldNotGoLive'), upd.error);
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
      showAppAlert(
        t('matchPlay.alerts.challengeLiveTitle'),
        t('matchPlay.alerts.challengeLiveBody'),
        {
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
              const sessionTok = supabase
                ? (await supabase.auth.getSession()).data.session?.access_token
                : undefined;
              const nameBearer = googleOAuthAccessToken ?? sessionTok ?? undefined;
              const nm = await fetchMatchPlayerDisplayNames(nameRows, nameBearer ?? undefined);
              setNames(nm);
            });
          },
        }
      );
    } finally {
      setAwaitingPhotoBusyId(null);
    }
  }, [onIncomingDirectCount, userId, googleOAuthAccessToken, t]);

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
            {t('matchPlay.title')}
          </Text>
          {onMatchPlayInfoPress ? (
            <Pressable
              style={styles.infoBtn}
              onPress={onMatchPlayInfoPress}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('matchPlay.aboutA11y')}
            >
              <Text style={styles.infoBtnTxt}>ⓘ</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.offlineHint}>{t('matchPlay.offlineHint')}</Text>
      </View>
    );
  }

  const nameFor = (id: string | null) =>
    id ? names[id] ?? t('matchPlay.golferFallback') : t('matchPlay.emDash');
  const awaitingOpponentLabel = t('matchPlay.status.awaitingOpponent');

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
                return t('matchPlay.postedByWithIndex', {
                  name: p1,
                  index: formatHandicapIndexDisplay(Number(idx)),
                });
              return t('matchPlay.postedBy', { name: p1 });
            })()
          : t('matchPlay.postedBy', { name: p1 })
        : m.player_2_id
          ? t('matchPlay.vs', { p1, p2 })
          : t('matchPlay.challengerName', { name: p1 });
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
    const status = listKind === 'hub' ? null : statusLabel(m, uid);
    const awaitingOpponentStatus = status === awaitingOpponentLabel;
    const strokePlay = t('matchPlay.strokePlay');
    const metaLine = (() => {
      if (listKind === 'hub') {
        return t('matchPlay.metaHub', { holes: formatHoles(m), strokePlay });
      }
      const holes = formatHoles(m);
      if (listKind === 'openFeed' || listKind === 'openFeedScheduled') {
        const cs = challengeLifecycle(m);
        if (cs === 'scheduled') {
          const when = formatScheduledWhenAndCountdown(m.scheduled_for);
          return openFeedPlatform
            ? t('matchPlay.metaOpenScheduledWithPlatform', {
                when: when.whenLabel,
                countdown: when.countdownLabel,
                holes,
                platform: openFeedPlatform,
              })
            : t('matchPlay.metaOpenScheduled', {
                when: when.whenLabel,
                countdown: when.countdownLabel,
                holes,
              });
        }
        if (awaitingOpponentStatus) {
          return openFeedPlatform
            ? t('matchPlay.metaOpenAwaitingWithPlatform', { holes, platform: openFeedPlatform })
            : t('matchPlay.metaOpenAwaiting', { holes });
        }
        return openFeedPlatform
          ? t('matchPlay.metaOpenWithPlatform', { status, holes, platform: openFeedPlatform })
          : t('matchPlay.metaOpen', { status, holes });
      }
      if (awaitingOpponentStatus) {
        return t('matchPlay.metaHistoryAwaiting', { holes, strokePlay });
      }
      return t('matchPlay.metaHistory', { status, holes, strokePlay });
    })();

    const cardInner = (
      <>
        {hubBadge ? (
          hubBadge.text === awaitingOpponentLabel ? (
            <Pressable
              style={[styles.cardStatusBadge, styles.cardStatusBadgeMuted, styles.awaitingOpponentBadge]}
              onPress={() => setAwaitingOpponentInfoOpen(true)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('matchPlay.aboutAwaitingOpponentA11y')}
            >
              <Text style={styles.cardStatusBadgeTxtMuted}>{hubBadge.text}</Text>
              <Text style={styles.infoBtnTxt}>ⓘ</Text>
            </Pressable>
          ) : (
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
          )
        ) : null}
        {m.verification_required &&
        (m.status === 'active' || m.status === 'waiting') &&
        m.player_2_id != null ? (
          <View style={[styles.cardStatusBadge, styles.cardStatusBadgeVerification]}>
            <Text style={styles.cardStatusBadgeTxtVerification}>
              {t('matchPlay.verificationRequired')}
            </Text>
          </View>
        ) : null}
        <Text style={styles.cardTitle} numberOfLines={1}>
          {m.course_name}
        </Text>
        {awaitingOpponentStatus ? (
          <View style={styles.awaitingOpponentMetaRow}>
            <Pressable
              style={styles.awaitingOpponentMetaPress}
              onPress={() => setAwaitingOpponentInfoOpen(true)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('matchPlay.aboutAwaitingOpponentA11y')}
            >
              <Text style={styles.cardMeta}>{awaitingOpponentLabel}</Text>
              <Text style={styles.infoBtnTxt}>ⓘ</Text>
            </Pressable>
            <Text style={styles.cardMeta}>{metaLine}</Text>
          </View>
        ) : (
          <Text style={styles.cardMeta}>{metaLine}</Text>
        )}
        <Text style={styles.cardPeople} numberOfLines={2}>
          {peopleLine}
        </Text>
        {isLiveScoring && unreadByMatchId[m.id] ? (
          <View style={styles.chatBadge}>
            <View style={styles.chatBadgeDot} />
            <Text style={styles.chatBadgeTxt}>
              {unreadByMatchId[m.id] > 9 ? t('matchPlay.unreadCap') : unreadByMatchId[m.id]}
            </Text>
          </View>
        ) : null}
      </>
    );

    if (listKind === 'openFeed') {
      const idx = m.player_1_ghin_index_at_post;
      const idxOk = idx != null && Number.isFinite(Number(idx));
      const idxA11y = idxOk
        ? t('matchPlay.a11y.indexPart', { index: formatHandicapIndexDisplay(Number(idx)) })
        : '';
      const platA11y = openFeedPlatform
        ? t('matchPlay.a11y.platformPart', { platform: openFeedPlatform })
        : '';
      const openA11y = t('matchPlay.a11y.openChallenge', {
        course: m.course_name,
        platform: platA11y,
        index: idxA11y,
      });
      return (
        <Pressable
          key={m.id}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push(`/(tabs)/match-open-accept/${m.id}` as never)}
          accessibilityRole="button"
          accessibilityLabel={openA11y}
        >
          {cardInner}
          <Text style={styles.cardTapHint}>{t('matchPlay.tapForDetails')}</Text>
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
                accessibilityLabel={t('matchPlay.a11y.deleteScheduled')}
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
          accessibilityLabel={t('matchPlay.a11y.results', { course: m.course_name })}
        >
          {cardInner}
          <Text style={styles.cardTapHint}>{t('matchPlay.tapForResults')}</Text>
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
          accessibilityLabel={t('matchPlay.a11y.liveScoring', { course: m.course_name })}
        >
          {cardInner}
          <Text style={styles.cardTapHint}>{t('matchPlay.tapToEnterScores')}</Text>
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
                isMyOpenPostedCancelable
                  ? t('matchPlay.a11y.cancelOpen')
                  : t('matchPlay.a11y.withdrawDirect')
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
              accessibilityLabel={t('matchPlay.a11y.decline')}
            >
              {declineBusy ? (
                <ActivityIndicator color={colors.header} />
              ) : (
                <Text style={styles.declineOutlineTxt}>{t('matchPlay.decline')}</Text>
              )}
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.acceptBtn, pressed && styles.cardActionPressed]}
              onPress={() => onAcceptDirect(m)}
              disabled={declineBusy}
              accessibilityRole="button"
              accessibilityLabel={t('matchPlay.a11y.accept')}
            >
              <Text style={styles.acceptBtnTxt}>{t('matchPlay.accept')}</Text>
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
              accessibilityLabel={t('matchPlay.a11y.uploadPhoto')}
            >
              {awaitingPhotoBusyId === m.id ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.acceptBtnTxt}>{t('matchPlay.uploadPhotoToGoLive')}</Text>
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
          {t('matchPlay.title')}
        </Text>
        {onMatchPlayInfoPress ? (
          <Pressable
            style={styles.infoBtn}
            onPress={onMatchPlayInfoPress}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('matchPlay.aboutA11y')}
          >
            <Text style={styles.infoBtnTxt}>ⓘ</Text>
          </Pressable>
        ) : null}
      </View>

      <Pressable
        onPress={onCreateMatch}
        style={({ pressed }) => [styles.createBtn, pressed && styles.createBtnPressed]}
        accessibilityRole="button"
        accessibilityLabel={t('matchPlay.createMatchA11y')}
      >
        <Text style={styles.createBtnTxt}>{t('matchPlay.createMatch')}</Text>
      </Pressable>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator color={colors.header} />
        </View>
      ) : null}

      {fetchError ? (
        <Text style={styles.errorTxt}>{t('matchPlay.loadError')}</Text>
      ) : null}

      <Text style={styles.sectionTitle}>{t('matchPlay.incomingActive')}</Text>
      <Text style={styles.sectionSub}>{t('matchPlay.incomingActiveSub')}</Text>
      {section1.length === 0 ? (
        <Text style={styles.empty}>{t('matchPlay.incomingActiveEmpty')}</Text>
      ) : (
        section1.map((m) => renderCard(m, userId))
      )}

      <Text style={[styles.sectionTitle, styles.sectionSpaced]} accessibilityRole="header">
        {t('matchPlay.openFeed')}
      </Text>
      <Text style={styles.sectionSub}>{t('matchPlay.openFeedSub')}</Text>
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
        <Text style={styles.empty}>{t('matchPlay.openFeedEmpty')}</Text>
      ) : (
        <>
          <Text style={styles.feedSplitTitle}>{t('matchPlay.openNow')}</Text>
          {openFeedActive.length === 0 ? (
            <Text style={styles.empty}>{t('matchPlay.openNowEmpty')}</Text>
          ) : (
            openFeedActive.map((m) => renderCard(m, userId, 'openFeed'))
          )}
          <Text style={[styles.feedSplitTitle, styles.feedSplitTitleSpaced]}>
            {t('matchPlay.scheduledChallenges')}
          </Text>
          <Text style={styles.feedSplitSub}>{t('matchPlay.scheduledChallengesSub')}</Text>
          {openFeedScheduled.length === 0 ? (
            <Text style={styles.empty}>{t('matchPlay.scheduledEmpty')}</Text>
          ) : (
            openFeedScheduled.map((m) => renderCard(m, userId, 'openFeedScheduled'))
          )}
        </>
      )}

      <Text style={[styles.sectionTitle, styles.sectionSpaced]}>{t('matchPlay.recentMatches')}</Text>
      <Text style={styles.sectionSub}>{t('matchPlay.recentMatchesSub')}</Text>
      {completed.length === 0 ? (
        <Text style={styles.empty}>{t('matchPlay.recentEmpty')}</Text>
      ) : (
        completed.map((m) => renderCard(m, userId, 'recentHistory'))
      )}

      <Modal
        visible={awaitingOpponentInfoOpen}
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        transparent
        onRequestClose={() => setAwaitingOpponentInfoOpen(false)}
      >
        <View style={styles.infoExplainRoot}>
          <Pressable
            style={styles.infoExplainBackdrop}
            onPress={() => setAwaitingOpponentInfoOpen(false)}
          />
          <View style={[styles.infoExplainSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.infoExplainTitle}>{t('matchPlay.awaitingOpponentExplainTitle')}</Text>
            <Text style={styles.infoExplainBody}>{t('matchPlay.awaitingOpponentExplainBody')}</Text>
          </View>
        </View>
      </Modal>
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
  awaitingOpponentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  awaitingOpponentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  awaitingOpponentMetaPress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  infoExplainRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  infoExplainBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  infoExplainSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  infoExplainTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: colors.ink },
  infoExplainBody: { fontSize: 14, lineHeight: 21, color: colors.ink },
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
