import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/constants';
import {
  fetchLeaguesForGroup,
  syncLeagueStatuses,
  type DbLeagueRow,
} from '../lib/leagues';
import {
  computeLeagueStandings,
  formatLeagueFormatLabel,
  isLeagueActive,
  leagueDaysRemaining,
} from '../lib/leagueStandings';
import { fetchLeagueBundle } from '../lib/leagues';
import {
  socialPageSectionTitleStyles,
  socialSectionHeaderStyles,
} from '../lib/socialPageSectionTitle';
import { isSocialGroupCreator } from '../lib/socialGroupCreator';
import {
  isSocialGroupCreatorViaRpc,
  patchGroupCreatorInStore,
  resolveSocialGroupsAccessToken,
} from '../lib/socialGroups';
import {
  getTournamentSectionCache,
  setTournamentSectionCache,
} from '../lib/tournamentSectionCache';
import type { FriendGroup } from '../store/useAppStore';

/** Stripped from production builds via `__DEV__` (same pattern as MatchPlayHub dev tools). */
const ALLOW_DEV_CREATOR_VIEW = __DEV__;

type CreatorCheck = 'pending' | 'creator' | 'member';

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
  const router = useRouter();
  const initialCache = getTournamentSectionCache(group.id);
  const storeCreatorId = group.createdByUserId?.trim() || null;
  const [creatorCheck, setCreatorCheck] = useState<CreatorCheck>(() =>
    storeCreatorId
      ? isSocialGroupCreator(group, authUserId)
        ? 'creator'
        : 'member'
      : 'pending'
  );

  useEffect(() => {
    let cancelled = false;

    if (storeCreatorId) {
      setCreatorCheck(isSocialGroupCreator(group, authUserId) ? 'creator' : 'member');
      return;
    }

    if (!authUserId) {
      setCreatorCheck('pending');
      return;
    }

    setCreatorCheck('pending');
    void (async () => {
      const accessToken = (await resolveSocialGroupsAccessToken()) ?? undefined;
      const { isCreator } = await isSocialGroupCreatorViaRpc(group.id, accessToken);
      if (cancelled) return;
      if (isCreator) {
        patchGroupCreatorInStore(group.id, authUserId);
      }
      setCreatorCheck(isCreator ? 'creator' : 'member');
    })();

    return () => {
      cancelled = true;
    };
  }, [group.id, group.createdByUserId, authUserId, storeCreatorId]);

  const isGroupCreator = creatorCheck === 'creator';
  const [devForceCreatorView, setDevForceCreatorView] = useState(false);
  const showCreatorUi = isGroupCreator || (ALLOW_DEV_CREATOR_VIEW && devForceCreatorView);
  const [hasCache, setHasCache] = useState(() => !!initialCache);
  const [loading, setLoading] = useState(() => !initialCache);
  const [leagues, setLeagues] = useState<DbLeagueRow[]>(() => initialCache?.leagues ?? []);
  const [pastOpen, setPastOpen] = useState(false);
  const [previewTop3, setPreviewTop3] = useState<{ name: string; rank: number }[]>(
    () => initialCache?.previewTop3 ?? []
  );

  const load = useCallback(async () => {
    const cached = getTournamentSectionCache(group.id);
    if (!cached) setLoading(true);
    const accessToken = (await resolveSocialGroupsAccessToken()) ?? undefined;
    const res = await fetchLeaguesForGroup(group.id, accessToken);
    const synced = await syncLeagueStatuses(res.data ?? [], accessToken);
    const active = synced.find((l) => l.status === 'active' && isLeagueActive(l));
    let top3: { name: string; rank: number }[] = [];
    if (active) {
      const bundle = await fetchLeagueBundle(active.id, accessToken);
      if (bundle.data) {
        const standings = computeLeagueStandings({
          league: bundle.data.league,
          entries: bundle.data.entries,
          rounds: bundle.data.rounds,
          teams: bundle.data.teams,
          displayNames,
        });
        top3 = standings.slice(0, 3).map((s) => ({
          name: s.displayName,
          rank: s.rank,
        }));
      }
    }
    setLeagues(synced);
    setPreviewTop3(top3);
    setTournamentSectionCache(group.id, { leagues: synced, previewTop3: top3 });
    setHasCache(true);
    setLoading(false);
  }, [group.id, displayNames]);

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
  const pastLeagues = useMemo(
    () => leagues.filter((l) => l.status === 'completed' || l.status === 'archived'),
    [leagues]
  );

  const showLoadingSpinner = loading && !hasCache && !activeLeague;
  const wrapInCard = !!activeLeague || pastLeagues.length > 0;

  const body = (
    <>
      {showLoadingSpinner ? (
        <ActivityIndicator color={colors.header} style={{ marginVertical: 16 }} />
      ) : activeLeague ? (
        <Pressable
          onPress={() => router.push(`/(tabs)/league/${activeLeague.id}` as never)}
          style={({ pressed }) => [styles.activeCard, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <View style={styles.badgeRow}>
            <View style={styles.formatBadge}>
              <Text style={styles.formatBadgeTxt}>{formatLeagueFormatLabel(activeLeague.format)}</Text>
            </View>
            <View style={styles.daysBadge}>
              <Text style={styles.daysBadgeTxt}>{leagueDaysRemaining(activeLeague)}d left</Text>
            </View>
          </View>
          <Text style={styles.tournamentName}>{activeLeague.name}</Text>
          {activeLeague.notes?.trim() ? (
            <Text style={styles.tournamentNotes}>{activeLeague.notes.trim()}</Text>
          ) : null}
          {previewTop3.length > 0 ? (
            <View style={styles.preview}>
              {previewTop3.map((p) => (
                <Text key={`${p.rank}-${p.name}`} style={styles.previewLine}>
                  {p.rank}. {p.name}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={styles.previewMuted}>No scores yet — log rounds to climb the board.</Text>
          )}
          <Text style={styles.seeAll}>See full standings →</Text>
        </Pressable>
      ) : creatorCheck === 'pending' ? (
        <View
          style={styles.neutralPending}
          accessibilityLabel="Loading tournament options"
          accessibilityRole="progressbar"
        />
      ) : showCreatorUi ? (
        <Pressable
          style={({ pressed }) => [styles.createBtn, pressed && styles.pressed]}
          onPress={() => router.push(`/(tabs)/league-create/${group.id}` as never)}
          accessibilityRole="button"
          accessibilityLabel="Create tournament"
        >
          <Text style={styles.createBtnTxt}>Create Tournament</Text>
        </Pressable>
      ) : (
        <Text style={styles.emptyMuted}>No active tournament</Text>
      )}

      {ALLOW_DEV_CREATOR_VIEW && !isGroupCreator ? (
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

      {pastLeagues.length > 0 ? (
        <>
          <Pressable
            onPress={() => setPastOpen((o) => !o)}
            style={styles.pastToggle}
            accessibilityRole="button"
          >
            <Text style={styles.pastToggleTxt}>Past tournaments ({pastLeagues.length})</Text>
            <Text style={styles.pastChev}>{pastOpen ? '▾' : '▸'}</Text>
          </Pressable>
          {pastOpen
            ? pastLeagues.map((l) => (
                <Pressable
                  key={l.id}
                  onPress={() => router.push(`/(tabs)/league/${l.id}` as never)}
                  style={styles.pastRow}
                >
                  <Text style={styles.pastName}>{l.name}</Text>
                  <Text style={styles.pastMeta}>
                    {formatLeagueFormatLabel(l.format)} · {l.status}
                  </Text>
                </Pressable>
              ))
            : null}
        </>
      ) : null}
    </>
  );

  return (
    <View style={{ marginTop: 16 }}>
      <View style={[socialSectionHeaderStyles.headerWrap, { paddingHorizontal: gutter }]}>
        <View style={socialSectionHeaderStyles.row}>
          <Text style={socialPageSectionTitleStyles.text} accessibilityRole="header">
            Tournaments
          </Text>
          <Pressable
            style={socialSectionHeaderStyles.infoBtn}
            onPress={onInfoPress}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="About Tournaments"
          >
            <Text style={socialSectionHeaderStyles.infoBtnTxt}>ⓘ</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ marginHorizontal: gutter, marginTop: 8 }}>
        {wrapInCard ? <View style={styles.card}>{body}</View> : body}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f0f7f3',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
  },
  createBtn: {
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  createBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
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
  preview: { marginTop: 10, gap: 4 },
  previewLine: { fontSize: 13, color: colors.ink },
  previewMuted: { fontSize: 13, color: colors.muted, marginTop: 10 },
  seeAll: { fontSize: 13, fontWeight: '700', color: colors.sage, marginTop: 12 },
  pastToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pastToggleTxt: { fontSize: 13, fontWeight: '600', color: colors.muted },
  pastChev: { fontSize: 14, color: colors.muted },
  pastRow: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pastName: { fontSize: 14, fontWeight: '600', color: colors.ink },
  pastMeta: { fontSize: 12, color: colors.subtle, marginTop: 2 },
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
