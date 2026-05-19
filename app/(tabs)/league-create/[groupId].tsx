import { useFocusEffect } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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

const FORMATS: { key: LeagueFormat; title: string; sub: string; comingSoon?: boolean }[] = [
  {
    key: 'stroke',
    title: 'Stroke Play',
    sub: 'Total strokes win. Log your rounds — the lowest average net score over the tournament takes the title.',
  },
  {
    key: 'match_play',
    title: 'Match Play',
    sub: 'Win holes, not strokes. Each hole is played independently — win, lose, or halve. The player who wins the most holes wins the match.',
    comingSoon: true,
  },
  {
    key: 'scramble',
    title: 'Scramble',
    sub: 'Everyone hits, the team picks the best shot, and you all play from there. One team score per hole.',
    comingSoon: true,
  },
  {
    key: 'best_ball',
    title: 'Best Ball',
    sub: 'Everyone plays their own ball the whole round. The lowest score on each hole counts for the team.',
    comingSoon: true,
  },
];

function isFormatComingSoon(key: LeagueFormat): boolean {
  return FORMATS.some((f) => f.key === key && !!f.comingSoon);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type WizardStep = 'basic' | 'settings' | 'teams' | 'review';

function defaultEndDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 28);
  return d;
}

function initialTeams() {
  return [
    { id: 't1', name: 'Team 1', memberIds: [] as string[] },
    { id: 't2', name: 'Team 2', memberIds: [] as string[] },
  ];
}

const DEFAULT_USE_HANDICAP = true;

function isTeamFormat(key: LeagueFormat): boolean {
  return key === 'scramble' || key === 'best_ball';
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

  const [step, setStep] = useState<WizardStep>('basic');
  const [name, setName] = useState('');
  const [format, setFormat] = useState<LeagueFormat>('stroke');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(defaultEndDate);
  const [roundsThatCount, setRoundsThatCount] = useState(4);
  const [useHandicap, setUseHandicap] = useState(DEFAULT_USE_HANDICAP);
  const [notes, setNotes] = useState('');
  const [teams, setTeams] = useState(initialTeams);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [assignedMemberAction, setAssignedMemberAction] = useState<{
    userId: string;
    fromTeamId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const handicapTouchedRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const notesSectionYRef = useRef(0);

  const resetWizard = useCallback(() => {
    handicapTouchedRef.current = false;
    setStep('basic');
    setName('');
    setFormat('stroke');
    setStartDate(new Date());
    setEndDate(defaultEndDate());
    setRoundsThatCount(4);
    setUseHandicap(DEFAULT_USE_HANDICAP);
    setTeams(initialTeams());
    setSelectedMemberId(null);
    setAssignedMemberAction(null);
    setBusy(false);
  }, []);

  useLayoutEffect(() => {
    resetWizard();
  }, [groupId, resetWizard]);

  useFocusEffect(
    useCallback(() => {
      resetWizard();
    }, [groupId, resetWizard])
  );

  useEffect(() => {
    if (step === 'settings' && !handicapTouchedRef.current) {
      setUseHandicap(DEFAULT_USE_HANDICAP);
    }
  }, [step]);

  useEffect(() => {
    if (isTeamFormat(format) || isFormatComingSoon(format)) {
      setFormat('stroke');
    }
  }, [format]);

  const needsTeams = isTeamFormat(format);

  const assignedMemberIds = useMemo(() => new Set(teams.flatMap((t) => t.memberIds)), [teams]);

  const unassignedMembers = useMemo(
    () => members.filter((m) => !assignedMemberIds.has(m.userId)),
    [members, assignedMemberIds]
  );
  const stepSequence = useMemo((): WizardStep[] => {
    return needsTeams ? ['basic', 'settings', 'teams', 'review'] : ['basic', 'settings', 'review'];
  }, [needsTeams]);

  const stepNumber = Math.max(1, stepSequence.indexOf(step) + 1);
  const totalSteps = stepSequence.length;

  const goToStep = useCallback(
    (next: WizardStep) => {
      if (stepSequence.includes(next)) setStep(next);
    },
    [stepSequence]
  );

  useEffect(() => {
    if (!stepSequence.includes(step)) {
      setStep(stepSequence[stepSequence.length - 1] ?? 'basic');
    }
  }, [step, stepSequence]);

  const allAssigned = useMemo(() => {
    if (!needsTeams) return true;
    return members.every((m) => assignedMemberIds.has(m.userId));
  }, [needsTeams, members, assignedMemberIds]);

  const onAutoBalance = () => {
    const sorted = [...members].sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
    const next = teams.map((t) => ({ ...t, memberIds: [] as string[] }));
    sorted.forEach((m, i) => {
      next[i % next.length].memberIds.push(m.userId);
    });
    setTeams(next);
    setSelectedMemberId(null);
    setAssignedMemberAction(null);
  };

  const assignMemberToTeam = (userId: string, teamId: string) => {
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        memberIds:
          t.id === teamId
            ? [...t.memberIds.filter((id) => id !== userId), userId]
            : t.memberIds.filter((id) => id !== userId),
      }))
    );
    setSelectedMemberId(null);
    setAssignedMemberAction(null);
  };

  const removeMemberFromTeams = (userId: string) => {
    setTeams((prev) =>
      prev.map((t) => ({
        ...t,
        memberIds: t.memberIds.filter((id) => id !== userId),
      }))
    );
    setAssignedMemberAction(null);
    setSelectedMemberId(userId);
  };

  const selectUnassignedMember = (userId: string) => {
    setAssignedMemberAction(null);
    setSelectedMemberId((prev) => (prev === userId ? null : userId));
  };

  const onLaunch = async () => {
    if (!user?.id || !group) return;
    if (isFormatComingSoon(format)) {
      showAppAlert('Coming soon', 'This tournament format is not available yet.');
      return;
    }
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
        notes: notes.trim() || null,
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
      <KeyboardAvoidingView
        style={styles.flex1}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 56 : 0}
      >
        <ScrollView
          ref={scrollRef}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingTop: 14,
            paddingBottom: insets.bottom + 120,
          }}
        >
        <Text style={styles.stepProg}>
          Step {stepNumber} of {totalSteps}
        </Text>

        {step === 'basic' ? (
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
              const disabled = !!f.comingSoon;
              return (
                <Pressable
                  key={f.key}
                  style={[
                    styles.formatCard,
                    on && !disabled && styles.formatCardOn,
                    disabled && styles.formatCardDisabled,
                  ]}
                  disabled={disabled}
                  onPress={() => setFormat(f.key)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.formatTitle, disabled && styles.formatTitleDisabled]}>
                      {f.title}
                    </Text>
                    <Text style={[styles.formatSub, disabled && styles.formatSubDisabled]}>{f.sub}</Text>
                    {disabled ? (
                      <Text style={styles.formatDisabledNote}>Coming soon</Text>
                    ) : null}
                  </View>
                  {on && !disabled ? <IconCheckmark size={20} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.primaryBtn, !name.trim() && styles.btnDisabled]}
              disabled={!name.trim()}
              onPress={() => goToStep('settings')}
            >
              <Text style={styles.primaryBtnTxt}>Continue</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'settings' ? (
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
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLbl}>Use SimCap handicap</Text>
              <View style={styles.toggleRight}>
                <Text style={styles.toggleVal}>{useHandicap ? 'On' : 'Off'}</Text>
                <Switch
                  value={useHandicap}
                  onValueChange={(next) => {
                    handicapTouchedRef.current = true;
                    setUseHandicap(next);
                  }}
                  trackColor={{ false: colors.pillBorder, true: colors.sage }}
                  thumbColor={Platform.OS === 'android' ? colors.surface : undefined}
                  ios_backgroundColor={colors.pillBorder}
                />
              </View>
            </View>
            <Text style={styles.helper}>Adjusts scores using each player&apos;s SimCap index</Text>
            <View
              onLayout={(e) => {
                notesSectionYRef.current = e.nativeEvent.layout.y;
              }}
            >
              <Text style={styles.lbl}>Tournament notes (optional)</Text>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. Pebble Beach only, white tees, auto 2-putt"
                placeholderTextColor={colors.subtle}
                multiline
                maxLength={500}
                onFocus={() => {
                  requestAnimationFrame(() => {
                    scrollRef.current?.scrollTo({
                      y: Math.max(0, notesSectionYRef.current - 24),
                      animated: true,
                    });
                  });
                }}
              />
            </View>
            <Pressable
              style={styles.primaryBtn}
              onPress={() => goToStep(needsTeams ? 'teams' : 'review')}
            >
              <Text style={styles.primaryBtnTxt}>Continue</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'teams' && needsTeams ? (
          <>
            <Text style={styles.head}>Assign Teams</Text>
            <Text style={styles.helper}>
              Select an unassigned player, then add them to a team. Tap someone on a team to remove or
              move them.
            </Text>
            <Pressable style={styles.outlineBtn} onPress={onAutoBalance}>
              <Text style={styles.outlineBtnTxt}>Auto-balance</Text>
            </Pressable>

            <Text style={styles.sectionLbl}>Unassigned players</Text>
            {unassignedMembers.length === 0 ? (
              <Text style={styles.helper}>Everyone is on a team.</Text>
            ) : (
              unassignedMembers.map((m) => (
                <Pressable
                  key={m.userId}
                  style={[styles.memberRow, selectedMemberId === m.userId && styles.memberRowOn]}
                  onPress={() => selectUnassignedMember(m.userId)}
                >
                  <View style={styles.memberAv}>
                    <Text style={styles.memberAvTxt}>{m.initials}</Text>
                  </View>
                  <Text style={styles.memberName}>{m.displayName}</Text>
                  <Text style={styles.memberIdx}>{m.index != null ? m.index.toFixed(1) : '—'}</Text>
                </Pressable>
              ))
            )}

            <Text style={[styles.sectionLbl, { marginTop: 16 }]}>Teams</Text>
            {teams.map((t) => (
              <View key={t.id} style={styles.teamBucket}>
                <TextInput
                  style={styles.teamNameInput}
                  value={t.name}
                  onChangeText={(v) =>
                    setTeams((prev) => prev.map((x) => (x.id === t.id ? { ...x, name: v } : x)))
                  }
                />
                {selectedMemberId && unassignedMembers.some((m) => m.userId === selectedMemberId) ? (
                  <Pressable
                    style={styles.addToTeamBtn}
                    onPress={() => assignMemberToTeam(selectedMemberId, t.id)}
                  >
                    <Text style={styles.addToTeamBtnTxt}>Add to {t.name}</Text>
                  </Pressable>
                ) : null}
                <View style={styles.teamMembersCol}>
                  {t.memberIds.length === 0 ? (
                    <Text style={styles.teamEmptyTxt}>No players yet</Text>
                  ) : (
                    t.memberIds.map((uid) => {
                      const m = members.find((x) => x.userId === uid);
                      const showActions =
                        assignedMemberAction?.userId === uid &&
                        assignedMemberAction.fromTeamId === t.id;
                      return (
                        <View key={uid} style={styles.assignedMemberBlock}>
                          <Pressable
                            style={[styles.chip, showActions && styles.chipOn]}
                            onPress={() =>
                              setAssignedMemberAction((prev) =>
                                prev?.userId === uid && prev.fromTeamId === t.id
                                  ? null
                                  : { userId: uid, fromTeamId: t.id }
                              )
                            }
                          >
                            <Text style={styles.chipTxt}>
                              {m?.displayName ?? uid}
                              {m?.index != null ? ` · ${m.index.toFixed(1)}` : ''}
                            </Text>
                          </Pressable>
                          {showActions ? (
                            <View style={styles.memberActions}>
                              <Pressable
                                style={styles.memberActionBtn}
                                onPress={() => removeMemberFromTeams(uid)}
                              >
                                <Text style={styles.memberActionRemove}>Remove from team</Text>
                              </Pressable>
                              {teams
                                .filter((other) => other.id !== t.id)
                                .map((other) => (
                                  <Pressable
                                    key={other.id}
                                    style={styles.memberActionBtn}
                                    onPress={() => assignMemberToTeam(uid, other.id)}
                                  >
                                    <Text style={styles.memberActionMove}>Move to {other.name}</Text>
                                  </Pressable>
                                ))}
                            </View>
                          ) : null}
                        </View>
                      );
                    })
                  )}
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
              onPress={() => goToStep('review')}
            >
              <Text style={styles.primaryBtnTxt}>Continue</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'review' ? (
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
              {notes.trim() ? (
                <Text style={styles.summaryMeta}>Notes: {notes.trim()}</Text>
              ) : null}
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
      </KeyboardAvoidingView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
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
  notesInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.bg,
    minHeight: 88,
    textAlignVertical: 'top',
    marginBottom: 8,
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
  formatCardDisabled: { opacity: 0.55, backgroundColor: colors.bg },
  formatTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  formatTitleDisabled: { color: colors.subtle },
  formatSub: { fontSize: 13, color: colors.muted, marginTop: 4, lineHeight: 18 },
  formatSubDisabled: { color: colors.subtle },
  formatDisabledNote: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.subtle,
    marginTop: 8,
  },
  sectionLbl: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 4,
  },
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
  toggleRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggleLbl: { fontSize: 15, fontWeight: '600', color: colors.ink, flex: 1, paddingRight: 8 },
  toggleVal: { fontSize: 15, fontWeight: '700', color: colors.sage, minWidth: 28 },
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
  teamMembersCol: { gap: 8 },
  teamEmptyTxt: { fontSize: 13, color: colors.muted, fontStyle: 'italic' },
  addToTeamBtn: {
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.header,
    alignItems: 'center',
  },
  addToTeamBtnTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  assignedMemberBlock: { gap: 6 },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.header,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipOn: { borderWidth: 2, borderColor: colors.sage },
  chipTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
  memberActions: { gap: 6, paddingLeft: 4 },
  memberActionBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  memberActionRemove: { fontSize: 12, fontWeight: '700', color: colors.danger },
  memberActionMove: { fontSize: 12, fontWeight: '700', color: colors.accentDark },
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
