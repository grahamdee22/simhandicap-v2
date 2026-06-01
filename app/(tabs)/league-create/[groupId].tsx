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
import { createLeague, fetchLeaguesForGroup, syncLeagueStatuses, type LeagueFormat } from '../../../src/lib/leagues';
import { generateMatchPlayBracket } from '../../../src/lib/matchPlayTournamentPairings';
import {
  isBracketPlayerCount,
  MATCH_PLAY_BRACKET_SIZE_ERROR,
} from '../../../src/lib/matchPlayBracket';
import { validateBestBallTeamSizes } from '../../../src/lib/bestBallTournament';
import {
  computeScrambleTeamIndex,
  validateScrambleDesignatedScorers,
  validateScrambleTeamSizes,
  type ScrambleTeamDraft,
} from '../../../src/lib/scrambleTournament';
import { TOURNAMENT_FORMAT_COPY } from '../../../src/lib/tournamentFormatCopy';
import {
  autoAssignMembersToTeams,
  createEmptyTeams,
  CUSTOM_TEAM_COUNT_MAX,
  CUSTOM_TEAM_COUNT_MIN,
  describeTeamCountOption,
  PRESET_TEAM_COUNT_OPTIONS,
  suggestTeamCount,
  validateCustomTeamCountInput,
  type TeamFormat,
} from '../../../src/lib/tournamentTeamCount';
import { useResponsive } from '../../../src/lib/responsive';
import { useAppStore } from '../../../src/store/useAppStore';

const MIN_GROUP_MEMBERS_FOR_TEAM_FORMATS = 4;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type WizardStep = 'basic' | 'teamCount' | 'settings' | 'teams' | 'review';

function defaultEndDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 28);
  return d;
}

const DEFAULT_USE_HANDICAP = true;
const DEFAULT_TEAM_COUNT = 2;

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
  const [scrambleHandicapOverride, setScrambleHandicapOverride] = useState('');
  const [useHandicap, setUseHandicap] = useState(DEFAULT_USE_HANDICAP);
  const [notes, setNotes] = useState('');
  const [teamCount, setTeamCount] = useState(DEFAULT_TEAM_COUNT);
  const [teamCountMode, setTeamCountMode] = useState<'preset' | 'custom'>('preset');
  const [customTeamInput, setCustomTeamInput] = useState('');
  const [customTeamExpanded, setCustomTeamExpanded] = useState(false);
  const [teams, setTeams] = useState(() => createEmptyTeams(DEFAULT_TEAM_COUNT));
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
    setScrambleHandicapOverride('');
    setUseHandicap(DEFAULT_USE_HANDICAP);
    setTeamCount(DEFAULT_TEAM_COUNT);
    setTeamCountMode('preset');
    setCustomTeamInput('');
    setCustomTeamExpanded(false);
    setTeams(createEmptyTeams(DEFAULT_TEAM_COUNT));
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

  const teamFormatsDisabled = members.length < MIN_GROUP_MEMBERS_FOR_TEAM_FORMATS;

  useEffect(() => {
    if (teamFormatsDisabled && isTeamFormat(format)) {
      setFormat('stroke');
    }
  }, [format, teamFormatsDisabled]);

  const isMatchPlay = format === 'match_play';
  const isScramble = format === 'scramble';
  const isBestBall = format === 'best_ball';

  const needsTeams = isTeamFormat(format);
  const teamFormat = needsTeams ? (format as TeamFormat) : null;
  const teamCountSuggestion = useMemo(
    () => (teamFormat ? suggestTeamCount(members.length, teamFormat) : null),
    [teamFormat, members.length]
  );
  const customTeamCountError = useMemo(() => {
    if (!teamFormat || teamCountMode !== 'custom') return null;
    return validateCustomTeamCountInput(customTeamInput, members.length, teamFormat);
  }, [teamFormat, teamCountMode, customTeamInput, members.length]);

  const teamCountValid = useMemo(() => {
    if (!teamFormat || !teamCountSuggestion) return false;
    if (teamCountMode === 'custom') {
      return customTeamCountError === null && customTeamInput.trim().length > 0;
    }
    return teamCountSuggestion.validPreset.includes(
      teamCount as (typeof PRESET_TEAM_COUNT_OPTIONS)[number]
    );
  }, [teamFormat, teamCountSuggestion, teamCountMode, customTeamCountError, customTeamInput, teamCount]);
  const bracketEligible = isBracketPlayerCount(members.length);

  const seededUserIds = useMemo(
    () =>
      [...members]
        .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
        .map((m) => m.userId),
    [members]
  );

  const assignedMemberIds = useMemo(() => new Set(teams.flatMap((t) => t.memberIds)), [teams]);

  const unassignedMembers = useMemo(
    () => members.filter((m) => !assignedMemberIds.has(m.userId)),
    [members, assignedMemberIds]
  );
  const stepSequence = useMemo((): WizardStep[] => {
    if (needsTeams) return ['basic', 'teamCount', 'settings', 'teams', 'review'];
    return ['basic', 'settings', 'review'];
  }, [needsTeams]);

  const applyTeamCount = useCallback((count: number) => {
    setTeamCount(count);
    setTeams(createEmptyTeams(count));
    setSelectedMemberId(null);
    setAssignedMemberAction(null);
  }, []);

  const selectPresetTeamCount = useCallback(
    (count: number) => {
      setTeamCountMode('preset');
      setCustomTeamExpanded(false);
      applyTeamCount(count);
    },
    [applyTeamCount]
  );

  const openCustomTeamCount = useCallback(
    (defaultCount: number) => {
      setTeamCountMode('custom');
      setCustomTeamExpanded(true);
      const n = Math.min(
        CUSTOM_TEAM_COUNT_MAX,
        Math.max(CUSTOM_TEAM_COUNT_MIN, defaultCount)
      );
      setCustomTeamInput(String(n));
      applyTeamCount(n);
    },
    [applyTeamCount]
  );

  useEffect(() => {
    if (!teamFormat || !teamCountSuggestion || teamCountMode === 'custom') return;
    const { validPreset, suggested, validCustom } = teamCountSuggestion;
    if (validPreset.length === 0 && validCustom.length > 0) {
      setTeamCountMode('custom');
      setCustomTeamExpanded(true);
      const n = teamCountSuggestion.suggestedCustomDefault;
      setCustomTeamInput(String(n));
      applyTeamCount(n);
      return;
    }
    if (validPreset.length === 0) return;
    const preset = teamCount as (typeof PRESET_TEAM_COUNT_OPTIONS)[number];
    if (!validPreset.includes(preset)) {
      applyTeamCount(suggested);
    }
  }, [teamFormat, teamCountSuggestion, teamCount, teamCountMode, applyTeamCount]);

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
    if (needsTeams) return members.every((m) => assignedMemberIds.has(m.userId));
    return true;
  }, [needsTeams, members, assignedMemberIds]);

  const emptyTeams = useMemo(() => teams.filter((t) => t.memberIds.length === 0), [teams]);

  const teamsStepCanContinue = useMemo(() => {
    if (!needsTeams) return true;
    if (emptyTeams.length > 0) return false;
    if (!allAssigned) return false;
    return teams.every((t) => t.memberIds.length >= 2);
  }, [needsTeams, emptyTeams, allAssigned, teams]);

  const syncTeamScorer = (t: ScrambleTeamDraft, memberIds: string[]): string | null => {
    if (!isScramble) return t.designatedScorerUserId;
    if (memberIds.length === 0) return null;
    if (t.designatedScorerUserId && memberIds.includes(t.designatedScorerUserId)) {
      return t.designatedScorerUserId;
    }
    return memberIds[0] ?? null;
  };

  const onAutoAssignTeams = () => {
    const next = autoAssignMembersToTeams(
      members.map((m) => m.userId),
      teamCount,
      isScramble
    );
    setTeams(
      next.map((t, i) => ({
        ...t,
        name: teams[i]?.name ?? t.name,
      }))
    );
    setSelectedMemberId(null);
    setAssignedMemberAction(null);
  };

  const assignMemberToTeam = (userId: string, teamId: string) => {
    setTeams((prev) =>
      prev.map((t) => {
        const memberIds =
          t.id === teamId
            ? [...t.memberIds.filter((id) => id !== userId), userId]
            : t.memberIds.filter((id) => id !== userId);
        return {
          ...t,
          memberIds,
          designatedScorerUserId: syncTeamScorer(t, memberIds),
        };
      })
    );
    setSelectedMemberId(null);
    setAssignedMemberAction(null);
  };

  const removeMemberFromTeams = (userId: string) => {
    setTeams((prev) =>
      prev.map((t) => {
        const memberIds = t.memberIds.filter((id) => id !== userId);
        return {
          ...t,
          memberIds,
          designatedScorerUserId: syncTeamScorer(t, memberIds),
        };
      })
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
    if (needsTeams && !teamsStepCanContinue) {
      showAppAlert('Invalid teams', 'Assign every player to a team with at least 2 per team.');
      return;
    }
    if (isMatchPlay && !bracketEligible) {
      showAppAlert('Invalid field', MATCH_PLAY_BRACKET_SIZE_ERROR);
      return;
    }
    if (isScramble) {
      const sizeErr = validateScrambleTeamSizes(teams);
      if (sizeErr) {
        showAppAlert('Invalid teams', sizeErr);
        return;
      }
      const scorerErr = validateScrambleDesignatedScorers(teams);
      if (scorerErr) {
        showAppAlert('Designated scorer', scorerErr);
        return;
      }
    }
    if (isBestBall) {
      const bbErr = validateBestBallTeamSizes(teams);
      if (bbErr) {
        showAppAlert('Invalid teams', bbErr);
        return;
      }
    }
    const existing = await fetchLeaguesForGroup(groupId, googleOAuthAccessToken ?? undefined);
    const synced = await syncLeagueStatuses(
      existing.data ?? [],
      googleOAuthAccessToken ?? undefined
    );
    if (synced.some((l) => l.status === 'active')) {
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
        roundsThatCount: isMatchPlay ? 1 : roundsThatCount,
        useHandicap,
        notes: notes.trim() || null,
        createdBy: user.id,
        members,
        matchPlayPairingMethod: isMatchPlay ? 'bracket' : null,
        matchPlayMatchesThatCount: isMatchPlay ? 1 : null,
        scrambleHandicapOverride: isScramble
          ? scrambleHandicapOverride.trim()
            ? parseFloat(scrambleHandicapOverride)
            : null
          : null,
        teams: needsTeams
          ? teams.map((t) => ({
              name: t.name,
              memberUserIds: t.memberIds,
              designatedScorerUserId: isScramble ? t.designatedScorerUserId : null,
            }))
          : undefined,
      },
      googleOAuthAccessToken ?? undefined
    );
    if (res.error || !res.data) {
      setBusy(false);
      showAppAlert('Could not create tournament', res.error ?? 'Unknown error');
      return;
    }
    if (isMatchPlay) {
      const bracket = await generateMatchPlayBracket(
        res.data.id,
        seededUserIds,
        googleOAuthAccessToken ?? undefined
      );
      setBusy(false);
      if (bracket.error) {
        showAppAlert(
          'Tournament created',
          `Bracket could not be generated: ${bracket.error}. Use Manage tournament to try again.`
        );
      } else {
        showAppAlert('Tournament created', 'Bracket is ready — lowest index is the #1 seed.');
      }
    } else {
      setBusy(false);
      showAppAlert('Tournament created', 'Members will see it in their group.');
    }
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
            {TOURNAMENT_FORMAT_COPY.map((f) => {
              const on = format === f.key;
              const needsFour = isTeamFormat(f.key) && teamFormatsDisabled;
              const needsBracketCount = f.key === 'match_play' && !bracketEligible;
              const disabled = needsFour || needsBracketCount;
              return (
                <Pressable
                  key={f.key}
                  style={[
                    styles.formatCard,
                    on && !disabled && styles.formatCardOn,
                    disabled && styles.formatCardDisabled,
                  ]}
                  disabled={disabled}
                  onPress={() => {
                    setFormat(f.key);
                    if (isTeamFormat(f.key)) {
                      const suggestion = suggestTeamCount(members.length, f.key as TeamFormat);
                      setTeamCountMode('preset');
                      setCustomTeamExpanded(false);
                      setCustomTeamInput('');
                      if (
                        suggestion.validPreset.length === 0 &&
                        suggestion.validCustom.length > 0
                      ) {
                        setTeamCountMode('custom');
                        setCustomTeamExpanded(true);
                        const n = suggestion.suggestedCustomDefault;
                        setCustomTeamInput(String(n));
                        applyTeamCount(n);
                      } else {
                        applyTeamCount(suggestion.suggested);
                      }
                    }
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.formatTitle, disabled && styles.formatTitleDisabled]}>
                      {f.title}
                    </Text>
                    <Text style={[styles.formatSub, disabled && styles.formatSubDisabled]}>{f.sub}</Text>
                    {needsFour ? (
                      <Text style={styles.formatDisabledNote}>
                        Requires at least {MIN_GROUP_MEMBERS_FOR_TEAM_FORMATS} group members.
                      </Text>
                    ) : null}
                    {needsBracketCount ? (
                      <Text style={styles.formatDisabledNote}>{MATCH_PLAY_BRACKET_SIZE_ERROR}</Text>
                    ) : null}
                  </View>
                  {on && !disabled ? <IconCheckmark size={20} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.primaryBtn, !name.trim() && styles.btnDisabled]}
              disabled={!name.trim()}
              onPress={() => {
                if (needsTeams && teamCountSuggestion) {
                  setTeamCountMode('preset');
                  setCustomTeamExpanded(false);
                  setCustomTeamInput('');
                  if (
                    teamCountSuggestion.validPreset.length === 0 &&
                    teamCountSuggestion.validCustom.length > 0
                  ) {
                    setTeamCountMode('custom');
                    setCustomTeamExpanded(true);
                    const n = teamCountSuggestion.suggestedCustomDefault;
                    setCustomTeamInput(String(n));
                    applyTeamCount(n);
                  } else {
                    applyTeamCount(teamCountSuggestion.suggested);
                  }
                  goToStep('teamCount');
                } else {
                  goToStep('settings');
                }
              }}
            >
              <Text style={styles.primaryBtnTxt}>Continue</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'teamCount' && needsTeams && teamFormat && teamCountSuggestion ? (
          <>
            <Text style={styles.head}>Number of teams</Text>
            <Text style={styles.helper}>
              {members.length} players in this group. Choose how many teams to split into — you
              can assign players on the next step.
            </Text>
            {teamCountSuggestion.alternateHint ? (
              <Text style={styles.helper}>{teamCountSuggestion.alternateHint}</Text>
            ) : null}
            {PRESET_TEAM_COUNT_OPTIONS.map((count) => {
              const on = teamCountMode === 'preset' && teamCount === count;
              const { title, sub, disabled } = describeTeamCountOption(
                members.length,
                count,
                teamFormat
              );
              const isSuggested =
                !disabled &&
                teamCountMode !== 'custom' &&
                teamCountSuggestion.suggested === count;
              return (
                <Pressable
                  key={count}
                  style={[
                    styles.formatCard,
                    on && !disabled && styles.formatCardOn,
                    disabled && styles.formatCardDisabled,
                  ]}
                  disabled={disabled}
                  onPress={() => selectPresetTeamCount(count)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.formatTitle, disabled && styles.formatTitleDisabled]}>
                      {title}
                    </Text>
                    <Text style={[styles.formatSub, disabled && styles.formatSubDisabled]}>
                      {sub}
                    </Text>
                    {isSuggested ? (
                      <Text style={styles.formatSuggestedNote}>Suggested</Text>
                    ) : null}
                  </View>
                  {on && !disabled ? <IconCheckmark size={20} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
            {teamCountSuggestion.showsCustom ? (
              <>
                <Pressable
                  style={[
                    styles.formatCard,
                    teamCountMode === 'custom' && styles.formatCardOn,
                  ]}
                  onPress={() => openCustomTeamCount(teamCountSuggestion.suggestedCustomDefault)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formatTitle}>Custom</Text>
                    <Text style={styles.formatSub}>
                      {CUSTOM_TEAM_COUNT_MIN}–{CUSTOM_TEAM_COUNT_MAX} teams
                    </Text>
                    {teamCountSuggestion.suggested >= CUSTOM_TEAM_COUNT_MIN &&
                    (teamCountSuggestion.validPreset.length === 0 ||
                      teamCountSuggestion.suggested > 4) ? (
                      <Text style={styles.formatSuggestedNote}>Suggested</Text>
                    ) : null}
                  </View>
                  {teamCountMode === 'custom' && !customTeamCountError ? (
                    <IconCheckmark size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
                {customTeamExpanded && teamCountMode === 'custom' ? (
                  <View style={styles.customTeamInputBlock}>
                    <Text style={styles.lbl}>Number of teams</Text>
                    <TextInput
                      style={styles.input}
                      value={customTeamInput}
                      onChangeText={(v) => {
                        setCustomTeamInput(v);
                        const err = validateCustomTeamCountInput(
                          v,
                          members.length,
                          teamFormat
                        );
                        const n = err ? null : Number(v.trim());
                        if (n != null) applyTeamCount(n);
                      }}
                      placeholder={`${CUSTOM_TEAM_COUNT_MIN}–${CUSTOM_TEAM_COUNT_MAX}`}
                      placeholderTextColor={colors.subtle}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                    {customTeamCountError ? (
                      <Text style={styles.helper}>{customTeamCountError}</Text>
                    ) : customTeamInput.trim() ? (
                      <Text style={styles.helper}>
                        {describeTeamCountOption(
                          members.length,
                          teamCount,
                          teamFormat
                        ).sub}
                      </Text>
                    ) : (
                      <Text style={styles.helper}>
                        Enter how many teams to create (max {CUSTOM_TEAM_COUNT_MAX}).
                      </Text>
                    )}
                  </View>
                ) : null}
              </>
            ) : null}
            {teamCountSuggestion.validPreset.length === 0 &&
            teamCountSuggestion.validCustom.length === 0 ? (
              <Text style={styles.helper}>
                {isScramble
                  ? 'Scramble requires equal team sizes. Try adding or removing a player to enable team options.'
                  : 'This group size cannot be split evenly into teams with at least 2 players each.'}
              </Text>
            ) : null}
            <Pressable
              style={[styles.primaryBtn, !teamCountValid && styles.btnDisabled]}
              disabled={!teamCountValid}
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
            {isMatchPlay ? (
              <View style={styles.bracketInfo}>
                <Text style={styles.bracketInfoTitle}>Single-elimination bracket</Text>
                <Text style={styles.helper}>
                  Players are seeded by SimCap index (#1 = lowest). The bracket is generated
                  automatically when you launch.
                </Text>
                <Text style={styles.helper}>
                  Seeds:{' '}
                  {seededUserIds
                    .map((uid, i) => {
                      const m = members.find((x) => x.userId === uid);
                      const idx = m?.index != null ? m.index.toFixed(1) : '—';
                      return `#${i + 1} ${m?.displayName ?? 'Player'} (${idx})`;
                    })
                    .join(' · ')}
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.lbl}>Rounds that count toward standings</Text>
                <View style={styles.stepperRow}>
                  <Pressable
                    style={styles.stepperBtn}
                    onPress={() => setRoundsThatCount((n) => Math.max(1, n - 1))}
                  >
                    <Text style={styles.stepperBtnTxt}>−</Text>
                  </Pressable>
                  <Text style={styles.stepperVal}>{roundsThatCount}</Text>
                  <Pressable
                    style={styles.stepperBtn}
                    onPress={() => setRoundsThatCount((n) => Math.min(10, n + 1))}
                  >
                    <Text style={styles.stepperBtnTxt}>+</Text>
                  </Pressable>
                </View>
                <Text style={styles.helper}>e.g. best {roundsThatCount} of 6 rounds count</Text>
              </>
            )}
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
            {isScramble ? (
              <>
                <Text style={[styles.lbl, { marginTop: 12 }]}>
                  Override team handicap (optional)
                </Text>
                <TextInput
                  style={styles.input}
                  value={scrambleHandicapOverride}
                  onChangeText={setScrambleHandicapOverride}
                  placeholder="Leave blank for automatic calculation"
                  placeholderTextColor={colors.subtle}
                  keyboardType="decimal-pad"
                />
                <Text style={styles.helper}>
                  SimCap calculates team handicap automatically using the 15%/85% formula. Only change
                  this if your group uses a custom handicap.
                </Text>
              </>
            ) : null}
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
              {isScramble
                ? 'Scramble requires even-sized teams (2, 4, 6…). Pick one designated scorer per team — only they log team rounds.'
                : isBestBall
                  ? 'Each player logs their own round. The best score on each hole counts for the team. Standings update as teammates submit.'
                  : 'Select an unassigned player, then add them to a team. Tap someone on a team to remove or move them.'}
            </Text>
            <Pressable style={styles.outlineBtn} onPress={onAutoAssignTeams}>
              <Text style={styles.outlineBtnTxt}>Auto-assign teams</Text>
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
                <View style={styles.teamBucketHead}>
                  <TextInput
                    style={[styles.teamNameInput, { flex: 1 }]}
                    value={t.name}
                    onChangeText={(v) =>
                      setTeams((prev) => prev.map((x) => (x.id === t.id ? { ...x, name: v } : x)))
                    }
                  />
                </View>
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
                {isScramble && t.memberIds.length >= 2 ? (
                  <View style={styles.scorerBlock}>
                    <Text style={styles.scorerLbl}>Designated scorer</Text>
                    <View style={styles.scorerRow}>
                      {t.memberIds.map((uid) => {
                        const m = members.find((x) => x.userId === uid);
                        const on = t.designatedScorerUserId === uid;
                        return (
                          <Pressable
                            key={uid}
                            style={[styles.scorerChip, on && styles.scorerChipOn]}
                            onPress={() =>
                              setTeams((prev) =>
                                prev.map((x) =>
                                  x.id === t.id ? { ...x, designatedScorerUserId: uid } : x
                                )
                              )
                            }
                          >
                            <Text style={[styles.scorerChipTxt, on && styles.scorerChipTxtOn]}>
                              {m?.displayName ?? 'Player'}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {(() => {
                      const idxs = t.memberIds
                        .map((uid) => members.find((m) => m.userId === uid)?.index)
                        .filter((v): v is number => v != null);
                      const teamIdx = computeScrambleTeamIndex(idxs);
                      return teamIdx != null ? (
                        <Text style={styles.teamIdxLine}>Team index (15%/85%): {teamIdx.toFixed(1)}</Text>
                      ) : null;
                    })()}
                  </View>
                ) : null}
              </View>
            ))}
            {!teamsStepCanContinue && allAssigned ? (
              <Text style={styles.helper}>Each team needs at least 2 players.</Text>
            ) : null}
            <Pressable
              style={[styles.primaryBtn, !teamsStepCanContinue && styles.btnDisabled]}
              disabled={!teamsStepCanContinue}
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
                {isMatchPlay
                  ? `Bracket · ${members.length} players · Handicap ${useHandicap ? 'on' : 'off'}`
                  : `Best ${roundsThatCount} rounds · Handicap ${useHandicap ? 'on' : 'off'}`}
              </Text>
              {notes.trim() ? (
                <Text style={styles.summaryMeta}>Notes: {notes.trim()}</Text>
              ) : null}
              {needsTeams ? (
                <Text style={styles.summaryMeta}>
                  {teamCount} teams · {members.length} players
                </Text>
              ) : null}
              {needsTeams
                ? teams.map((t) => {
                    const scorer = members.find((m) => m.userId === t.designatedScorerUserId);
                    return (
                      <Text key={t.id} style={styles.summaryMeta}>
                        {t.name}: {t.memberIds.length} players
                        {isScramble && scorer
                          ? ` · scorer: ${scorer.displayName.replace(' (you)', '')}`
                          : ''}
                      </Text>
                    );
                  })
                : null}
              {isMatchPlay
                ? seededUserIds.map((uid, i) => {
                    const m = members.find((x) => x.userId === uid);
                    return (
                      <Text key={uid} style={styles.summaryMeta}>
                        Seed {i + 1}: {m?.displayName ?? 'Player'}
                        {m?.index != null ? ` (${m.index.toFixed(1)})` : ''}
                      </Text>
                    );
                  })
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
  formatSuggestedNote: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.sage,
    marginTop: 8,
  },
  customTeamInputBlock: {
    marginTop: -4,
    marginBottom: 10,
    paddingHorizontal: 4,
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
  scorerBlock: { marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  scorerLbl: { fontSize: 11, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginBottom: 8 },
  scorerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scorerChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
  },
  scorerChipOn: { backgroundColor: colors.header, borderColor: colors.header },
  scorerChipTxt: { fontSize: 12, fontWeight: '600', color: colors.ink },
  scorerChipTxtOn: { color: '#fff' },
  teamIdxLine: { fontSize: 12, color: colors.muted, marginTop: 8 },
  teamBucketHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  deleteTeamBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  deleteTeamBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.danger },
  matchLbl: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  matchSlots: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  matchSlot: { flex: 1, gap: 6 },
  matchSlotLbl: { fontSize: 11, fontWeight: '600', color: colors.muted, textTransform: 'uppercase' },
  matchVs: { fontSize: 13, fontWeight: '700', color: colors.muted, paddingTop: 16 },
  bracketInfo: {
    marginTop: 8,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  bracketInfoTitle: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 6 },
});
