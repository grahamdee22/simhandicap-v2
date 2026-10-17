import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { isSocialGroupManager } from '../../../src/lib/socialGroupCreator';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { IconCheckmark, IconTrashOutline } from '../../../src/components/SvgUiIcons';
import { useTranslation } from '../../../src/i18n';
import { confirmDestructive, showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import {
  addLeagueEntries,
  deleteLeague,
  fetchLeagueBundle,
  isActiveLeagueEntry,
  softRemoveLeagueEntry,
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
import { clearTournamentSectionCache } from '../../../src/lib/tournamentSectionCache';
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
  const { t } = useTranslation();
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
  const [addPlayersOpen, setAddPlayersOpen] = useState(false);
  const [addPickIds, setAddPickIds] = useState<Record<string, boolean>>({});
  const [rosterNote, setRosterNote] = useState<string | null>(null);
  const [rosterBusy, setRosterBusy] = useState(false);

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
      text: t('league.manage.bracketGenerated'),
    });
  };

  const onRegenerateBracket = async () => {
    const ok = await confirmDestructive(
      t('league.manage.regenerateConfirmTitle'),
      t('league.manage.regenerateConfirmBody'),
      t('league.manage.regenerateConfirmAction')
    );
    if (!ok) return;
    await runGenerateBracket();
  };

  const saveName = async () => {
    setBusy(true);
    const res = await updateLeague(leagueId, { name: name.trim() }, googleOAuthAccessToken ?? undefined);
    setBusy(false);
    if (res.error) showAppAlert(t('league.manage.updateFailed'), res.error);
    else showAppAlert(t('league.manage.saved'), t('league.manage.nameUpdated'));
  };

  const extendEnd = async () => {
    setBusy(true);
    const ymd = endDate.toISOString().slice(0, 10);
    const res = await updateLeague(leagueId, { end_date: ymd }, googleOAuthAccessToken ?? undefined);
    setBusy(false);
    if (res.error) showAppAlert(t('league.manage.updateFailed'), res.error);
    else showAppAlert(t('league.manage.saved'), t('league.manage.endDateUpdated'));
  };

  const endEarly = async () => {
    const ok = await confirmDestructive(
      t('league.manage.endConfirmTitle'),
      t('league.manage.endConfirmBody'),
      t('league.manage.endConfirmAction')
    );
    if (!ok) return;
    setBusy(true);
    const res = await updateLeague(leagueId, { status: 'completed' }, googleOAuthAccessToken ?? undefined);
    setBusy(false);
    if (res.error) showAppAlert(t('league.manage.couldNotEnd'), res.error);
    else router.replace(`/(tabs)/league/${leagueId}` as never);
  };

  const displayNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mem of group?.members ?? []) {
      if (mem.userId) m[mem.userId] = mem.displayName.replace(' (you)', '');
    }
    return m;
  }, [group?.members]);

  const activeStrokeEntries = useMemo(() => {
    if (!bundle || bundle.league.format !== 'stroke') return [];
    return bundle.entries.filter(isActiveLeagueEntry);
  }, [bundle]);

  const addableGroupMembers = useMemo(() => {
    if (!group) return [];
    const activeIds = new Set(activeStrokeEntries.map((e) => e.user_id));
    return group.members
      .filter((m) => m.userId && !activeIds.has(m.userId))
      .slice()
      .sort((a, b) =>
        a.displayName.replace(' (you)', '').localeCompare(b.displayName.replace(' (you)', ''))
      );
  }, [group, activeStrokeEntries]);

  const openAddPlayers = () => {
    setAddPickIds({});
    setAddPlayersOpen(true);
  };

  const toggleAddPick = (userId: string) => {
    setAddPickIds((prev) => ({ ...prev, [userId]: !prev[userId] }));
  };

  const selectedAddCount = useMemo(
    () => Object.values(addPickIds).filter(Boolean).length,
    [addPickIds]
  );

  const onConfirmAddPlayers = async () => {
    const userIds = Object.entries(addPickIds)
      .filter(([, on]) => on)
      .map(([id]) => id);
    if (userIds.length === 0) {
      setAddPlayersOpen(false);
      return;
    }
    setRosterBusy(true);
    const res = await addLeagueEntries({
      leagueId,
      userIds,
      accessToken: googleOAuthAccessToken ?? undefined,
    });
    setRosterBusy(false);
    if (res.error) {
      showAppAlert(t('league.manage.couldNotAddPlayers'), res.error);
      return;
    }
    setAddPlayersOpen(false);
    setRosterNote(t('league.manage.addedPlayers', { count: userIds.length }));
    if (bundle?.league.group_id) clearTournamentSectionCache(bundle.league.group_id);
    await load();
  };

  const onRemovePlayer = async (entryId: string, userId: string) => {
    if (activeStrokeEntries.length <= 1) {
      showAppAlert(t('league.manage.cannotRemove'), t('league.manage.cannotRemoveBody'));
      return;
    }
    const playerName = displayNames[userId] ?? t('league.create.playerFallback');
    const ok = await confirmDestructive(
      t('league.manage.removeConfirmTitle', { name: playerName }),
      t('league.manage.removeConfirmBody'),
      t('league.manage.removeConfirmAction')
    );
    if (!ok) return;
    setRosterBusy(true);
    const res = await softRemoveLeagueEntry(entryId, googleOAuthAccessToken ?? undefined);
    setRosterBusy(false);
    if (res.error) {
      showAppAlert(t('league.manage.couldNotRemove'), res.error);
      return;
    }
    setRosterNote(null);
    if (bundle?.league.group_id) clearTournamentSectionCache(bundle.league.group_id);
    await load();
  };

  const teamRoster = useMemo(() => {
    if (!bundle || !isTeamLeagueFormat(bundle.league.format)) return [];
    const playerFallback = t('league.create.playerFallback');
    return [...bundle.teams]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((team) => {
        const members = bundle.entries
          .filter((e) => e.league_team_id === team.id)
          .map((e) => displayNames[e.user_id] ?? playerFallback);
        return { id: team.id, name: team.name, members };
      });
  }, [bundle, displayNames, t]);

  const onDelete = async () => {
    const ok = await confirmDestructive(
      t('league.manage.deleteConfirmTitle'),
      t('league.manage.deleteConfirmBody'),
      t('league.manage.deleteConfirmAction')
    );
    if (!ok) return;
    setBusy(true);
    const res = await deleteLeague(leagueId, googleOAuthAccessToken ?? undefined);
    setBusy(false);
    if (res.error) showAppAlert(t('league.manage.deleteFailed'), res.error);
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
        <Text style={{ padding: gutter }}>{t('league.manage.cannotManage')}</Text>
      </ContentWidth>
    );
  }

  const playerFallback = t('league.create.playerFallback');

  return (
    <ContentWidth bg={colors.surface}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: 14,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <Text style={styles.head}>{t('tabs.leagueManage.title')}</Text>

        <Text style={styles.lbl}>{t('league.create.tournamentName')}</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} />
        <Pressable style={styles.outlineBtn} disabled={busy} onPress={() => void saveName()}>
          <Text style={styles.outlineBtnTxt}>{t('league.manage.saveName')}</Text>
        </Pressable>

        <Text style={[styles.lbl, { marginTop: 20 }]}>{t('league.manage.extendEndDate')}</Text>
        <DateTimePicker
          value={endDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_, d) => d && setEndDate(d)}
        />
        <Pressable style={styles.outlineBtn} disabled={busy} onPress={() => void extendEnd()}>
          <Text style={styles.outlineBtnTxt}>{t('league.manage.saveEndDate')}</Text>
        </Pressable>

        {teamRoster.length > 0 ? (
          <View style={styles.teamSection}>
            <Text style={styles.lbl}>
              {t('league.manage.teamsCount', { count: teamRoster.length })}
            </Text>
            <Text style={styles.helper}>{t('league.manage.teamsHelper')}</Text>
            <View style={styles.teamRosterCard}>
              {teamRoster.map((team, i) => (
                <View
                  key={team.id}
                  style={[styles.teamRosterRow, i === 0 && styles.teamRosterRowFirst]}
                >
                  <Text style={styles.teamRosterName} numberOfLines={1}>
                    {team.name}
                  </Text>
                  <Text style={styles.teamRosterMembers} numberOfLines={2}>
                    {team.members.length > 0
                      ? formatTeamMemberSummary(team.members)
                      : t('league.manage.noPlayersAssigned')}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {bundle.league.format === 'stroke' ? (
          <View style={styles.rosterSection}>
            <Text style={styles.lbl}>
              {t('league.manage.playersCount', { count: activeStrokeEntries.length })}
            </Text>
            <Text style={styles.helper}>{t('league.manage.rosterHelper')}</Text>
            {rosterNote ? (
              <View style={[styles.bracketBanner, styles.bracketBannerOk]}>
                <Text style={[styles.bracketBannerTxt, styles.bracketBannerTxtOk]}>{rosterNote}</Text>
              </View>
            ) : null}
            <Pressable
              style={[styles.outlineBtn, { marginTop: 0, marginBottom: 10 }]}
              disabled={rosterBusy || busy || addableGroupMembers.length === 0}
              onPress={openAddPlayers}
            >
              <Text style={styles.outlineBtnTxt}>
                {addableGroupMembers.length === 0
                  ? t('league.manage.noMembersLeft')
                  : t('league.manage.addPlayer')}
              </Text>
            </Pressable>
            <View style={styles.teamRosterCard}>
              {activeStrokeEntries.map((e, i) => {
                const playerName = displayNames[e.user_id] ?? playerFallback;
                return (
                  <View
                    key={e.id}
                    style={[styles.rosterPlayerRow, i === 0 && styles.teamRosterRowFirst]}
                  >
                    <Text style={styles.teamRosterName} numberOfLines={1}>
                      {playerName}
                    </Text>
                    <Pressable
                      style={styles.removePlayerBtn}
                      disabled={rosterBusy || busy}
                      onPress={() => void onRemovePlayer(e.id, e.user_id)}
                      accessibilityRole="button"
                      accessibilityLabel={t('league.manage.removeA11y', { name: playerName })}
                      hitSlop={8}
                    >
                      <IconTrashOutline size={18} color={colors.danger} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {bundle.league.format === 'match_play' ? (
          <View style={{ marginTop: 24 }}>
            <Text style={styles.lbl}>{t('league.detail.matchPairings')}</Text>

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
                <Text style={styles.helper}>{t('league.manage.bracketNotGenerated')}</Text>
                <Pressable
                  style={[styles.primaryBtn, bracketBusy && styles.btnDisabled]}
                  disabled={bracketBusy || busy}
                  onPress={() => void runGenerateBracket()}
                  accessibilityRole="button"
                  accessibilityLabel={t('league.manage.generateBracketA11y')}
                >
                  {bracketBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnTxt}>{t('league.manage.generateBracket')}</Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                {pairings.map((p) => {
                  const e1 = bundle.entries.find((e) => e.id === p.player_1_entry_id);
                  const e2 = bundle.entries.find((e) => e.id === p.player_2_entry_id);
                  const n1 = e1 ? displayNames[e1.user_id] ?? playerFallback : playerFallback;
                  const n2 = e2 ? displayNames[e2.user_id] ?? playerFallback : playerFallback;
                  return (
                    <Text key={p.id} style={styles.pairingLine}>
                      {t('league.manage.pairingLine', {
                        name1: n1,
                        name2: n2,
                        status: formatPairingStatusLabel(p.status),
                      })}
                    </Text>
                  );
                })}
                {canRegenerateBracket ? (
                  <Pressable
                    style={styles.regenLink}
                    disabled={bracketBusy || busy}
                    onPress={() => void onRegenerateBracket()}
                    accessibilityRole="button"
                    accessibilityLabel={t('league.manage.regenerateBracketA11y')}
                  >
                    {bracketBusy ? (
                      <ActivityIndicator color={colors.muted} />
                    ) : (
                      <Text style={styles.regenLinkTxt}>
                        {t('league.manage.regenerateBracket')}
                      </Text>
                    )}
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        ) : null}

        {bundle.league.status === 'active' ? (
          <Pressable style={[styles.outlineBtn, { marginTop: 24 }]} disabled={busy} onPress={() => void endEarly()}>
            <Text style={styles.outlineBtnTxt}>{t('league.manage.endEarly')}</Text>
          </Pressable>
        ) : null}

        <Pressable style={styles.dangerBtn} disabled={busy} onPress={() => void onDelete()}>
          <Text style={styles.dangerBtnTxt}>{t('league.manage.deleteTournament')}</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={addPlayersOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAddPlayersOpen(false)}
      >
        <View style={[styles.addModal, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
          <Text style={styles.head}>{t('league.manage.addPlayersTitle')}</Text>
          <Text style={styles.helper}>{t('league.manage.addPlayersHelper')}</Text>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {addableGroupMembers.map((m) => {
              const checked = !!addPickIds[m.userId];
              return (
                <Pressable
                  key={m.userId}
                  style={[styles.addMemberRow, checked && styles.addMemberRowOn]}
                  onPress={() => toggleAddPick(m.userId)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                >
                  <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
                    {checked ? <IconCheckmark size={14} color="#fff" /> : null}
                  </View>
                  <Text style={styles.addMemberName} numberOfLines={1}>
                    {m.displayName.replace(' (you)', '')}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            style={[styles.primaryBtn, (selectedAddCount === 0 || rosterBusy) && styles.btnDisabled]}
            disabled={selectedAddCount === 0 || rosterBusy}
            onPress={() => void onConfirmAddPlayers()}
          >
            {rosterBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnTxt}>
                {t('league.manage.addPlayersCta', { count: selectedAddCount })}
              </Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.outlineBtn, { marginTop: 10 }]}
            disabled={rosterBusy}
            onPress={() => setAddPlayersOpen(false)}
          >
            <Text style={styles.outlineBtnTxt}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </Modal>
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
  rosterSection: { marginTop: 24 },
  rosterPlayerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 10,
  },
  removePlayerBtn: {
    padding: 4,
  },
  addModal: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: 20,
  },
  addMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: colors.bg,
  },
  addMemberRowOn: { backgroundColor: colors.accentSoft },
  addMemberName: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.ink },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.pillBorder,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkBoxOn: {
    backgroundColor: colors.sage,
    borderColor: colors.sage,
  },
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
