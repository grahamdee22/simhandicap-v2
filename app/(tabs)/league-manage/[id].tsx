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
import { ContentWidth } from '../../../src/components/ContentWidth';
import { confirmDestructive, showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import {
  deleteLeague,
  fetchLeagueBundle,
  updateLeague,
  type LeagueBundle,
} from '../../../src/lib/leagues';
import { useResponsive } from '../../../src/lib/responsive';
import { useAppStore } from '../../../src/store/useAppStore';

export default function LeagueManageScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const leagueId = typeof rawId === 'string' ? rawId : rawId?.[0] ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user } = useAuth();
  const groups = useAppStore((s) => s.groups);

  const [bundle, setBundle] = useState<LeagueBundle | null>(null);
  const [name, setName] = useState('');
  const [endDate, setEndDate] = useState(new Date());
  const [busy, setBusy] = useState(false);

  const group = useMemo(
    () => groups.find((g) => g.id === bundle?.league.group_id),
    [groups, bundle?.league.group_id]
  );
  const isCreator = !!user?.id && group?.createdByUserId === user.id;

  const load = useCallback(async () => {
    const res = await fetchLeagueBundle(leagueId, googleOAuthAccessToken ?? undefined);
    if (res.data) {
      setBundle(res.data);
      setName(res.data.league.name);
      setEndDate(new Date(`${res.data.league.end_date}T12:00:00`));
    }
  }, [leagueId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (!isCreator) {
    return (
      <ContentWidth bg={colors.surface}>
        <Text style={{ padding: gutter }}>Only the group creator can manage this tournament.</Text>
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

        <Pressable style={[styles.outlineBtn, { marginTop: 24 }]} disabled={busy} onPress={() => void endEarly()}>
          <Text style={styles.outlineBtnTxt}>End tournament early</Text>
        </Pressable>

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
  dangerBtn: {
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
  },
  dangerBtnTxt: { color: '#fff', fontWeight: '700' },
});
