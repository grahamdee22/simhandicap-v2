import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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
import { IconCheckmark } from '../../../src/components/SvgUiIcons';
import { showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import { createLeague, fetchLeaguesForGroup, type LeagueFormat } from '../../../src/lib/leagues';
import { useResponsive } from '../../../src/lib/responsive';
import { useAppStore } from '../../../src/store/useAppStore';

const FORMATS: { key: LeagueFormat; title: string; sub: string }[] = [
  {
    key: 'stroke',
    title: 'Stroke Play',
    sub: 'Each player logs their own rounds. Lowest average net score wins.',
  },
  {
    key: 'match_play',
    title: 'Match Play',
    sub: 'Head to head matches between players. Most wins takes the title.',
  },
  {
    key: 'scramble',
    title: 'Scramble',
    sub: 'Teams play together. Everyone hits, the best shot is used. Lowest team score wins.',
  },
  {
    key: 'best_ball',
    title: 'Best Ball',
    sub: 'Teams play individually. The best score on each hole counts for the team.',
  },
];

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function LeagueCreateScreen() {
  const { groupId: rawGroupId } = useLocalSearchParams<{ groupId: string | string[] }>();
  const groupId = typeof rawGroupId === 'string' ? rawGroupId : rawGroupId?.[0] ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user } = useAuth();
  const groups = useAppStore((s) => s.groups);

  const group = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId]);
  const members = group?.members.filter((m) => m.userId) ?? [];

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [format, setFormat] = useState<LeagueFormat>('stroke');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 28);
    return d;
  });
  const [roundsThatCount, setRoundsThatCount] = useState(4);
  const [useHandicap, setUseHandicap] = useState(true);
  const [teams, setTeams] = useState<{ id: string; name: string; memberIds: string[] }[]>([
    { id: 't1', name: 'Team 1', memberIds: [] },
    { id: 't2', name: 'Team 2', memberIds: [] },
  ]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsTeams = format === 'scramble' || format === 'best_ball';
  const totalSteps = needsTeams ? 4 : 3;

  const allAssigned = useMemo(() => {
    if (!needsTeams) return true;
    const assigned = new Set(teams.flatMap((t) => t.memberIds));
    return members.every((m) => assigned.has(m.userId));
  }, [needsTeams, teams, members]);

  const onAutoBalance = () => {
    const sorted = [...members].sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
    const next = teams.map((t) => ({ ...t, memberIds: [] as string[] }));
    sorted.forEach((m, i) => {
      next[i % next.length].memberIds.push(m.userId);
    });
    setTeams(next);
  };

  const assignMemberToTeam = (userId: string, teamId: string) => {
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        memberIds: t.id === teamId ? [...t.memberIds.filter((id) => id !== userId), userId] : t.memberIds.filter((id) => id !== userId),
      }))
    );
  };

  const onLaunch = async () => {
    if (!user?.id || !group) return;
    const existing = await fetchLeaguesForGroup(groupId, googleOAuthAccessToken ?? undefined);
    if (existing.data?.some((l) => l.status === 'active')) {
      showAppAlert('Active tournament', 'This crew already has an active tournament. End it before creating another.');
      return;
    }
    setBusy(true);
    const res = await createLeague(
      {
        groupId,
        name,
        format,
        startDate: ymd(startDate),
        endDate: ymd(endDate),
        roundsThatCount,
        useHandicap,
        createdBy: user.id,
        members,
        teams: needsTeams
          ? teams.map((t) => ({ name: t.name, memberUserIds: t.memberIds }))
          : undefined,
      },
      googleOAuthAccessToken ?? undefined
    );
    setBusy(false);
    if (res.error || !res.data) {
      showAppAlert('Could not create tournament', res.error ?? 'Unknown error');
      return;
    }
    showAppAlert('Tournament created', 'Members will see it in their group.');
    router.replace('/(tabs)/groups' as never);
  };

  if (!group) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={{ padding: gutter }}>
          <Text>Group not found.</Text>
        </View>
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
        <Text style={styles.stepProg}>
          Step {step + 1} of {totalSteps}
        </Text>

        {step === 0 ? (
          <>
            <Text style={styles.head}>Basic info</Text>
            <Text style={styles.lbl}>Tournament name</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Spring League"
              placeholderTextColor={colors.subtle}
            />
            <Text style={[styles.lbl, { marginTop: 16 }]}>Format</Text>
            {FORMATS.map((f) => {
              const on = format === f.key;
              return (
                <Pressable
                  key={f.key}
                  style={[styles.formatCard, on && styles.formatCardOn]}
                  onPress={() => setFormat(f.key)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formatTitle}>{f.title}</Text>
                    <Text style={styles.formatSub}>{f.sub}</Text>
                  </View>
                  {on ? <IconCheckmark size={20} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.primaryBtn, !name.trim() && styles.btnDisabled]}
              disabled={!name.trim()}
              onPress={() => setStep(1)}
            >
              <Text style={styles.primaryBtnTxt}>Continue</Text>
            </Pressable>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Text style={styles.head}>Settings</Text>
            <Text style={styles.lbl}>Start date</Text>
            <DateTimePicker
              value={startDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, d) => d && setStartDate(d)}
            />
            <Text style={styles.lbl}>End date</Text>
            <DateTimePicker
              value={endDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, d) => d && setEndDate(d)}
            />
            <Text style={styles.lbl}>Rounds that count toward standings</Text>
            <View style={styles.stepperRow}>
              <Pressable style={styles.stepperBtn} onPress={() => setRoundsThatCount((n) => Math.max(1, n - 1))}>
                <Text style={styles.stepperBtnTxt}>−</Text>
              </Pressable>
              <Text style={styles.stepperVal}>{roundsThatCount}</Text>
              <Pressable style={styles.stepperBtn} onPress={() => setRoundsThatCount((n) => Math.min(10, n + 1))}>
                <Text style={styles.stepperBtnTxt}>+</Text>
              </Pressable>
            </View>
            <Text style={styles.helper}>e.g. best {roundsThatCount} of 6 rounds count</Text>
            <Pressable style={styles.toggleRow} onPress={() => setUseHandicap((v) => !v)}>
              <Text style={styles.toggleLbl}>Use SimCap handicap</Text>
              <Text style={styles.toggleVal}>{useHandicap ? 'On' : 'Off'}</Text>
            </Pressable>
            <Text style={styles.helper}>Adjusts scores using each player&apos;s SimCap index</Text>
            <Pressable style={styles.primaryBtn} onPress={() => setStep(needsTeams ? 2 : 3)}>
              <Text style={styles.primaryBtnTxt}>Continue</Text>
            </Pressable>
          </>
        ) : null}

        {step === 2 && needsTeams ? (
          <>
            <Text style={styles.head}>Assign Teams</Text>
            <Text style={styles.helper}>
              Tap a player, then tap a team to assign. Use Auto-balance to sort by handicap.
            </Text>
            <Pressable style={styles.outlineBtn} onPress={onAutoBalance}>
              <Text style={styles.outlineBtnTxt}>Auto-balance</Text>
            </Pressable>
            {members.map((m) => (
              <Pressable
                key={m.userId}
                style={[styles.memberRow, selectedMemberId === m.userId && styles.memberRowOn]}
                onPress={() => setSelectedMemberId(m.userId)}
              >
                <View style={styles.memberAv}>
                  <Text style={styles.memberAvTxt}>{m.initials}</Text>
                </View>
                <Text style={styles.memberName}>{m.displayName}</Text>
                <Text style={styles.memberIdx}>{m.index != null ? m.index.toFixed(1) : '—'}</Text>
              </Pressable>
            ))}
            {teams.map((t) => (
              <View key={t.id} style={styles.teamBucket}>
                <TextInput
                  style={styles.teamNameInput}
                  value={t.name}
                  onChangeText={(v) =>
                    setTeams((prev) => prev.map((x) => (x.id === t.id ? { ...x, name: v } : x)))
                  }
                />
                <View style={styles.teamMembers}>
                  {t.memberIds.map((uid) => {
                    const m = members.find((x) => x.userId === uid);
                    return (
                      <Pressable
                        key={uid}
                        style={styles.chip}
                        onPress={() => assignMemberToTeam(uid, t.id)}
                      >
                        <Text style={styles.chipTxt}>{m?.displayName ?? uid}</Text>
                      </Pressable>
                    );
                  })}
                  {selectedMemberId ? (
                    <Pressable
                      style={styles.chipAdd}
                      onPress={() => {
                        assignMemberToTeam(selectedMemberId, t.id);
                        setSelectedMemberId(null);
                      }}
                    >
                      <Text style={styles.chipAddTxt}>+ Add selected</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
            <Pressable
              style={styles.outlineBtn}
              onPress={() =>
                setTeams((prev) => [
                  ...prev,
                  { id: `t${Date.now()}`, name: `Team ${prev.length + 1}`, memberIds: [] },
                ])
              }
            >
              <Text style={styles.outlineBtnTxt}>Add team +</Text>
            </Pressable>
            <Pressable
              style={[styles.primaryBtn, !allAssigned && styles.btnDisabled]}
              disabled={!allAssigned}
              onPress={() => setStep(3)}
            >
              <Text style={styles.primaryBtnTxt}>Continue</Text>
            </Pressable>
          </>
        ) : null}

        {step === 3 || (step === 2 && !needsTeams) ? (
          <>
            <Text style={styles.head}>Review & Launch</Text>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLine}>{name}</Text>
              <Text style={styles.summaryMeta}>
                {format.replace('_', ' ')} · {ymd(startDate)} – {ymd(endDate)}
              </Text>
              <Text style={styles.summaryMeta}>
                Best {roundsThatCount} rounds · Handicap {useHandicap ? 'on' : 'off'}
              </Text>
              {needsTeams
                ? teams.map((t) => (
                    <Text key={t.id} style={styles.summaryMeta}>
                      {t.name}: {t.memberIds.length} players
                    </Text>
                  ))
                : null}
            </View>
            <Pressable style={styles.primaryBtn} disabled={busy} onPress={() => void onLaunch()}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnTxt}>Launch Tournament</Text>}
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  stepProg: { fontSize: 12, color: colors.muted, marginBottom: 8 },
  head: { fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 12 },
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
  formatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
    marginBottom: 10,
    gap: 10,
  },
  formatCardOn: { borderColor: colors.sage, backgroundColor: colors.accentSoft },
  formatTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  formatSub: { fontSize: 13, color: colors.muted, marginTop: 4, lineHeight: 18 },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.5 },
  helper: { fontSize: 12, color: colors.muted, marginTop: 4, marginBottom: 8, lineHeight: 17 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginVertical: 8 },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnTxt: { fontSize: 20, fontWeight: '700', color: colors.header },
  stepperVal: { fontSize: 20, fontWeight: '700', color: colors.ink, minWidth: 32, textAlign: 'center' },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: 8,
  },
  toggleLbl: { fontSize: 15, fontWeight: '600', color: colors.ink },
  toggleVal: { fontSize: 15, fontWeight: '700', color: colors.sage },
  outlineBtn: {
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.sage,
    alignItems: 'center',
  },
  outlineBtnTxt: { color: colors.accentDark, fontWeight: '700' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: colors.bg,
    gap: 10,
  },
  memberRowOn: { backgroundColor: colors.accentSoft },
  memberAv: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvTxt: { fontWeight: '700', color: colors.accentDark },
  memberName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.ink },
  memberIdx: { fontSize: 13, color: colors.muted },
  teamBucket: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f0f7f3',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  teamNameInput: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  teamMembers: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: colors.header,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
  chipAdd: {
    borderWidth: 1,
    borderColor: colors.sage,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipAddTxt: { color: colors.accentDark, fontSize: 12, fontWeight: '600' },
  summaryCard: {
    backgroundColor: '#f0f7f3',
    borderRadius: 12,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  summaryLine: { fontSize: 18, fontWeight: '700', color: colors.ink },
  summaryMeta: { fontSize: 13, color: colors.muted, marginTop: 6 },
});
