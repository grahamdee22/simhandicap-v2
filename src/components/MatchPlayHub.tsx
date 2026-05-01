import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { confirmDestructive, showAppAlert } from '../lib/alertCompat';
import { colors } from '../lib/constants';
import {
  listMyMatches,
  listOpenFeedMatches,
  updateMatchById,
  type DbMatchRow,
} from '../lib/matchPlay';
import { supabase } from '../lib/supabase';
import { IconPlus } from './SvgUiIcons';

type Props = {
  gutter: number;
  userId: string | undefined;
  supabaseOn: boolean;
  /** Incoming direct challenges only (for tab badge). */
  onIncomingDirectCount: (n: number) => void;
};

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

async function loadDisplayNames(rows: DbMatchRow[]): Promise<Record<string, string>> {
  if (!supabase) return {};
  const ids = new Set<string>();
  for (const m of rows) {
    ids.add(m.player_1_id);
    if (m.player_2_id) ids.add(m.player_2_id);
  }
  if (ids.size === 0) return {};
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', [...ids]);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const row of data as { id: string; display_name: string }[]) {
    map[row.id] = row.display_name?.trim() || 'Golfer';
  }
  return map;
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

  const activeOrWaiting = my.filter((m) => m.status === 'active' || m.status === 'waiting');

  const section1 = uniqById([...incomingDirect, ...outgoingPending, ...activeOrWaiting]);

  const completed = my
    .filter((m) => m.status === 'complete' || m.status === 'abandoned')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 20);

  return { incomingDirect, section1, completed };
}

export function MatchPlayHub({ gutter, userId, supabaseOn, onIncomingDirectCount }: Props) {
  const router = useRouter();
  const [myMatches, setMyMatches] = useState<DbMatchRow[]>([]);
  const [openFeed, setOpenFeed] = useState<DbMatchRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [declineBusyId, setDeclineBusyId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!supabaseOn || !userId) {
        setMyMatches([]);
        setOpenFeed([]);
        setFetchError(false);
        setLoading(false);
        onIncomingDirectCount(0);
        return;
      }

      let cancelled = false;
      setLoading(true);
      setFetchError(false);

      void (async () => {
        const [myRes, openRes] = await Promise.all([listMyMatches(), listOpenFeedMatches()]);
        if (cancelled) return;

        if (myRes.error || openRes.error) {
          setFetchError(true);
          setMyMatches([]);
          setOpenFeed([]);
          onIncomingDirectCount(0);
          setLoading(false);
          return;
        }

        const my = myRes.data ?? [];
        const open = openRes.data ?? [];
        setMyMatches(my);
        setOpenFeed(open);

        const { incomingDirect } = partitionHubData(my, userId);
        onIncomingDirectCount(incomingDirect.length);

        const nameRows = uniqById([...my, ...open]);
        const nm = await loadDisplayNames(nameRows);
        if (!cancelled) setNames(nm);
        setLoading(false);
      })();

      return () => {
        cancelled = true;
      };
    }, [supabaseOn, userId, onIncomingDirectCount])
  );

  const onCreateMatch = useCallback(() => {
    // Path matches `app/(tabs)/match-create.tsx`; assert until typed routes refresh.
    router.push('/(tabs)/match-create' as never);
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

  if (!supabaseOn || !userId) {
    return (
      <View style={[styles.wrap, { marginHorizontal: gutter }]}>
        <Text style={styles.sectionEyebrow}>Match Play</Text>
        <Text style={styles.offlineHint}>Sign in with Supabase configured to see matches.</Text>
      </View>
    );
  }

  const { section1, completed } = partitionHubData(myMatches, userId);

  const nameFor = (id: string | null) => (id ? names[id] ?? 'Golfer' : '—');

  const renderCard = (m: DbMatchRow, uid: string) => {
    const p1 = nameFor(m.player_1_id);
    const p2 = nameFor(m.player_2_id);
    const peopleLine =
      m.is_open && m.status === 'open'
        ? `Posted by ${p1}`
        : m.player_2_id
          ? `${p1} vs ${p2}`
          : `Challenger ${p1}`;
    const incomingDirect = !m.is_open && m.status === 'pending' && m.player_2_id === uid;
    const declineBusy = declineBusyId === m.id;
    const isLiveScoring =
      (m.status === 'active' || m.status === 'waiting') &&
      m.player_2_id != null &&
      (m.player_1_id === uid || m.player_2_id === uid);

    const cardInner = (
      <>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {m.course_name}
        </Text>
        <Text style={styles.cardMeta}>
          {statusLabel(m, uid)} · {formatHoles(m)} · Stroke play
        </Text>
        <Text style={styles.cardPeople} numberOfLines={2}>
          {peopleLine}
        </Text>
      </>
    );

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
        {cardInner}
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
      <Text style={styles.sectionEyebrow}>Match Play</Text>

      <Pressable
        onPress={onCreateMatch}
        style={({ pressed }) => [styles.createBtn, pressed && styles.createBtnPressed]}
        accessibilityRole="button"
        accessibilityLabel="Create match"
      >
        <IconPlus size={18} color="#fff" />
        <Text style={styles.createBtnTxt}>+ Create Match</Text>
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
      {openFeed.length === 0 ? (
        <Text style={styles.empty}>No open challenges right now.</Text>
      ) : (
        openFeed.map((m) => renderCard(m, userId))
      )}

      <Text style={[styles.sectionTitle, styles.sectionSpaced]}>Recent matches</Text>
      <Text style={styles.sectionSub}>Finished or abandoned stroke-play matches.</Text>
      {completed.length === 0 ? (
        <Text style={styles.empty}>No completed matches yet.</Text>
      ) : (
        completed.map((m) => renderCard(m, userId))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4, marginBottom: 8 },
  sectionEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.sage,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 4 },
  sectionSub: { fontSize: 11, color: colors.muted, marginTop: 3, marginBottom: 8, lineHeight: 16 },
  sectionSpaced: { marginTop: 18 },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
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
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  cardTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  cardMeta: { fontSize: 11, color: colors.muted, marginTop: 4, lineHeight: 16 },
  cardPeople: { fontSize: 11, color: colors.subtle, marginTop: 6, lineHeight: 15 },
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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
