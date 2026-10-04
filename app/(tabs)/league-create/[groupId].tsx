import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  FlatList,
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
import { DatePlayedField } from '../../../src/components/DatePlayedField';
import { IconCheckmark } from '../../../src/components/SvgUiIcons';
import { HandicapSourceBadge } from '../../../src/components/HandicapSourceBadge';
import { confirmAppChoice, showAppAlert } from '../../../src/lib/alertCompat';
import { dateFromYmdLocal, todayLocalYmd, ymdFromParts } from '../../../src/lib/dates';
import { countMembersMissingHandicap } from '../../../src/lib/effectiveHandicap';
import { colors } from '../../../src/lib/constants';
import { getCourseById } from '../../../src/lib/courses';
import { curatedPickerCourses } from '../../../src/lib/communityCourses';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import { createLeague, fetchLeaguesForGroup, syncLeagueStatuses, type LeagueFormat } from '../../../src/lib/leagues';
import { isLeagueActive } from '../../../src/lib/leagueStandings';
import { resolveSocialGroupsAccessToken } from '../../../src/lib/socialGroups';
import { fetchActiveSeasonForGroup, type DbLeagueSeasonRow } from '../../../src/lib/seasons';
import { generateMatchPlayBracket } from '../../../src/lib/matchPlayTournamentPairings';
import {
  getMatchPlayFormatDisabledMessage,
  MATCH_PLAY_MAX_PLAYERS,
  MATCH_PLAY_MIN_PLAYERS,
  MATCH_PLAY_TOO_MANY_PLAYERS_ERROR,
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
  CUSTOM_PLAYERS_PER_TEAM_MIN,
  describePlayersPerTeamOption,
  formatTeamCountResult,
  isValidPlayersPerTeam,
  maxPlayersPerTeam,
  PRESET_PLAYERS_PER_TEAM_OPTIONS,
  suggestPlayersPerTeam,
  validateCustomPlayersPerTeamInput,
  type TeamFormat,
} from '../../../src/lib/tournamentTeamCount';
import { useResponsive } from '../../../src/lib/responsive';
import { clearTournamentSectionCache } from '../../../src/lib/tournamentSectionCache';
import { useAppStore } from '../../../src/store/useAppStore';

const MIN_GROUP_MEMBERS_FOR_TEAM_FORMATS = 4;
/** Show roster search once the group is facility-scale. */
const PLAYER_ROSTER_SEARCH_MIN = 15;

function isTeamFormat(key: LeagueFormat): boolean {
  return key === 'scramble' || key === 'best_ball';
}

function playersStepValidationMessage(
  format: LeagueFormat,
  selectedCount: number
): string | null {
  if (selectedCount < 1) return 'Select at least one player.';
  if (format === 'match_play') {
    if (selectedCount > MATCH_PLAY_MAX_PLAYERS) return MATCH_PLAY_TOO_MANY_PLAYERS_ERROR;
    if (selectedCount < MATCH_PLAY_MIN_PLAYERS) {
      return `Match Play needs at least ${MATCH_PLAY_MIN_PLAYERS} players (currently ${selectedCount}).`;
    }
    if (selectedCount % 2 !== 0) {
      return `Match Play needs an even number of players (currently ${selectedCount}).`;
    }
    return null;
  }
  if (isTeamFormat(format) && selectedCount < MIN_GROUP_MEMBERS_FOR_TEAM_FORMATS) {
    return `Requires at least ${MIN_GROUP_MEMBERS_FOR_TEAM_FORMATS} players (currently ${selectedCount}).`;
  }
  return null;
}

function formatYmdDisplay(ymd: string): string {
  return dateFromYmdLocal(ymd).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type WizardStep = 'basic' | 'players' | 'teamCount' | 'settings' | 'teams' | 'review';

function defaultEndDateYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 28);
  return ymdFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const DEFAULT_USE_HANDICAP = true;
const DEFAULT_PLAYERS_PER_TEAM = 2;

export default function LeagueCreateScreen() {
  const { groupId: rawGroupId } = useLocalSearchParams<{ groupId: string | string[] }>();
  const groupId = typeof rawGroupId === 'string' ? rawGroupId : rawGroupId?.[0] ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user } = useAuth();
  const groups = useAppStore((s) => s.groups);

  const group = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId]);
  const groupMembers = useMemo(
    () => group?.members.filter((m) => m.userId) ?? [],
    [group?.members]
  );

  const [step, setStep] = useState<WizardStep>('basic');
  const [name, setName] = useState('');
  const [format, setFormat] = useState<LeagueFormat>('stroke');
  const [holesPerRound, setHolesPerRound] = useState<'18' | '9'>('18');
  const [matchPlayNine, setMatchPlayNine] = useState<'front' | 'back' | null>(null);
  const [tournamentCourseId, setTournamentCourseId] = useState<string | null>(null);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [courseSearch, setCourseSearch] = useState('');
  const [createGate, setCreateGate] = useState<'pending' | 'ready' | 'blocked'>('pending');
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Record<string, boolean>>({});
  const [playerSearch, setPlayerSearch] = useState('');
  const [startDateYmd, setStartDateYmd] = useState(todayLocalYmd);
  const [endDateYmd, setEndDateYmd] = useState(defaultEndDateYmd);
  const [roundsThatCount, setRoundsThatCount] = useState(4);
  const [scrambleHandicapOverride, setScrambleHandicapOverride] = useState('');
  const [useHandicap, setUseHandicap] = useState(DEFAULT_USE_HANDICAP);
  const [notes, setNotes] = useState('');
  const [playersPerTeam, setPlayersPerTeam] = useState(DEFAULT_PLAYERS_PER_TEAM);
  const [teamCount, setTeamCount] = useState(2);
  const [playersPerTeamMode, setPlayersPerTeamMode] = useState<'preset' | 'custom'>('preset');
  const [customPlayersPerTeamInput, setCustomPlayersPerTeamInput] = useState('');
  const [customPlayersPerTeamExpanded, setCustomPlayersPerTeamExpanded] = useState(false);
  const [teams, setTeams] = useState(() => createEmptyTeams(2));
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [assignedMemberAction, setAssignedMemberAction] = useState<{
    userId: string;
    fromTeamId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeSeason, setActiveSeason] = useState<DbLeagueSeasonRow | null>(null);
  const [joinSeason, setJoinSeason] = useState(true);
  const [infoSheet, setInfoSheet] = useState<'season' | 'scorer' | null>(null);
  const handicapTouchedRef = useRef(false);
  const launchInFlightRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const notesSectionYRef = useRef(0);

  const selectAllGroupMembers = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const m of groupMembers) next[m.userId] = true;
    setSelectedPlayerIds(next);
  }, [groupMembers]);

  const resetWizard = useCallback(() => {
    handicapTouchedRef.current = false;
    setStep('basic');
    setName('');
    setFormat('stroke');
    setHolesPerRound('18');
    setMatchPlayNine(null);
    setTournamentCourseId(null);
    setCoursePickerOpen(false);
    setCourseSearch('');
    setPlayerSearch('');
    setStartDateYmd(todayLocalYmd());
    setEndDateYmd(defaultEndDateYmd());
    setRoundsThatCount(4);
    setScrambleHandicapOverride('');
    setUseHandicap(DEFAULT_USE_HANDICAP);
    setPlayersPerTeam(DEFAULT_PLAYERS_PER_TEAM);
    setTeamCount(2);
    setPlayersPerTeamMode('preset');
    setCustomPlayersPerTeamInput('');
    setCustomPlayersPerTeamExpanded(false);
    setTeams(createEmptyTeams(2));
    setSelectedMemberId(null);
    setAssignedMemberAction(null);
    setBusy(false);
    setJoinSeason(true);
    const roster = useAppStore.getState().groups.find((g) => g.id === groupId)?.members ?? [];
    const next: Record<string, boolean> = {};
    for (const m of roster) {
      if (m.userId) next[m.userId] = true;
    }
    setSelectedPlayerIds(next);
  }, [groupId]);

  useLayoutEffect(() => {
    resetWizard();
  }, [groupId, resetWizard]);

  useFocusEffect(
    useCallback(() => {
      if (launchInFlightRef.current) return;
      resetWizard();
    }, [resetWizard])
  );

  useEffect(() => {
    if (step === 'settings' && !handicapTouchedRef.current) {
      setUseHandicap(DEFAULT_USE_HANDICAP);
    }
  }, [step]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetchActiveSeasonForGroup(groupId, googleOAuthAccessToken ?? undefined);
      if (!alive) return;
      setActiveSeason(res.data);
    })();
    return () => {
      alive = false;
    };
  }, [groupId]);

  useEffect(() => {
    let alive = true;
    setCreateGate('pending');
    void (async () => {
      const token =
        googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
      const existing = await fetchLeaguesForGroup(groupId, token);
      if (!alive) return;
      const blocked = (existing.data ?? []).some(
        (league) => league.status === 'active' && isLeagueActive(league)
      );
      if (blocked) {
        setCreateGate('blocked');
        showAppAlert(
          'Active tournament',
          'This crew already has an active tournament. End it before creating another.'
        );
        router.replace('/(tabs)/groups' as never);
        return;
      }
      setCreateGate('ready');
    })();
    return () => {
      alive = false;
    };
  }, [groupId, router]);

  useEffect(() => {
    if (format !== 'match_play') {
      setMatchPlayNine(null);
    }
  }, [format]);

  const nineSelectionIncomplete =
    format === 'match_play' && holesPerRound === '9' && matchPlayNine == null;
  const settingsIncomplete = nineSelectionIncomplete || !tournamentCourseId;
  const courseChoices = useMemo(() => curatedPickerCourses(courseSearch), [courseSearch]);

  /** Keep selection keys aligned with the group roster (new joins default on). */
  useEffect(() => {
    setSelectedPlayerIds((prev) => {
      const next = { ...prev };
      let changed = false;
      const ids = new Set(groupMembers.map((m) => m.userId));
      for (const m of groupMembers) {
        if (!(m.userId in next)) {
          next[m.userId] = true;
          changed = true;
        }
      }
      for (const id of Object.keys(next)) {
        if (!ids.has(id)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [groupMembers]);

  const playingMembers = useMemo(
    () => groupMembers.filter((m) => selectedPlayerIds[m.userId] !== false),
    [groupMembers, selectedPlayerIds]
  );
  const playerCount = playingMembers.length;

  /** Format cards on Basic: only block if the group cannot possibly satisfy the format. */
  const teamFormatsDisabled = groupMembers.length < MIN_GROUP_MEMBERS_FOR_TEAM_FORMATS;
  const matchPlayFormatCardDisabled = groupMembers.length < MATCH_PLAY_MIN_PLAYERS;

  useEffect(() => {
    if (teamFormatsDisabled && isTeamFormat(format)) {
      setFormat('stroke');
    }
  }, [format, teamFormatsDisabled]);

  useEffect(() => {
    if (matchPlayFormatCardDisabled && format === 'match_play') {
      setFormat('stroke');
    }
  }, [format, matchPlayFormatCardDisabled]);

  const isMatchPlay = format === 'match_play';
  const isScramble = format === 'scramble';
  const isBestBall = format === 'best_ball';

  const needsTeams = isTeamFormat(format);
  const teamFormat = needsTeams ? (format as TeamFormat) : null;
  const teamSizeSuggestion = useMemo(
    () => (teamFormat ? suggestPlayersPerTeam(playerCount, teamFormat) : null),
    [teamFormat, playerCount]
  );
  const customPlayersPerTeamError = useMemo(() => {
    if (!teamFormat || playersPerTeamMode !== 'custom') return null;
    return validateCustomPlayersPerTeamInput(
      customPlayersPerTeamInput,
      playerCount,
      teamFormat
    );
  }, [teamFormat, playersPerTeamMode, customPlayersPerTeamInput, playerCount]);

  const teamSizeValid = useMemo(() => {
    if (!teamFormat || !teamSizeSuggestion) return false;
    if (playersPerTeamMode === 'custom') {
      return customPlayersPerTeamError === null && customPlayersPerTeamInput.trim().length > 0;
    }
    return teamSizeSuggestion.validPreset.includes(
      playersPerTeam as (typeof PRESET_PLAYERS_PER_TEAM_OPTIONS)[number]
    );
  }, [
    teamFormat,
    teamSizeSuggestion,
    playersPerTeamMode,
    customPlayersPerTeamError,
    customPlayersPerTeamInput,
    playersPerTeam,
  ]);
  const matchPlayDisabledMessage = getMatchPlayFormatDisabledMessage(playerCount);
  const playersStepError = playersStepValidationMessage(format, playerCount);

  const seededUserIds = useMemo(
    () =>
      [...playingMembers]
        .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
        .map((m) => m.userId),
    [playingMembers]
  );

  const assignedMemberIds = useMemo(() => new Set(teams.flatMap((t) => t.memberIds)), [teams]);

  const unassignedMembers = useMemo(
    () => playingMembers.filter((m) => !assignedMemberIds.has(m.userId)),
    [playingMembers, assignedMemberIds]
  );
  const stepSequence = useMemo((): WizardStep[] => {
    if (needsTeams) return ['basic', 'players', 'teamCount', 'settings', 'teams', 'review'];
    return ['basic', 'players', 'settings', 'review'];
  }, [needsTeams]);

  const applyPlayersPerTeam = useCallback(
    (pp: number, playerTotal: number) => {
      const count = playerTotal / pp;
      setPlayersPerTeam(pp);
      setTeamCount(count);
      setTeams(createEmptyTeams(count));
      setSelectedMemberId(null);
      setAssignedMemberAction(null);
    },
    []
  );

  const selectPresetPlayersPerTeam = useCallback(
    (pp: number) => {
      setPlayersPerTeamMode('preset');
      setCustomPlayersPerTeamExpanded(false);
      applyPlayersPerTeam(pp, playerCount);
    },
    [applyPlayersPerTeam, playerCount]
  );

  const openCustomPlayersPerTeam = useCallback(
    (defaultPp: number) => {
      setPlayersPerTeamMode('custom');
      setCustomPlayersPerTeamExpanded(true);
      setCustomPlayersPerTeamInput(String(defaultPp));
      applyPlayersPerTeam(defaultPp, playerCount);
    },
    [applyPlayersPerTeam, playerCount]
  );

  useEffect(() => {
    if (!teamFormat || !teamSizeSuggestion || playersPerTeamMode === 'custom') return;
    const { validPreset, suggestedPlayersPerTeam, hasAnyValid } = teamSizeSuggestion;
    if (!hasAnyValid) return;
    if (
      validPreset.length === 0 &&
      isValidPlayersPerTeam(playerCount, teamSizeSuggestion.suggestedCustomDefault, teamFormat)
    ) {
      setPlayersPerTeamMode('custom');
      setCustomPlayersPerTeamExpanded(true);
      const pp = teamSizeSuggestion.suggestedCustomDefault;
      setCustomPlayersPerTeamInput(String(pp));
      applyPlayersPerTeam(pp, playerCount);
      return;
    }
    if (validPreset.length === 0) return;
    const preset = playersPerTeam as (typeof PRESET_PLAYERS_PER_TEAM_OPTIONS)[number];
    if (!validPreset.includes(preset)) {
      applyPlayersPerTeam(suggestedPlayersPerTeam, playerCount);
    }
  }, [
    teamFormat,
    teamSizeSuggestion,
    playersPerTeam,
    playersPerTeamMode,
    applyPlayersPerTeam,
    playerCount,
  ]);

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
    if (needsTeams) return playingMembers.every((m) => assignedMemberIds.has(m.userId));
    return true;
  }, [needsTeams, playingMembers, assignedMemberIds]);

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

  /** Drop deselected players from team drafts. */
  useEffect(() => {
    const allowed = new Set(playingMembers.map((m) => m.userId));
    setTeams((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        const memberIds = t.memberIds.filter((id) => allowed.has(id));
        if (memberIds.length !== t.memberIds.length) changed = true;
        return {
          ...t,
          memberIds,
          designatedScorerUserId: syncTeamScorer(t, memberIds),
        };
      });
      return changed ? next : prev;
    });
    setSelectedMemberId((id) => (id && allowed.has(id) ? id : null));
    setAssignedMemberAction((a) => (a && allowed.has(a.userId) ? a : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when roster selection changes
  }, [playingMembers]);

  const filteredGroupMembers = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    if (!q) return groupMembers;
    return groupMembers.filter((m) =>
      m.displayName.replace(' (you)', '').toLowerCase().includes(q)
    );
  }, [groupMembers, playerSearch]);

  const allPlayersSelected =
    groupMembers.length > 0 && groupMembers.every((m) => selectedPlayerIds[m.userId] !== false);

  const togglePlayerSelected = (userId: string) => {
    setSelectedPlayerIds((prev) => ({
      ...prev,
      [userId]: prev[userId] === false,
    }));
  };

  const selectAllPlayers = () => selectAllGroupMembers();
  const deselectAllPlayers = () => {
    const next: Record<string, boolean> = {};
    for (const m of groupMembers) next[m.userId] = false;
    setSelectedPlayerIds(next);
  };

  const prepareTeamCountFromSelection = () => {
    if (!needsTeams || !teamFormat) return;
    const suggestion = suggestPlayersPerTeam(playerCount, teamFormat);
    setPlayersPerTeamMode('preset');
    setCustomPlayersPerTeamExpanded(false);
    setCustomPlayersPerTeamInput('');
    if (
      suggestion.validPreset.length === 0 &&
      isValidPlayersPerTeam(playerCount, suggestion.suggestedCustomDefault, teamFormat)
    ) {
      setPlayersPerTeamMode('custom');
      setCustomPlayersPerTeamExpanded(true);
      const pp = suggestion.suggestedCustomDefault;
      setCustomPlayersPerTeamInput(String(pp));
      applyPlayersPerTeam(pp, playerCount);
    } else {
      applyPlayersPerTeam(suggestion.suggestedPlayersPerTeam, playerCount);
    }
  };

  const runAutoAssignTeams = (randomizeMissingHandicap: boolean) => {
    const assignMembers = playingMembers.map((m) => ({
      userId: m.userId,
      handicap: m.index,
    }));
    const next = autoAssignMembersToTeams(assignMembers, teamCount, isScramble, {
      randomizeMissingHandicap,
    });
    setTeams(
      next.map((t, i) => ({
        ...t,
        name: teams[i]?.name ?? t.name,
      }))
    );
    setSelectedMemberId(null);
    setAssignedMemberAction(null);
  };

  const onAutoAssignTeams = () => {
    const missing = countMembersMissingHandicap(playingMembers);
    if (missing > 0) {
      void confirmAppChoice(
        'Missing handicap',
        `${missing} player${missing === 1 ? '' : 's'} have no handicap index. They will be assigned randomly. You can ask them to enter their GHIN on their profile, or proceed anyway.`,
        { cancelText: 'Go back', confirmText: 'Proceed anyway' }
      ).then((choice) => {
        if (choice === 'confirm') runAutoAssignTeams(true);
      });
      return;
    }
    runAutoAssignTeams(false);
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
    if (!user?.id || !group) {
      showAppAlert('Could not create tournament', 'Sign in again, then open this from your crew.');
      return;
    }
    if (needsTeams && !teamsStepCanContinue) {
      showAppAlert('Invalid teams', 'Assign every player to a team with at least 2 per team.');
      return;
    }
    if (isMatchPlay && matchPlayDisabledMessage) {
      showAppAlert('Invalid field', matchPlayDisabledMessage);
      return;
    }
    if (isMatchPlay && holesPerRound === '9' && !matchPlayNine) {
      showAppAlert('Which nine?', 'Choose Front 9 or Back 9 for this Match Play tournament.');
      return;
    }
    if (!tournamentCourseId) {
      showAppAlert('Course', 'Choose the course this tournament is played at.');
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
    launchInFlightRef.current = true;
    setBusy(true);
    try {
      const existing = await fetchLeaguesForGroup(groupId, googleOAuthAccessToken ?? undefined);
      const synced = await syncLeagueStatuses(
        existing.data ?? [],
        googleOAuthAccessToken ?? undefined
      );
      if (synced.some((l) => l.status === 'active')) {
        showAppAlert(
          'Active tournament',
          'This crew already has an active tournament. End it before creating another.'
        );
        router.replace('/(tabs)/groups' as never);
        return;
      }
      const res = await createLeague(
        {
          groupId,
          name,
          format,
          startDate: startDateYmd,
          endDate: endDateYmd,
          roundsThatCount: isMatchPlay ? 1 : roundsThatCount,
          useHandicap,
          notes: notes.trim() || null,
          createdBy: user.id,
          members: playingMembers,
          matchPlayPairingMethod: isMatchPlay ? 'bracket' : null,
          holesPerRound,
          matchPlayNine: isMatchPlay && holesPerRound === '9' ? matchPlayNine : null,
          courseId: tournamentCourseId,
          seasonId: activeSeason && joinSeason ? activeSeason.id : null,
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
        showAppAlert('Could not create tournament', res.error ?? 'Unknown error');
        return;
      }
      let successMessage = 'Members will see it in their group.';
      if (isMatchPlay) {
        const bracket = await generateMatchPlayBracket(
          res.data.id,
          seededUserIds,
          googleOAuthAccessToken ?? undefined
        );
        successMessage = bracket.error
          ? `Bracket could not be generated: ${bracket.error}. Use Manage tournament to try again.`
          : 'Bracket is ready — lowest index is the #1 seed.';
      }
      clearTournamentSectionCache(groupId);
      router.replace('/(tabs)/groups' as never);
      showAppAlert('Tournament created', successMessage);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      showAppAlert('Could not create tournament', message);
    } finally {
      launchInFlightRef.current = false;
      setBusy(false);
    }
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

  if (createGate !== 'ready') {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={{ padding: gutter, paddingTop: 24 }}>
          {createGate === 'blocked' ? (
            <Text style={styles.helper}>
              This crew already has an active tournament. End it before creating another.
            </Text>
          ) : (
            <ActivityIndicator color={colors.header} />
          )}
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
              const needsMatchPlayMin = f.key === 'match_play' && matchPlayFormatCardDisabled;
              const disabled = needsFour || needsMatchPlayMin;
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
                    {needsFour ? (
                      <Text style={styles.formatDisabledNote}>
                        Requires at least {MIN_GROUP_MEMBERS_FOR_TEAM_FORMATS} group members.
                      </Text>
                    ) : null}
                    {needsMatchPlayMin ? (
                      <Text style={styles.formatDisabledNote}>
                        Requires at least {MATCH_PLAY_MIN_PLAYERS} group members.
                      </Text>
                    ) : null}
                  </View>
                  {on && !disabled ? <IconCheckmark size={20} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.primaryBtn, !name.trim() && styles.btnDisabled]}
              disabled={!name.trim()}
              onPress={() => goToStep('players')}
            >
              <Text style={styles.primaryBtnTxt}>Continue</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'players' ? (
          <>
            <Text style={styles.head}>Who's playing?</Text>
            <Text style={styles.helper}>
              Everyone in the group is included by default. Uncheck anyone who's sitting this one
              out.
            </Text>
            <View style={styles.selectAllRow}>
              <Pressable
                onPress={() => (allPlayersSelected ? deselectAllPlayers() : selectAllPlayers())}
                accessibilityRole="button"
                accessibilityLabel={allPlayersSelected ? 'Deselect all' : 'Select all'}
              >
                <Text style={styles.selectAllTxt}>
                  {allPlayersSelected ? 'Deselect all' : 'Select all'}
                </Text>
              </Pressable>
            </View>
            {groupMembers.length >= PLAYER_ROSTER_SEARCH_MIN ? (
              <>
                <Text style={styles.lbl}>Search</Text>
                <TextInput
                  style={[styles.input, { marginBottom: 10 }]}
                  value={playerSearch}
                  onChangeText={setPlayerSearch}
                  placeholder="Filter by name"
                  placeholderTextColor={colors.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
              </>
            ) : null}
            {filteredGroupMembers.map((m) => {
              const checked = selectedPlayerIds[m.userId] !== false;
              return (
                <Pressable
                  key={m.userId}
                  style={[styles.memberRow, checked && styles.memberRowOn]}
                  onPress={() => togglePlayerSelected(m.userId)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                >
                  <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
                    {checked ? <IconCheckmark size={14} color="#fff" /> : null}
                  </View>
                  <View style={styles.memberAv}>
                    <Text style={styles.memberAvTxt}>{m.initials}</Text>
                  </View>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {m.displayName.replace(' (you)', '')}
                  </Text>
                  {m.index != null ? (
                    <Text style={styles.memberIdx}>{m.index.toFixed(1)}</Text>
                  ) : (
                    <Text style={styles.memberIdx}>—</Text>
                  )}
                </Pressable>
              );
            })}
            <Text style={styles.selectedCount}>
              {playerCount} selected.
            </Text>
            {playersStepError ? (
              <Text style={styles.formatDisabledNote}>{playersStepError}</Text>
            ) : null}
            <Pressable
              style={[styles.primaryBtn, !!playersStepError && styles.btnDisabled]}
              disabled={!!playersStepError}
              onPress={() => {
                if (needsTeams) {
                  prepareTeamCountFromSelection();
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

        {step === 'teamCount' && needsTeams && teamFormat && teamSizeSuggestion ? (
          <>
            <Text style={styles.head}>Players per team</Text>
            <Text style={styles.helper}>
              {playerCount} players selected. Choose how many players are on each team — SimCap will
              create the teams. You can assign players on the next step.
            </Text>
            {PRESET_PLAYERS_PER_TEAM_OPTIONS.map((pp) => {
              const on = playersPerTeamMode === 'preset' && playersPerTeam === pp;
              const { title, sub, disabled } = describePlayersPerTeamOption(
                playingMembers.length,
                pp,
                teamFormat
              );
              const isSuggested =
                !disabled &&
                playersPerTeamMode !== 'custom' &&
                teamSizeSuggestion.suggestedPlayersPerTeam === pp;
              return (
                <Pressable
                  key={pp}
                  style={[
                    styles.formatCard,
                    on && !disabled && styles.formatCardOn,
                    disabled && styles.formatCardDisabled,
                  ]}
                  disabled={disabled}
                  onPress={() => selectPresetPlayersPerTeam(pp)}
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
            {teamSizeSuggestion.showsCustom ? (
              <>
                <Pressable
                  style={[
                    styles.formatCard,
                    playersPerTeamMode === 'custom' && styles.formatCardOn,
                  ]}
                  onPress={() =>
                    openCustomPlayersPerTeam(teamSizeSuggestion.suggestedCustomDefault)
                  }
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formatTitle}>Custom</Text>
                    <Text style={styles.formatSub}>
                      {CUSTOM_PLAYERS_PER_TEAM_MIN}–{maxPlayersPerTeam(playingMembers.length)} players per
                      team
                    </Text>
                    {teamSizeSuggestion.suggestedPlayersPerTeam >= CUSTOM_PLAYERS_PER_TEAM_MIN &&
                    (teamSizeSuggestion.validPreset.length === 0 ||
                      !PRESET_PLAYERS_PER_TEAM_OPTIONS.includes(
                        teamSizeSuggestion.suggestedPlayersPerTeam as (typeof PRESET_PLAYERS_PER_TEAM_OPTIONS)[number]
                      )) ? (
                      <Text style={styles.formatSuggestedNote}>Suggested</Text>
                    ) : null}
                  </View>
                  {playersPerTeamMode === 'custom' && !customPlayersPerTeamError ? (
                    <IconCheckmark size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
                {customPlayersPerTeamExpanded && playersPerTeamMode === 'custom' ? (
                  <View style={styles.customTeamInputBlock}>
                    <Text style={styles.lbl}>Players per team</Text>
                    <TextInput
                      style={styles.input}
                      value={customPlayersPerTeamInput}
                      onChangeText={(v) => {
                        setCustomPlayersPerTeamInput(v);
                        const err = validateCustomPlayersPerTeamInput(
                          v,
                          playingMembers.length,
                          teamFormat
                        );
                        const n = err ? null : Number(v.trim());
                        if (n != null) applyPlayersPerTeam(n, playingMembers.length);
                      }}
                      placeholder={`${CUSTOM_PLAYERS_PER_TEAM_MIN}–${maxPlayersPerTeam(playingMembers.length)}`}
                      placeholderTextColor={colors.subtle}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                    {customPlayersPerTeamError ? (
                      <Text style={styles.helper}>{customPlayersPerTeamError}</Text>
                    ) : customPlayersPerTeamInput.trim() ? (
                      <Text style={styles.helper}>
                        {formatTeamCountResult(playingMembers.length, playersPerTeam)}
                      </Text>
                    ) : (
                      <Text style={styles.helper}>
                        Enter players per team (min {CUSTOM_PLAYERS_PER_TEAM_MIN}).
                      </Text>
                    )}
                  </View>
                ) : null}
              </>
            ) : null}
            {teamSizeValid ? (
              <Text style={[styles.helper, { marginTop: 8, fontWeight: '600' }]}>
                {formatTeamCountResult(playingMembers.length, playersPerTeam)}
              </Text>
            ) : null}
            {!teamSizeSuggestion.hasAnyValid ? (
              <Text style={styles.helper}>
                This player count cannot be split evenly into teams with at least 2 players each. Try
                selecting a different number of players to enable team options.
              </Text>
            ) : null}
            <Pressable
              style={[styles.primaryBtn, !teamSizeValid && styles.btnDisabled]}
              disabled={!teamSizeValid}
              onPress={() => goToStep('settings')}
            >
              <Text style={styles.primaryBtnTxt}>Continue</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'settings' ? (
          <>
            <Text style={styles.head}>Settings</Text>
            <Text style={styles.lbl}>Holes per round</Text>
                <View style={styles.dayRow}>
                  {(
                    [
                      { key: '18' as const, title: '18 holes', sub: 'Full round' },
                      { key: '9' as const, title: '9 holes', sub: 'Front or Back' },
                    ] as const
                  ).map((opt) => {
                    const on = holesPerRound === opt.key;
                    return (
                      <Pressable
                        key={opt.key}
                        style={[styles.dayBtn, on && styles.dayBtnOn]}
                        onPress={() => {
                          setHolesPerRound(opt.key);
                          if (opt.key === '18') setMatchPlayNine(null);
                        }}
                      >
                        <Text style={[styles.dayDn, on && styles.dayDnOn]}>{opt.title}</Text>
                        <Text style={[styles.dayDs, on && styles.dayDsOn]}>{opt.sub}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {isMatchPlay && holesPerRound === '9' ? (
                  <>
                    <Text style={[styles.lbl, { marginTop: 12 }]}>Which nine?</Text>
                    <Text style={styles.helper}>
                      Everyone in the bracket plays the same nine so hole scores line up.
                    </Text>
                    <View style={styles.dayRow}>
                      {(
                        [
                          { key: 'front' as const, title: 'Front 9', sub: 'Holes 1–9' },
                          { key: 'back' as const, title: 'Back 9', sub: 'Holes 10–18' },
                        ] as const
                      ).map((opt) => {
                        const on = matchPlayNine === opt.key;
                        return (
                          <Pressable
                            key={opt.key}
                            style={[styles.dayBtn, on && styles.dayBtnOn]}
                            onPress={() => setMatchPlayNine(opt.key)}
                          >
                            <Text style={[styles.dayDn, on && styles.dayDnOn]}>{opt.title}</Text>
                            <Text style={[styles.dayDs, on && styles.dayDsOn]}>{opt.sub}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {nineSelectionIncomplete ? (
                      <Text style={styles.formatDisabledNote}>Choose Front 9 or Back 9.</Text>
                    ) : null}
                  </>
                ) : null}
            <Text style={[styles.lbl, { marginTop: 12 }]}>Course</Text>
            <Text style={styles.helper}>
              Everyone logs this tournament at the same verified course.
            </Text>
            {tournamentCourseId ? (
              <View style={styles.courseSelectedRow}>
                <Text style={styles.summaryLine}>
                  📍 {getCourseById(tournamentCourseId)?.name ?? 'Selected course'}
                </Text>
                <Pressable
                  onPress={() => {
                    setCourseSearch('');
                    setCoursePickerOpen(true);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Change course"
                >
                  <Text style={styles.courseChange}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={styles.formatDisabledNote}>Choose a course to continue.</Text>
                <Pressable
                  style={styles.courseOpenBtn}
                  onPress={() => {
                    setCourseSearch('');
                    setCoursePickerOpen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Choose course"
                >
                  <Text style={styles.courseOpenBtnTxt}>Choose course</Text>
                </Pressable>
              </>
            )}
            <Modal
              visible={coursePickerOpen}
              animationType={Platform.OS === 'web' ? 'none' : 'fade'}
              transparent
              onRequestClose={() => setCoursePickerOpen(false)}
            >
              <View style={styles.modalRoot}>
                <Pressable
                  style={styles.modalBackdropPress}
                  onPress={() => setCoursePickerOpen(false)}
                />
                <View style={[styles.modalSheet, styles.modalSheetTall]}>
                  <Text style={styles.modalTitle}>Course</Text>
                  <TextInput
                    style={styles.courseSearchInput}
                    value={courseSearch}
                    onChangeText={setCourseSearch}
                    placeholder="Search courses"
                    placeholderTextColor={colors.subtle}
                    autoCapitalize="none"
                    autoCorrect={false}
                    clearButtonMode="while-editing"
                  />
                  <FlatList
                    data={courseChoices}
                    keyExtractor={(c) => c.id}
                    keyboardShouldPersistTaps="handled"
                    style={styles.courseSearchList}
                    ListEmptyComponent={
                      <Text style={styles.courseSearchEmpty}>No courses match that search.</Text>
                    }
                    renderItem={({ item: c }) => {
                      const on = tournamentCourseId === c.id;
                      return (
                        <Pressable
                          style={styles.modalRow}
                          onPress={() => {
                            setTournamentCourseId(c.id);
                            setCourseSearch('');
                            setCoursePickerOpen(false);
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.memberName}>{c.name}</Text>
                            {c.location ? <Text style={styles.helper}>{c.location}</Text> : null}
                          </View>
                          {on ? <Text style={styles.courseChange}>✓</Text> : null}
                        </Pressable>
                      );
                    }}
                  />
                </View>
              </View>
            </Modal>
            <DatePlayedField
              label="Start date"
              hint={null}
              large
              value={startDateYmd}
              onChange={setStartDateYmd}
            />
            <DatePlayedField
              label="End date"
              hint={null}
              large
              value={endDateYmd}
              onChange={setEndDateYmd}
            />
            {isMatchPlay ? (
              <View style={styles.bracketInfo}>
                <Text style={styles.bracketInfoTitle}>Single-elimination bracket</Text>
                <Text style={styles.helper}>
                  Players are seeded by handicap (#1 = lowest). SimCap index is used when
                  established (3+ rounds); otherwise GHIN from their profile. The bracket is
                  generated automatically when you launch.
                </Text>
                <Text style={styles.sectionLbl}>Players</Text>
                {seededUserIds.map((uid, i) => {
                  const m = playingMembers.find((x) => x.userId === uid);
                  return (
                    <View key={uid} style={styles.memberRow}>
                      <Text style={styles.memberSeed}>#{i + 1}</Text>
                      <View style={styles.memberAv}>
                        <Text style={styles.memberAvTxt}>{m?.initials ?? '?'}</Text>
                      </View>
                      <Text style={[styles.memberName, { flex: 1 }]}>
                        {m?.displayName ?? 'Player'}
                      </Text>
                      <Text style={styles.memberIdx}>
                        {m?.index != null ? m.index.toFixed(1) : '—'}
                      </Text>
                      <HandicapSourceBadge source={m?.handicapSource ?? null} />
                    </View>
                  );
                })}
              </View>
            ) : (
              <>
                <Text style={[styles.lbl, { marginTop: 10 }]}>Rounds that count toward standings</Text>
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
            <Text style={styles.helper}>
              Adjusts scores using each player&apos;s effective handicap (SimCap index when
              established, otherwise GHIN)
            </Text>
            {!isMatchPlay && !needsTeams ? (
              <>
                <Text style={[styles.sectionLbl, { marginTop: 12 }]}>Players</Text>
                {playingMembers.map((m) => (
                  <View key={m.userId} style={styles.memberRow}>
                    <View style={styles.memberAv}>
                      <Text style={styles.memberAvTxt}>{m.initials}</Text>
                    </View>
                    <Text style={[styles.memberName, { flex: 1 }]}>{m.displayName}</Text>
                    <Text style={styles.memberIdx}>
                      {m.index != null ? m.index.toFixed(1) : '—'}
                    </Text>
                    <HandicapSourceBadge source={m.handicapSource} />
                  </View>
                ))}
              </>
            ) : null}
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
            {activeSeason ? (
              <View style={styles.toggleRow}>
                <View style={styles.toggleLblRow}>
                  <Text style={styles.toggleLbl}>Part of {activeSeason.name}?</Text>
                  <Pressable
                    style={styles.infoBtn}
                    onPress={() => setInfoSheet('season')}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel="About joining the season"
                  >
                    <Text style={styles.infoBtnTxt}>ⓘ</Text>
                  </Pressable>
                </View>
                <View style={styles.toggleRight}>
                  <Text style={styles.toggleVal}>{joinSeason ? 'Yes' : 'No'}</Text>
                  <Switch
                    value={joinSeason}
                    onValueChange={setJoinSeason}
                    trackColor={{ false: colors.pillBorder, true: colors.sage }}
                    thumbColor={Platform.OS === 'android' ? colors.surface : undefined}
                    ios_backgroundColor={colors.pillBorder}
                  />
                </View>
              </View>
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
              style={[styles.primaryBtn, settingsIncomplete && styles.btnDisabled]}
              disabled={settingsIncomplete}
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
                ? 'Assign every player to a team (at least 2 per team). Pick one designated scorer per team — only they log team rounds.'
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
                  <Text style={[styles.memberName, { flex: 1 }]}>{m.displayName}</Text>
                  <Text style={styles.memberIdx}>
                    {m.index != null ? m.index.toFixed(1) : '—'}
                  </Text>
                  <HandicapSourceBadge source={m.handicapSource} />
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
                      const m = playingMembers.find((x) => x.userId === uid);
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
                            <View style={styles.chipInner}>
                              <Text style={styles.chipTxt}>
                                {m?.displayName ?? uid}
                                {m?.index != null ? ` · ${m.index.toFixed(1)}` : ''}
                              </Text>
                              {m ? <HandicapSourceBadge source={m.handicapSource} /> : null}
                            </View>
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
                    <View style={styles.scorerLblRow}>
                      <Text style={styles.scorerLbl}>Designated scorer</Text>
                      <Pressable
                        style={styles.infoBtn}
                        onPress={() => setInfoSheet('scorer')}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel="About designated scorer"
                      >
                        <Text style={styles.infoBtnTxt}>ⓘ</Text>
                      </Pressable>
                    </View>
                    <View style={styles.scorerRow}>
                      {t.memberIds.map((uid) => {
                        const m = playingMembers.find((x) => x.userId === uid);
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
                        .map((uid) => playingMembers.find((m) => m.userId === uid)?.index)
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
              {tournamentCourseId ? (
                <Text style={styles.summaryMeta}>
                  📍 {getCourseById(tournamentCourseId)?.name ?? 'Course'}
                </Text>
              ) : null}
              <Text style={styles.summaryMeta}>
                {format.replace('_', ' ')} · {formatYmdDisplay(startDateYmd)} – {formatYmdDisplay(endDateYmd)}
              </Text>
              <Text style={styles.summaryMeta}>
                {isMatchPlay
                  ? `Bracket · ${playingMembers.length} players · Handicap ${useHandicap ? 'on' : 'off'}`
                  : `Best ${roundsThatCount} rounds · Handicap ${useHandicap ? 'on' : 'off'}`}
                {holesPerRound === '9'
                  ? ` · 9 holes${
                      isMatchPlay
                        ? ` (${matchPlayNine === 'back' ? 'Back 9' : 'Front 9'})`
                        : ''
                    }`
                  : ''}
              </Text>
              {notes.trim() ? (
                <Text style={styles.summaryMeta}>Notes: {notes.trim()}</Text>
              ) : null}
              {activeSeason ? (
                <Text style={styles.summaryMeta}>
                  {joinSeason ? `Season: ${activeSeason.name}` : 'Not part of the season'}
                </Text>
              ) : null}
              {needsTeams ? (
                <Text style={styles.summaryMeta}>
                  {formatTeamCountResult(playingMembers.length, playersPerTeam)} · {playingMembers.length}{' '}
                  players
                </Text>
              ) : null}
              {needsTeams
                ? teams.map((t) => {
                    const scorer = playingMembers.find((m) => m.userId === t.designatedScorerUserId);
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
                    const m = playingMembers.find((x) => x.userId === uid);
                    const src =
                      m?.handicapSource === 'simcap'
                        ? 'SimCap'
                        : m?.handicapSource === 'ghin'
                          ? 'GHIN'
                          : 'No HCP';
                    return (
                      <Text key={uid} style={styles.summaryMeta}>
                        Seed {i + 1}: {m?.displayName ?? 'Player'}
                        {m?.index != null ? ` (${m.index.toFixed(1)})` : ''} · {src}
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

      <Modal
        visible={infoSheet != null}
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        transparent
        onRequestClose={() => setInfoSheet(null)}
      >
        <View style={styles.infoExplainRoot}>
          <Pressable style={styles.infoExplainBackdrop} onPress={() => setInfoSheet(null)} />
          <View style={[styles.infoExplainSheet, { paddingBottom: insets.bottom + 16 }]}>
            {infoSheet === 'season' ? (
              <>
                <Text style={styles.infoExplainTitle}>Part of the season?</Text>
                <Text style={styles.infoExplainBody}>
                  When this is on, this tournament&apos;s results count toward the season&apos;s standings. Turn it
                  off for a one-off event you don&apos;t want affecting the season.
                </Text>
              </>
            ) : null}
            {infoSheet === 'scorer' ? (
              <>
                <Text style={styles.infoExplainTitle}>Designated scorer</Text>
                <Text style={styles.infoExplainBody}>
                  Your team plays one ball, so there&apos;s only one score per hole. Only the Designated scorer can
                  open the team&apos;s scorecard and enter scores — make sure it&apos;s whoever&apos;s actually
                  keeping score for your group, or your team&apos;s results won&apos;t get entered.
                </Text>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
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
  toggleLblRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  toggleLbl: { fontSize: 15, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  toggleVal: { fontSize: 15, fontWeight: '700', color: colors.sage, minWidth: 28 },
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
  scorerLblRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dayRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  dayBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
    alignItems: 'center',
  },
  dayBtnOn: { backgroundColor: colors.accentSoft, borderColor: colors.sage },
  dayDn: { fontSize: 14, fontWeight: '700', color: colors.muted },
  dayDnOn: { color: colors.accentDark },
  dayDs: { fontSize: 11, color: colors.subtle, marginTop: 2 },
  dayDsOn: { color: colors.accent },
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
  selectAllRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  selectAllTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accentDark,
  },
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
  selectedCount: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    marginTop: 8,
    marginBottom: 4,
  },
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
  chipInner: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  chipTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
  memberSeed: { width: 22, fontSize: 12, fontWeight: '700', color: colors.muted },
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
  courseList: { maxHeight: 220, flexGrow: 0, overflow: 'hidden' },
  courseSelectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  courseChange: { fontSize: 14, fontWeight: '700', color: colors.sage },
  courseOpenBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  courseOpenBtnTxt: { fontSize: 15, fontWeight: '700', color: colors.ink },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalBackdropPress: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  modalSheetTall: { maxHeight: '70%' },
  modalTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: colors.ink },
  courseSearchInput: {
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 8,
  },
  courseSearchList: { flexGrow: 0, maxHeight: 360 },
  courseSearchEmpty: { fontSize: 14, color: colors.muted, paddingVertical: 16, textAlign: 'center' },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 8,
  },
  courseRow: {
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  courseRowOn: { backgroundColor: '#f0f7f3' },
  summaryLine: { fontSize: 18, fontWeight: '700', color: colors.ink },
  summaryMeta: { fontSize: 13, color: colors.muted, marginTop: 6 },
  scorerBlock: { marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  scorerLbl: { fontSize: 11, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
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
