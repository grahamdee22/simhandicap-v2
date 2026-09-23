import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { isSocialGroupManager } from '../../../src/lib/socialGroupCreator';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { confirmDestructive, showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import {
  deleteLeague,
  fetchLeagueBundle,
  syncLeagueStatuses,
  updateLeague,
  type LeagueBundle,
} from '../../../src/lib/leagues';
import {
  fetchLeagueMatchPairings,
  formatPairingStatusLabel,
  generateMatchPlayBracket,
  type DbLeagueMatchPairingRow,
} from '../../../src/lib/matchPlayTournamentPairings';
import {
  formatTeamMemberSummary,
  isTeamLeagueFormat,
} from '../../../src/lib/leagueStandings';
import { useResponsive } from '../../../src/lib/responsive';
import { useAppStore } from '../../../src/store/useAppStore';

/** True once any pairing has left the initial scheduled state (play started or finished). */
function pairingsHaveRecordedResults(pairings: DbLeagueMatchPairingRow[]): boolean {
  return pairings.some(
    (p) =>
      p.status !== 'scheduled' ||
      p.winner_entry_id != null ||
      p.holes_won_p1 > 0 ||
      p.holes_won_p2 > 0
  );
}

export default function LeagueManageScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const leagueId = typeof rawId === 'string' ? rawId : rawId?.[0] ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user, session } = useAuth();
  const groups = useAppStore((s) => s.groups);

  const [bundle, setBundle] = useState<LeagueBundle | null>(null);
  const [pairings, setPairings] = useState<DbLeagueMatchPairingRow[]>([]);
  const [name, setName] = useState('');
  const [endDate, setEndDate] = useState(new Date());
  const [busy, setBusy] = useState(false);
  const [bracketBusy, setBracketBusy] = useState(false);
  const [bracketBanner, setBracketBanner] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);

  const group = useMemo(
    () => groups.find((g) => g.id === bundle?.league.group_id),
    [groups, bundle?.league.group_id]
  );
  const authUserId = session?.user?.id ?? user?.id ?? null;
  const canManage = isSocialGroupManager(group, authUserId);

  const load = useCallback(async () => {
    const token = googleOAuthAccessToken ?? undefined;
    const res = await fetchLeagueBundle(leagueId, token);
    if (res.data) {
      const synced = await syncLeagueStatuses([res.data.league], token);
      const league = synced[0] ?? res.data.league;
      setBundle({ ...res.data, league });
      setName(league.name);
      setEndDate(new Date(`${league.end_date}T12:00:00`));
      if (league.format === 'match_play') {
        const pr = await fetchLeagueMatchPairings(leagueId, googleOAuthAccessToken ?? undefined);
        setPairings(pr.data ?? []);
      } else {
        setPairings([]);
      }
    }
  }, [leagueId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Same seed order as create: lowest SimCap index = #1 seed. */
  const seededUserIds = useMemo(() => {
    if (!bundle) return [];
    return [...bundle.entries]
      .map((e) => {
        const mem = group?.members.find((m) => m.userId === e.user_id);
        return { userId: e.user_id, index: mem?.index ?? 99 };
      })
      .sort((a, b) => a.index - b.index)
      .map((x) => x.userId);
  }, [bundle, group?.members]);

  const canRegenerateBracket =
    pairings.length > 0 && !pairingsHaveRecordedResults(pairings);

  const runGenerateBracket = async () => {
    if (bracketBusy || !bundle) return;
    setBracketBusy(true);
    setBracketBanner(null);
    const res = await generateMatchPlayBracket(
      leagueId,
      seededUserIds,
      googleOAuthAccessToken ?? undefined
    );
    if (res.error) {
      setBracketBusy(false);
      setBracketBanner({ kind: 'err', text: res.error });
      return;
    }
    const pr = await fetchLeagueMatchPairings(leagueId, googleOAuthAccessToken ?? undefined);
    setPairings(pr.data ?? []);
    setBracketBusy(false);
    setBracketBanner({
      kind: 'ok',
      text: 'Bracket generated — lowest index is the #1 seed',
    });
  };

  const onRegenerateBracket = async () => {
    const ok = await confirmDestructive(
      'Regenerate bracket?',
      'This will discard the current pairings and reseed from scratch.',
      'Regenerate'
    );
    if (!ok) return;
    await runGenerateBracket();
  };

  const saveName = async () => {
    setBusy(true);
    const res = await updateLeague(leagueId, { name: name.trim() }, googleOAuthAccessToken ?? undefined);
    setBusy(false);
    if (res.error) showAppAlert('Update failed', res.error);
    else showAppAlert('Saved', 'Tournament name updated.');
  };

  const extendEnd = async () => {
    setBusy(true);
    const ymd = endDate.toISOString().slice(0, 10);
    const res = await updateLeague(leagueId, { end_date: ymd }, googleOAuthAccessToken ?? undefined);
    setBusy(false);
    if (res.error) showAppAlert('Update failed', res.error);
    else showAppAlert('Saved', 'End date updated.');
  };

  const endEarly = async () => {
    const ok = await confirmDestructive(
      'End tournament?',
      'This will mark the tournament as completed. Members will see final standings.',
      'End tournament'
    );
    if (!ok) return;
    setBusy(true);
    const res = await updateLeague(leagueId, { status: 'completed' }, googleOAuthAccessToken ?? undefined);
    setBusy(false);
    if (res.error) showAppAlert('Could not end', res.error);
    else router.replace(`/(tabs)/league/${leagueId}` as never);
  };

  const displayNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mem of group?.members ?? []) {
      if (mem.userId) m[mem.userId] = mem.displayName.replace(' (you)', '');
    }
    return m;
  }, [group?.members]);

  const teamRoster = useMemo(() => {
    if (!bundle || !isTeamLeagueFormat(bundle.league.format)) return [];
    return [...bundle.teams]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => {
        const members = bundle.entries
          .filter((e) => e.league_team_id === t.id)
          .map((e) => displayNames[e.user_id] ?? 'Player');
        return { id: t.id, name: t.name, members };
      });
  }, [bundle, displayNames]);

  const onDelete = async () => {
    const ok = await confirmDestructive(
      'Delete tournament?',
      'This cannot be undone. All tournament data will be removed.',
      'Delete'
    );
    if (!ok) return;
    setBusy(true);
    const res = await deleteLeague(leagueId, googleOAuthAccessToken ?? undefined);
    setBusy(false);
    if (res.error) showAppAlert('Delete failed', res.error);
    else router.replace('/(tabs)/groups' as never);
  };

  if (!bundle) {
    return (
      <ContentWidth bg={colors.surface}>
        <ActivityIndicator color={colors.header} style={{ marginTop: 40 }} />
      </ContentWidth>
    );
  }

  if (!canManage) {
    return (
      <ContentWidth bg={colors.surface}>
        <Text style={{ padding: gutter }}>Only the group creator or an admin can manage this tournament.</Text>
      </ContentWidth>
    );
  }

  return (
    <ContentWidth bg={colors.surface}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: 14,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <Text style={styles.head}>Manage tournament</Text>

        <Text style={styles.lbl}>Tournament name</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} />
        <Pressable style={styles.outlineBtn} disabled={busy} onPress={() => void saveName()}>
          <Text style={styles.outlineBtnTxt}>Save name</Text>
        </Pressable>

        <Text style={[styles.lbl, { marginTop: 20 }]}>Extend end date</Text>
        <DateTimePicker
          value={endDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, d) => d && setEndDate(d)}
        />
        <Pressable style={styles.outlineBtn} disabled={busy} onPress={() => void extendEnd()}>
          <Text style={styles.outlineBtnTxt}>Save end date</Text>
        </Pressable>

        {teamRoster.length > 0 ? (
          <View style={styles.teamSection}>
            <Text style={styles.lbl}>Teams ({teamRoster.length})</Text>
            <Text style={styles.helper}>
              Rosters are set when the tournament is created. To change teams, create a new
              tournament.
            </Text>
            <View style={styles.teamRosterCard}>
              {teamRoster.map((t, i) => (
                <View
                  key={t.id}
                  style={[styles.teamRosterRow, i === 0 && styles.teamRosterRowFirst]}
                >
                  <Text style={styles.teamRosterName} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Text style={styles.teamRosterMembers} numberOfLines={2}>
                    {t.members.length > 0
                      ? formatTeamMemberSummary(t.members)
                      : 'No players assigned'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {bundle.league.format === 'match_play' ? (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.lbl}>Match pairings</Text>

            {bracketBanner ? (
              <View
                style={[
                  styles.bracketBanner,
                  bracketBanner.kind === 'ok' ? styles.bracketBannerOk : styles.bracketBannerErr,
                ]}
              >
                <Text
                  style={[
                    styles.bracketBannerTxt,
                    bracketBanner.kind === 'ok'
                      ? styles.bracketBannerTxtOk
                      : styles.bracketBannerTxtErr,
                  ]}
                >
                  {bracketBanner.text}
                </Text>
              </View>
            ) : null}

            {pairings.length === 0 ? (
              <>
                <Text style={styles.helper}>
                  Bracket wasn't generated when this tournament launched.
                </Text>
                <Pressable
                  style={[styles.primaryBtn, bracketBusy && styles.btnDisabled]}
                  disabled={bracketBusy || busy}
                  onPress={() => void runGenerateBracket()}
                  accessibilityRole="button"
                  accessibilityLabel="Generate bracket"
                >
                  {bracketBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnTxt}>Generate bracket</Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                {pairings.map((p) => {
                  const e1 = bundle.entries.find((e) => e.id === p.player_1_entry_id);
                  const e2 = bundle.entries.find((e) => e.id === p.player_2_entry_id);
                  const n1 = e1 ? displayNames[e1.user_id] ?? 'Player' : 'Player';
                  const n2 = e2 ? displayNames[e2.user_id] ?? 'Player' : 'Player';
                  return (
                    <Text key={p.id} style={styles.pairingLine}>
                      {n1} vs {n2} · {formatPairingStatusLabel(p.status)}
                    </Text>
                  );
                })}
                {canRegenerateBracket ? (
                  <Pressable
                    style={styles.regenLink}
                    disabled={bracketBusy || busy}
                    onPress={() => void onRegenerateBracket()}
                    accessibilityRole="button"
                    accessibilityLabel="Regenerate bracket"
                  >
                    {bracketBusy ? (
                      <ActivityIndicator color={colors.muted} />
                    ) : (
                      <Text style={styles.regenLinkTxt}>Regenerate bracket</Text>
                    )}
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        {bundle.league.status === 'active' ? (
          <Pressable style={[styles.outlineBtn, { marginTop: 24 }]} disabled={busy} onPress={() => void endEarly()}>
            <Text style={styles.outlineBtnTxt}>End tournament early</Text>
          </Pressable>
        ) : null}

        <Pressable style={styles.dangerBtn} disabled={busy} onPress={() => void onDelete()}>
          <Text style={styles.dangerBtnTxt}>Delete tournament</Text>
        </Pressable>
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  head: { fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 16 },
  lbl: { fontSize: 12, fontWeight: '600', color: colors.muted, marginBottom: 6 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  outlineBtn: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.sage,
    alignItems: 'center',
  },
  outlineBtnTxt: { color: colors.accentDark, fontWeight: '700' },
  primaryBtn: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.sage,
    alignItems: 'center',
  },
  primaryBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.55 },
  helper: { fontSize: 13, color: colors.muted, marginBottom: 8, lineHeight: 18 },
  teamSection: { marginTop: 24 },
  teamRosterCard: {
    backgroundColor: '#f0f7f3',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  teamRosterRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  teamRosterRowFirst: { borderTopWidth: 0 },
  teamRosterName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  teamRosterMembers: { fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 17 },
  pairingLine: { fontSize: 14, color: colors.ink, marginBottom: 6 },
  regenLink: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  regenLinkTxt: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    textDecorationLine: 'underline',
  },
  bracketBanner: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bracketBannerOk: {
    backgroundColor: '#ecf6f1',
    borderColor: colors.sage,
  },
  bracketBannerErr: {
    backgroundColor: '#fef2f2',
    borderColor: colors.danger,
  },
  bracketBannerTxt: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  bracketBannerTxtOk: { color: colors.forestMid },
  bracketBannerTxtErr: { color: colors.danger },
  dangerBtn: {
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
  },
  dangerBtnTxt: { color: '#fff', fontWeight: '700' },
});
