import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
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
import { HeaderBackButton } from '../../../src/components/HeaderBackButton';
import { IconCheckmark } from '../../../src/components/SvgUiIcons';
import { HandicapSourceBadge } from '../../../src/components/HandicapSourceBadge';
import { UnverifiedCourseBadge } from '../../../src/components/UnverifiedCourseBadge';
import { useTranslation } from '../../../src/i18n';
import { confirmAppChoice, showAppAlert } from '../../../src/lib/alertCompat';
import { dateFromYmdLocal, todayLocalYmd, ymdFromParts } from '../../../src/lib/dates';
import { countMembersMissingHandicap } from '../../../src/lib/effectiveHandicap';
import { colors } from '../../../src/lib/constants';
import { navigateBackOrFallback } from '../../../src/lib/navigateBack';
import {
  curatedPickerCourses,
  fetchCommunityCoursesForPicker,
  mergePickerCourses,
  type CommunityCourseRow,
} from '../../../src/lib/communityCourses';
import { fetchCourseAliases, type CourseAlias } from '../../../src/lib/courseAliases';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import { createLeague, fetchLeaguesForGroup, type DbLeagueRow, type LeagueFormat } from '../../../src/lib/leagues';
import { dateRangesOverlap, formatLeagueDateRange, isLeagueActive } from '../../../src/lib/leagueStandings';
import {
  createGroupChallenge,
  GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS,
  GROUP_CHALLENGE_ROSTER_SIZE,
  lookupGroupsForChallenge,
  type GroupChallengeVerificationMode,
} from '../../../src/lib/groupChallenges';
import { resolveSocialGroupsAccessToken } from '../../../src/lib/socialGroups';
import { getCourseById } from '../../../src/lib/courses';
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
  selectedCount: number,
  t: (key: string, opts?: Record<string, unknown>) => string
): string | null {
  if (selectedCount < 1) return t('league.create.selectAtLeastOne');
  if (format === 'match_play') {
    if (selectedCount > MATCH_PLAY_MAX_PLAYERS) return MATCH_PLAY_TOO_MANY_PLAYERS_ERROR;
    if (selectedCount < MATCH_PLAY_MIN_PLAYERS) {
      return t('league.create.matchPlayNeedsMin', {
        min: MATCH_PLAY_MIN_PLAYERS,
        count: selectedCount,
      });
    }
    if (selectedCount % 2 !== 0) {
      return t('league.create.matchPlayNeedsEven', { count: selectedCount });
    }
    return null;
  }
  if (isTeamFormat(format) && selectedCount < MIN_GROUP_MEMBERS_FOR_TEAM_FORMATS) {
    return t('league.create.requiresAtLeastPlayers', {
      min: MIN_GROUP_MEMBERS_FOR_TEAM_FORMATS,
      count: selectedCount,
    });
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

type WizardStep =
  | 'basic'
  | 'opponent'
  | 'players'
  | 'teamCount'
  | 'settings'
  | 'teams'
  | 'review';

function defaultEndDateYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 28);
  return ymdFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function dayAfterYmd(ymd: string): string {
  const d = dateFromYmdLocal(ymd);
  d.setDate(d.getDate() + 1);
  return ymdFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function endDateFromStartYmd(startYmd: string, daySpan = 28): string {
  const d = dateFromYmdLocal(startYmd);
  d.setDate(d.getDate() + daySpan);
  return ymdFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function suggestedDatesFromActiveLeagues(leagues: DbLeagueRow[]): { start: string; end: string } {
  const running = leagues.find((l) => l.status === 'active' && isLeagueActive(l));
  if (running) {
    const start = dayAfterYmd(running.end_date);
    return { start, end: endDateFromStartYmd(start) };
  }
  return { start: todayLocalYmd(), end: defaultEndDateYmd() };
}

const DEFAULT_USE_HANDICAP = true;
const DEFAULT_PLAYERS_PER_TEAM = 2;

export default function LeagueCreateScreen() {
  const { t } = useTranslation();
  const { groupId: rawGroupId } = useLocalSearchParams<{ groupId: string | string[] }>();
  const groupId = typeof rawGroupId === 'string' ? rawGroupId : rawGroupId?.[0] ?? '';
  const router = useRouter();
  const navigation = useNavigation();
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
  const [isGroupChallenge, setIsGroupChallenge] = useState(false);
  const [opponentQuery, setOpponentQuery] = useState('');
  const [opponentResults, setOpponentResults] = useState<{ id: string; name: string }[]>([]);
  const [opponentSearching, setOpponentSearching] = useState(false);
  const [opponentGroup, setOpponentGroup] = useState<{ id: string; name: string } | null>(null);
  const [verificationMode, setVerificationMode] =
    useState<GroupChallengeVerificationMode>('verified');
  const [challengeTeeName, setChallengeTeeName] = useState<string | null>(null);
  const [holesPerRound, setHolesPerRound] = useState<'18' | '9'>('18');
  const [matchPlayNine, setMatchPlayNine] = useState<'front' | 'back' | null>(null);
  const [tournamentCourseId, setTournamentCourseId] = useState<string | null>(null);
  const [tournamentCourseName, setTournamentCourseName] = useState<string | null>(null);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [courseSearch, setCourseSearch] = useState('');
  const [courseAliases, setCourseAliases] = useState<CourseAlias[]>([]);
  const [communityCourses, setCommunityCourses] = useState<CommunityCourseRow[]>([]);
  const [createGate, setCreateGate] = useState<'pending' | 'ready'>('pending');
  const [groupActiveLeagues, setGroupActiveLeagues] = useState<DbLeagueRow[]>([]);
  const groupActiveLeaguesRef = useRef<DbLeagueRow[]>([]);
  const [dateError, setDateError] = useState<string | null>(null);
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
    setIsGroupChallenge(false);
    setOpponentQuery('');
    setOpponentResults([]);
    setOpponentSearching(false);
    setOpponentGroup(null);
    setVerificationMode('verified');
    setChallengeTeeName(null);
    setHolesPerRound('18');
    setMatchPlayNine(null);
    setTournamentCourseId(null);
    setTournamentCourseName(null);
    setCoursePickerOpen(false);
    setCourseSearch('');
    setPlayerSearch('');
    const suggested = suggestedDatesFromActiveLeagues(groupActiveLeaguesRef.current);
    setStartDateYmd(suggested.start);
    setEndDateYmd(suggested.end);
    setDateError(null);
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
      const activeStatus = (existing.data ?? []).filter((league) => league.status === 'active');
      groupActiveLeaguesRef.current = activeStatus;
      setGroupActiveLeagues(activeStatus);
      const suggested = suggestedDatesFromActiveLeagues(activeStatus);
      setStartDateYmd(suggested.start);
      setEndDateYmd(suggested.end);
      setDateError(null);
      setCreateGate('ready');
    })();
    return () => {
      alive = false;
    };
  }, [groupId]);

  useEffect(() => {
    groupActiveLeaguesRef.current = groupActiveLeagues;
  }, [groupActiveLeagues]);

  useEffect(() => {
    if (format !== 'match_play') {
      setMatchPlayNine(null);
    }
  }, [format]);

  const nineSelectionIncomplete =
    format === 'match_play' && holesPerRound === '9' && matchPlayNine == null;
  const dateRangeError = useMemo(() => {
    if (startDateYmd > endDateYmd) {
      return t('league.create.endDateAfterStart');
    }
    // Group Challenges are a separate competition type — don't block on league date overlap.
    if (isGroupChallenge) return null;
    for (const other of groupActiveLeagues) {
      if (dateRangesOverlap(startDateYmd, endDateYmd, other.start_date, other.end_date)) {
        return t('league.create.datesOverlap', {
          name: other.name,
          range: formatLeagueDateRange(other.start_date, other.end_date),
        });
      }
    }
    return null;
  }, [startDateYmd, endDateYmd, groupActiveLeagues, isGroupChallenge, t]);
  const settingsIncomplete = nineSelectionIncomplete || !tournamentCourseId || !!dateRangeError;
  // Tournament course-lock: curated + community + aliases. Custom/user-reported
  // courses are excluded — self-reported ratings must not lock tournament scoring.
  const courseChoices = useMemo(
    () =>
      mergePickerCourses(
        curatedPickerCourses(courseSearch),
        communityCourses,
        courseSearch,
        [],
        courseAliases
      ),
    [courseSearch, communityCourses, courseAliases]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const accessToken =
          googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
        const [aliases, community] = await Promise.all([
          fetchCourseAliases(accessToken),
          fetchCommunityCoursesForPicker(accessToken),
        ]);
        if (cancelled) return;
        setCourseAliases(aliases);
        setCommunityCourses(community);
      } catch {
        if (cancelled) return;
        setCourseAliases([]);
        setCommunityCourses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setDateError(null);
  }, [startDateYmd, endDateYmd]);

  /** Keep selection keys aligned with the group roster (new joins default on, off for challenges). */
  useEffect(() => {
    setSelectedPlayerIds((prev) => {
      const next = { ...prev };
      let changed = false;
      const ids = new Set(groupMembers.map((m) => m.userId));
      for (const m of groupMembers) {
        if (!(m.userId in next)) {
          next[m.userId] = !isGroupChallenge;
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
  }, [groupMembers, isGroupChallenge]);

  const playingMembers = useMemo(
    () =>
      groupMembers.filter((m) =>
        isGroupChallenge
          ? selectedPlayerIds[m.userId] === true
          : selectedPlayerIds[m.userId] !== false
      ),
    [groupMembers, selectedPlayerIds, isGroupChallenge]
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
  const playersStepError = useMemo(() => {
    if (isGroupChallenge) {
      if (playerCount !== GROUP_CHALLENGE_ROSTER_SIZE) {
        return t('league.create.groupChallenge.rosterExact', {
          count: GROUP_CHALLENGE_ROSTER_SIZE,
          selected: playerCount,
        });
      }
      return null;
    }
    return playersStepValidationMessage(format, playerCount, t);
  }, [isGroupChallenge, playerCount, format, t]);

  const challengeIneligibleSelected = useMemo(() => {
    if (!isGroupChallenge) return [];
    return playingMembers.filter(
      (m) => (m.roundsLogged ?? 0) < GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS
    );
  }, [isGroupChallenge, playingMembers]);

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
    if (isGroupChallenge) return ['basic', 'opponent', 'players', 'settings', 'review'];
    if (needsTeams) return ['basic', 'players', 'teamCount', 'settings', 'teams', 'review'];
    return ['basic', 'players', 'settings', 'review'];
  }, [isGroupChallenge, needsTeams]);

  const enableGroupChallenge = useCallback(
    (on: boolean) => {
      setIsGroupChallenge(on);
      if (!on) return;
      setFormat('stroke');
      setUseHandicap(true);
      setJoinSeason(false);
      setOpponentGroup(null);
      setOpponentQuery('');
      setOpponentResults([]);
      const next: Record<string, boolean> = {};
      for (const m of groupMembers) next[m.userId] = false;
      setSelectedPlayerIds(next);
    },
    [groupMembers]
  );

  useEffect(() => {
    if (!isGroupChallenge || step !== 'opponent') return;
    const q = opponentQuery.trim();
    if (q.length < 2) {
      setOpponentResults([]);
      return;
    }
    let alive = true;
    setOpponentSearching(true);
    const handle = setTimeout(() => {
      void (async () => {
        const token =
          googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
        const res = await lookupGroupsForChallenge(q, token);
        if (!alive) return;
        setOpponentSearching(false);
        const rows = (res.data ?? []).filter((r) => r.id !== groupId);
        setOpponentResults(rows);
      })();
    }, 280);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [isGroupChallenge, step, opponentQuery, groupId]);

  const challengeCourseTees = useMemo(() => {
    if (!tournamentCourseId) return [];
    return getCourseById(tournamentCourseId)?.tees ?? [];
  }, [tournamentCourseId]);

  useEffect(() => {
    if (!isGroupChallenge) return;
    if (challengeCourseTees.length === 0) {
      setChallengeTeeName(null);
      return;
    }
    setChallengeTeeName((prev) =>
      prev && challengeCourseTees.some((t) => t.name === prev)
        ? prev
        : challengeCourseTees[0]?.name ?? null
    );
  }, [isGroupChallenge, challengeCourseTees]);

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
  const stepIdx = stepSequence.indexOf(step);

  const goToStep = useCallback(
    (next: WizardStep) => {
      if (stepSequence.includes(next)) setStep(next);
    },
    [stepSequence]
  );

  const goBackStep = useCallback(() => {
    if (stepIdx <= 0) return;
    const prev = stepSequence[stepIdx - 1];
    if (prev) setStep(prev);
  }, [stepIdx, stepSequence]);

  const wizardDirty =
    name.trim().length > 0 ||
    format !== 'stroke' ||
    holesPerRound !== '18' ||
    tournamentCourseId != null ||
    notes.trim().length > 0 ||
    step !== 'basic';

  const exitWizard = useCallback(() => {
    navigateBackOrFallback(navigation, router, '/(tabs)/groups' as Href);
  }, [navigation, router]);

  const requestExitWizard = useCallback(() => {
    if (!wizardDirty) {
      exitWizard();
      return;
    }
    void confirmAppChoice(
      t('league.create.discardTitle'),
      t('league.create.discardBody'),
      {
        cancelText: t('league.create.keepEditing'),
        confirmText: t('league.create.discardConfirm'),
      }
    ).then((choice) => {
      if (choice === 'confirm') exitWizard();
    });
  }, [wizardDirty, exitWizard, t]);

  const onWizardHardwareBack = useCallback(() => {
    if (coursePickerOpen) {
      setCoursePickerOpen(false);
      return true;
    }
    if (stepIdx > 0) {
      goBackStep();
      return true;
    }
    requestExitWizard();
    return true;
  }, [coursePickerOpen, stepIdx, goBackStep, requestExitWizard]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', onWizardHardwareBack);
      return () => sub.remove();
    }, [onWizardHardwareBack])
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <HeaderBackButton
          onPress={() => {
            if (stepIdx > 0) goBackStep();
            else requestExitWizard();
          }}
          accessibilityLabel={
            stepIdx > 0 ? t('match.create.goBack') : t('league.create.cancelA11y')
          }
        />
      ),
      headerRight: () => (
        <Pressable
          onPress={requestExitWizard}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ paddingHorizontal: 12, justifyContent: 'center' }}
          accessibilityRole="button"
          accessibilityLabel={t('league.create.cancelA11y')}
        >
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>
            {t('match.create.cancel')}
          </Text>
        </Pressable>
      ),
    });
  }, [navigation, stepIdx, goBackStep, requestExitWizard, t]);

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
        t('league.create.missingHandicapTitle'),
        t('league.create.missingHandicapBody', { count: missing }),
        {
          cancelText: t('match.create.goBack'),
          confirmText: t('league.create.proceedAnyway'),
        }
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
      showAppAlert(t('league.create.couldNotCreate'), t('league.create.signInAgain'));
      return;
    }
    if (isGroupChallenge) {
      if (!opponentGroup) {
        showAppAlert(
          t('league.create.couldNotCreate'),
          t('league.create.groupChallenge.pickOpponent')
        );
        return;
      }
      if (playerCount !== GROUP_CHALLENGE_ROSTER_SIZE) {
        showAppAlert(
          t('league.create.couldNotCreate'),
          t('league.create.groupChallenge.rosterExact', {
            count: GROUP_CHALLENGE_ROSTER_SIZE,
            selected: playerCount,
          })
        );
        return;
      }
      if (challengeIneligibleSelected.length > 0) {
        showAppAlert(
          t('league.create.couldNotCreate'),
          t('league.create.groupChallenge.ineligibleBlock', {
            min: GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS,
          })
        );
        return;
      }
      if (!tournamentCourseId) {
        showAppAlert(t('league.create.courseAlertTitle'), t('league.create.courseAlertBody'));
        return;
      }
      launchInFlightRef.current = true;
      setBusy(true);
      try {
        if (dateRangeError) {
          setDateError(dateRangeError);
          return;
        }
        const rosterMeta: Record<
          string,
          { eligibility: 'eligible' | 'ineligible'; qualifyingRounds: number }
        > = {};
        for (const m of playingMembers) {
          const q = m.roundsLogged ?? 0;
          rosterMeta[m.userId] = {
            eligibility: q >= GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS ? 'eligible' : 'ineligible',
            qualifyingRounds: q,
          };
        }
        const res = await createGroupChallenge(
          {
            name: name.trim(),
            challengingGroupId: groupId,
            challengedGroupId: opponentGroup.id,
            courseId: tournamentCourseId,
            teeName: challengeTeeName,
            holesPerRound,
            verificationMode,
            startDate: startDateYmd,
            endDate: endDateYmd,
            createdBy: user.id,
            notes: notes.trim() || null,
            rosterUserIds: playingMembers.map((m) => m.userId),
            rosterMeta,
          },
          googleOAuthAccessToken ?? undefined
        );
        if (res.error || !res.data) {
          showAppAlert(
            t('league.create.couldNotCreate'),
            res.error ?? t('match.create.alerts.unknownError')
          );
          return;
        }
        clearTournamentSectionCache(groupId);
        router.replace(`/(tabs)/group-challenge/${res.data.id}` as never);
        showAppAlert(
          t('league.create.groupChallenge.sentTitle'),
          t('league.create.groupChallenge.sentBody', { name: opponentGroup.name })
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : t('match.create.alerts.unknownError');
        showAppAlert(t('league.create.couldNotCreate'), message);
      } finally {
        launchInFlightRef.current = false;
        setBusy(false);
      }
      return;
    }
    if (needsTeams && !teamsStepCanContinue) {
      showAppAlert(t('league.create.invalidTeamsTitle'), t('league.create.assignEveryPlayer'));
      return;
    }
    if (isMatchPlay && matchPlayDisabledMessage) {
      showAppAlert(t('league.create.invalidFieldTitle'), matchPlayDisabledMessage);
      return;
    }
    if (isMatchPlay && holesPerRound === '9' && !matchPlayNine) {
      showAppAlert(t('league.create.whichNineAlertTitle'), t('league.create.whichNineAlertBody'));
      return;
    }
    if (!tournamentCourseId) {
      showAppAlert(t('league.create.courseAlertTitle'), t('league.create.courseAlertBody'));
      return;
    }
    if (isScramble) {
      const sizeErr = validateScrambleTeamSizes(teams);
      if (sizeErr) {
        showAppAlert(t('league.create.invalidTeamsTitle'), sizeErr);
        return;
      }
      const scorerErr = validateScrambleDesignatedScorers(teams);
      if (scorerErr) {
        showAppAlert(t('league.create.designatedScorerAlertTitle'), scorerErr);
        return;
      }
    }
    if (isBestBall) {
      const bbErr = validateBestBallTeamSizes(teams);
      if (bbErr) {
        showAppAlert(t('league.create.invalidTeamsTitle'), bbErr);
        return;
      }
    }
    launchInFlightRef.current = true;
    setBusy(true);
    setDateError(null);
    try {
      if (dateRangeError) {
        setDateError(dateRangeError);
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
        const msg = res.error ?? t('match.create.alerts.unknownError');
        if (/overlap/i.test(msg)) {
          setDateError(msg);
          return;
        }
        showAppAlert(t('league.create.couldNotCreate'), msg);
        return;
      }
      let successMessage = t('league.create.membersWillSee');
      if (isMatchPlay) {
        const bracket = await generateMatchPlayBracket(
          res.data.id,
          seededUserIds,
          googleOAuthAccessToken ?? undefined
        );
        successMessage = bracket.error
          ? t('league.create.bracketCouldNotGenerate', { error: bracket.error })
          : t('league.create.bracketReady');
      }
      clearTournamentSectionCache(groupId);
      router.replace('/(tabs)/groups' as never);
      showAppAlert(t('league.create.tournamentCreated'), successMessage);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('match.create.alerts.unknownError');
      showAppAlert(t('league.create.couldNotCreate'), message);
    } finally {
      launchInFlightRef.current = false;
      setBusy(false);
    }
  };

  if (!group) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={{ padding: gutter }}>
          <Text>{t('league.create.groupNotFound')}</Text>
        </View>
      </ContentWidth>
    );
  }

  if (createGate !== 'ready') {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={{ padding: gutter, paddingTop: 24 }}>
          <ActivityIndicator color={colors.header} />
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
          {t('match.create.stepOf', { current: stepNumber, total: totalSteps })}
        </Text>
        {stepIdx > 0 ? (
          <Pressable
            onPress={goBackStep}
            style={styles.wizardBackLink}
            accessibilityRole="button"
            accessibilityLabel={t('match.create.goBack')}
            hitSlop={8}
          >
            <Text style={styles.wizardBackLinkTxt}>{t('match.create.back')}</Text>
          </Pressable>
        ) : null}

        {step === 'basic' ? (
          <>
            <Text style={styles.head}>{t('league.create.basicInfo')}</Text>
            <Text style={styles.lbl}>{t('league.create.tournamentName')}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={
                isGroupChallenge
                  ? t('league.create.groupChallenge.namePlaceholder')
                  : t('league.create.namePlaceholder')
              }
              placeholderTextColor={colors.subtle}
            />
            <View style={[styles.memberRow, { marginTop: 16 }]}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.formatTitle}>{t('league.create.groupChallenge.title')}</Text>
                <Text style={styles.formatSub}>{t('league.create.groupChallenge.subtitle')}</Text>
              </View>
              <Switch
                value={isGroupChallenge}
                onValueChange={enableGroupChallenge}
                trackColor={{ false: colors.border, true: colors.accent }}
                accessibilityLabel={t('league.create.groupChallenge.title')}
              />
            </View>
            {isGroupChallenge ? (
              <Text style={[styles.helper, { marginTop: 12 }]}>
                {t('league.create.groupChallenge.formatLocked')}
              </Text>
            ) : (
              <>
                <Text style={[styles.lbl, { marginTop: 16 }]}>{t('league.create.format')}</Text>
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
                          {t(`league.create.formats.${f.key}.title`)}
                        </Text>
                        <Text style={[styles.formatSub, disabled && styles.formatSubDisabled]}>
                          {t(`league.create.formats.${f.key}.sub`)}
                        </Text>
                        {needsFour ? (
                          <Text style={styles.formatDisabledNote}>
                            {t('league.create.requiresMinGroupMembers', {
                              count: MIN_GROUP_MEMBERS_FOR_TEAM_FORMATS,
                            })}
                          </Text>
                        ) : null}
                        {needsMatchPlayMin ? (
                          <Text style={styles.formatDisabledNote}>
                            {t('league.create.requiresMinGroupMembers', {
                              count: MATCH_PLAY_MIN_PLAYERS,
                            })}
                          </Text>
                        ) : null}
                      </View>
                      {on && !disabled ? <IconCheckmark size={20} color={colors.accent} /> : null}
                    </Pressable>
                  );
                })}
              </>
            )}
            <Pressable
              style={[styles.primaryBtn, !name.trim() && styles.btnDisabled]}
              disabled={!name.trim()}
              onPress={() => goToStep(isGroupChallenge ? 'opponent' : 'players')}
            >
              <Text style={styles.primaryBtnTxt}>{t('common.continue')}</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'opponent' ? (
          <>
            <Text style={styles.head}>{t('league.create.groupChallenge.opponentLabel')}</Text>
            <Text style={styles.helper}>{t('league.create.groupChallenge.opponentHelper')}</Text>
            <TextInput
              style={styles.input}
              value={opponentQuery}
              onChangeText={(v) => {
                setOpponentQuery(v);
                setOpponentGroup(null);
              }}
              placeholder={t('league.create.groupChallenge.opponentPlaceholder')}
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {opponentSearching ? (
              <ActivityIndicator color={colors.header} style={{ marginVertical: 12 }} />
            ) : null}
            {opponentGroup ? (
              <View style={[styles.memberRowOn, { marginTop: 10, padding: 12, borderRadius: 10 }]}>
                <Text style={styles.formatTitle}>{opponentGroup.name}</Text>
                <Text style={styles.helper}>{t('league.create.groupChallenge.opponentSelected')}</Text>
              </View>
            ) : null}
            {opponentResults.map((g) => {
              const on = opponentGroup?.id === g.id;
              return (
                <Pressable
                  key={g.id}
                  style={[styles.memberRow, on && styles.memberRowOn]}
                  onPress={() => {
                    setOpponentGroup(g);
                    setOpponentQuery(g.name);
                  }}
                >
                  <Text style={styles.formatTitle}>{g.name}</Text>
                  {on ? <IconCheckmark size={20} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
            {!opponentSearching &&
            opponentQuery.trim().length >= 2 &&
            opponentResults.length === 0 &&
            !opponentGroup ? (
              <Text style={styles.formatDisabledNote}>
                {t('league.create.groupChallenge.opponentNotFound')}
              </Text>
            ) : null}
            <Pressable
              style={[styles.primaryBtn, !opponentGroup && styles.btnDisabled]}
              disabled={!opponentGroup}
              onPress={() => goToStep('players')}
            >
              <Text style={styles.primaryBtnTxt}>{t('common.continue')}</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'players' ? (
          <>
            <Text style={styles.head}>
              {isGroupChallenge
                ? t('league.create.groupChallenge.rosterLabel', {
                    count: GROUP_CHALLENGE_ROSTER_SIZE,
                  })
                : t('league.create.whosPlaying')}
            </Text>
            <Text style={styles.helper}>
              {isGroupChallenge
                ? t('league.create.groupChallenge.rosterHelper', {
                    count: GROUP_CHALLENGE_ROSTER_SIZE,
                    min: GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS,
                  })
                : t('league.create.playersHelper')}
            </Text>
            {!isGroupChallenge ? (
            <View style={styles.selectAllRow}>
              <Pressable
                onPress={() => (allPlayersSelected ? deselectAllPlayers() : selectAllPlayers())}
                accessibilityRole="button"
                accessibilityLabel={
                  allPlayersSelected
                    ? t('league.create.deselectAll')
                    : t('league.create.selectAll')
                }
              >
                <Text style={styles.selectAllTxt}>
                  {allPlayersSelected
                    ? t('league.create.deselectAll')
                    : t('league.create.selectAll')}
                </Text>
              </Pressable>
            </View>
            ) : null}
            {groupMembers.length >= PLAYER_ROSTER_SEARCH_MIN ? (
              <>
                <Text style={styles.lbl}>{t('league.create.search')}</Text>
                <TextInput
                  style={[styles.input, { marginBottom: 10 }]}
                  value={playerSearch}
                  onChangeText={setPlayerSearch}
                  placeholder={t('league.create.filterByName')}
                  placeholderTextColor={colors.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
              </>
            ) : null}
            {filteredGroupMembers.map((m) => {
              const checked = isGroupChallenge
                ? selectedPlayerIds[m.userId] === true
                : selectedPlayerIds[m.userId] !== false;
              const rounds = m.roundsLogged ?? 0;
              const ineligible =
                isGroupChallenge && rounds < GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS;
              const atCap =
                isGroupChallenge &&
                !checked &&
                playerCount >= GROUP_CHALLENGE_ROSTER_SIZE;
              return (
                <Pressable
                  key={m.userId}
                  style={[
                    styles.memberRow,
                    checked && styles.memberRowOn,
                    ineligible && checked && { opacity: 0.85 },
                  ]}
                  onPress={() => {
                    if (atCap) return;
                    if (isGroupChallenge) {
                      setSelectedPlayerIds((prev) => ({
                        ...prev,
                        [m.userId]: !prev[m.userId],
                      }));
                      return;
                    }
                    togglePlayerSelected(m.userId);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled: atCap }}
                >
                  <View style={[styles.checkBox, checked && styles.checkBoxOn]}>
                    {checked ? <IconCheckmark size={14} color="#fff" /> : null}
                  </View>
                  <View style={styles.memberAv}>
                    <Text style={styles.memberAvTxt}>{m.initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName} numberOfLines={1}>
                      {m.displayName.replace(' (you)', '')}
                    </Text>
                    {ineligible ? (
                      <Text style={styles.formatDisabledNote}>
                        {t('league.create.groupChallenge.needsRounds', {
                          have: rounds,
                          min: GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS,
                        })}
                      </Text>
                    ) : null}
                  </View>
                  {m.index != null ? (
                    <Text style={styles.memberIdx}>{m.index.toFixed(1)}</Text>
                  ) : (
                    <Text style={styles.memberIdx}>—</Text>
                  )}
                </Pressable>
              );
            })}
            <Text style={styles.selectedCount}>
              {isGroupChallenge
                ? t('league.create.groupChallenge.selectedOf', {
                    selected: playerCount,
                    count: GROUP_CHALLENGE_ROSTER_SIZE,
                  })
                : t('league.create.selectedCount', { count: playerCount })}
            </Text>
            {playersStepError ? (
              <Text style={styles.formatDisabledNote}>{playersStepError}</Text>
            ) : null}
            {challengeIneligibleSelected.length > 0 ? (
              <Text style={styles.formatDisabledNote}>
                {t('league.create.groupChallenge.ineligibleSelected', {
                  count: challengeIneligibleSelected.length,
                  min: GROUP_CHALLENGE_MIN_QUALIFYING_ROUNDS,
                })}
              </Text>
            ) : null}
            <Pressable
              style={[
                styles.primaryBtn,
                (!!playersStepError || challengeIneligibleSelected.length > 0) &&
                  styles.btnDisabled,
              ]}
              disabled={!!playersStepError || challengeIneligibleSelected.length > 0}
              onPress={() => {
                if (needsTeams && !isGroupChallenge) {
                  prepareTeamCountFromSelection();
                  goToStep('teamCount');
                } else {
                  goToStep('settings');
                }
              }}
            >
              <Text style={styles.primaryBtnTxt}>{t('common.continue')}</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'teamCount' && needsTeams && teamFormat && teamSizeSuggestion ? (
          <>
            <Text style={styles.head}>{t('league.create.playersPerTeam')}</Text>
            <Text style={styles.helper}>
              {t('league.create.teamCountHelper', { count: playerCount })}
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
                      <Text style={styles.formatSuggestedNote}>
                        {t('league.create.suggested')}
                      </Text>
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
                    <Text style={styles.formatTitle}>{t('log.round.custom')}</Text>
                    <Text style={styles.formatSub}>
                      {t('league.create.customPlayersPerTeamRange', {
                        min: CUSTOM_PLAYERS_PER_TEAM_MIN,
                        max: maxPlayersPerTeam(playingMembers.length),
                      })}
                    </Text>
                    {teamSizeSuggestion.suggestedPlayersPerTeam >= CUSTOM_PLAYERS_PER_TEAM_MIN &&
                    (teamSizeSuggestion.validPreset.length === 0 ||
                      !PRESET_PLAYERS_PER_TEAM_OPTIONS.includes(
                        teamSizeSuggestion.suggestedPlayersPerTeam as (typeof PRESET_PLAYERS_PER_TEAM_OPTIONS)[number]
                      )) ? (
                      <Text style={styles.formatSuggestedNote}>
                        {t('league.create.suggested')}
                      </Text>
                    ) : null}
                  </View>
                  {playersPerTeamMode === 'custom' && !customPlayersPerTeamError ? (
                    <IconCheckmark size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
                {customPlayersPerTeamExpanded && playersPerTeamMode === 'custom' ? (
                  <View style={styles.customTeamInputBlock}>
                    <Text style={styles.lbl}>{t('league.create.playersPerTeam')}</Text>
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
                        {t('league.create.enterPlayersPerTeamMin', {
                          min: CUSTOM_PLAYERS_PER_TEAM_MIN,
                        })}
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
              <Text style={styles.helper}>{t('league.create.unevenTeamSplit')}</Text>
            ) : null}
            <Pressable
              style={[styles.primaryBtn, !teamSizeValid && styles.btnDisabled]}
              disabled={!teamSizeValid}
              onPress={() => goToStep('settings')}
            >
              <Text style={styles.primaryBtnTxt}>{t('common.continue')}</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'settings' ? (
          <>
            <Text style={styles.head}>{t('league.create.settings')}</Text>
            <Text style={styles.lbl}>{t('league.create.holesPerRound')}</Text>
                <View style={styles.dayRow}>
                  {(
                    [
                      {
                        key: '18' as const,
                        title: t('log.round.holes18'),
                        sub: t('log.round.holes18Sub'),
                      },
                      {
                        key: '9' as const,
                        title: t('league.create.holes9'),
                        sub: t('league.create.holes9Sub'),
                      },
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
                    <Text style={[styles.lbl, { marginTop: 12 }]}>
                      {t('league.create.whichNine')}
                    </Text>
                    <Text style={styles.helper}>{t('league.create.whichNineHelper')}</Text>
                    <View style={styles.dayRow}>
                      {(
                        [
                          {
                            key: 'front' as const,
                            title: t('home.latestFront9'),
                            sub: t('log.round.front9Sub'),
                          },
                          {
                            key: 'back' as const,
                            title: t('home.latestBack9'),
                            sub: t('log.round.back9Sub'),
                          },
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
                      <Text style={styles.formatDisabledNote}>
                        {t('league.create.chooseFrontOrBack')}
                      </Text>
                    ) : null}
                  </>
                ) : null}
            <Text style={[styles.lbl, { marginTop: 12 }]}>{t('log.round.course')}</Text>
            <Text style={styles.helper}>{t('league.create.courseHelper')}</Text>
            {tournamentCourseId ? (
              <View style={styles.courseSelectedRow}>
                <Text style={styles.summaryLine}>
                  📍 {tournamentCourseName ?? t('league.create.selectedCourse')}
                </Text>
                <Pressable
                  onPress={() => {
                    setCourseSearch('');
                    setCoursePickerOpen(true);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={t('league.create.changeCourseA11y')}
                >
                  <Text style={styles.courseChange}>{t('league.create.change')}</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={styles.formatDisabledNote}>
                  {t('league.create.chooseCourseToContinue')}
                </Text>
                <Pressable
                  style={styles.courseOpenBtn}
                  onPress={() => {
                    setCourseSearch('');
                    setCoursePickerOpen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('league.create.chooseCourseA11y')}
                >
                  <Text style={styles.courseOpenBtnTxt}>{t('league.create.chooseCourse')}</Text>
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
                  <Text style={styles.modalTitle}>{t('log.round.course')}</Text>
                  <TextInput
                    style={styles.courseSearchInput}
                    value={courseSearch}
                    onChangeText={setCourseSearch}
                    placeholder={t('league.create.searchCourses')}
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
                      <Text style={styles.courseSearchEmpty}>
                        {t('log.round.noCoursesMatch')}
                      </Text>
                    }
                    renderItem={({ item: c }) => {
                      const on = tournamentCourseId === c.id;
                      return (
                        <Pressable
                          style={styles.modalRow}
                          onPress={() => {
                            setTournamentCourseId(c.id);
                            setTournamentCourseName(c.name);
                            setCourseSearch('');
                            setCoursePickerOpen(false);
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.memberName}>{c.name}</Text>
                            {c.subtitle ? (
                              <Text style={styles.helper}>{c.subtitle}</Text>
                            ) : c.location ? (
                              <Text style={styles.helper}>{c.location}</Text>
                            ) : null}
                            {c.source === 'community' ||
                            (c.source === 'curated' && !c.confident) ? (
                              <UnverifiedCourseBadge
                                compact
                                source={c.source}
                                confident={c.confident}
                                enrichmentTier={c.enrichmentTier}
                                enrichmentSource={c.enrichmentSource}
                              />
                            ) : null}
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
              label={t('season.create.startDate')}
              hint={null}
              large
              value={startDateYmd}
              onChange={setStartDateYmd}
            />
            <DatePlayedField
              label={t('season.create.endDate')}
              hint={null}
              large
              value={endDateYmd}
              onChange={setEndDateYmd}
            />
            {dateError || dateRangeError ? (
              <Text style={[styles.helper, { color: colors.danger, fontWeight: '600' }]}>
                {dateError ?? dateRangeError}
              </Text>
            ) : null}
            {isGroupChallenge ? (
              <>
                {challengeCourseTees.length > 0 ? (
                  <>
                    <Text style={[styles.lbl, { marginTop: 12 }]}>
                      {t('league.create.groupChallenge.teeLabel')}
                    </Text>
                    <View style={styles.dayRow}>
                      {challengeCourseTees.map((tee) => {
                        const on = challengeTeeName === tee.name;
                        return (
                          <Pressable
                            key={tee.name}
                            style={[styles.dayBtn, on && styles.dayBtnOn]}
                            onPress={() => setChallengeTeeName(tee.name)}
                          >
                            <Text style={[styles.dayDn, on && styles.dayDnOn]}>{tee.name}</Text>
                            <Text style={[styles.dayDs, on && styles.dayDsOn]}>
                              {tee.rating.toFixed(1)} / {tee.slope}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : null}
                <Text style={[styles.lbl, { marginTop: 12 }]}>
                  {t('league.create.groupChallenge.verificationLabel')}
                </Text>
                <Text style={styles.helper}>
                  {t('league.create.groupChallenge.verificationHelper')}
                </Text>
                {(
                  [
                    {
                      key: 'verified' as const,
                      title: t('league.create.groupChallenge.verifiedOption'),
                      sub: t('league.create.groupChallenge.verifiedSub'),
                    },
                    {
                      key: 'casual' as const,
                      title: t('league.create.groupChallenge.casualOption'),
                      sub: t('league.create.groupChallenge.casualSub'),
                    },
                  ] as const
                ).map((opt) => {
                  const on = verificationMode === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      style={[styles.formatCard, on && styles.formatCardOn]}
                      onPress={() => setVerificationMode(opt.key)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.formatTitle}>{opt.title}</Text>
                        <Text style={styles.formatSub}>{opt.sub}</Text>
                      </View>
                      {on ? <IconCheckmark size={20} color={colors.accent} /> : null}
                    </Pressable>
                  );
                })}
                <Text style={[styles.helper, { marginTop: 8 }]}>
                  {t('league.create.groupChallenge.handicapSnapshotNote')}
                </Text>
              </>
            ) : isMatchPlay ? (
              <View style={styles.bracketInfo}>
                <Text style={styles.bracketInfoTitle}>{t('league.create.bracketTitle')}</Text>
                <Text style={styles.helper}>{t('league.create.bracketHelper')}</Text>
                <Text style={styles.sectionLbl}>{t('league.create.players')}</Text>
                {seededUserIds.map((uid, i) => {
                  const m = playingMembers.find((x) => x.userId === uid);
                  return (
                    <View key={uid} style={styles.memberRow}>
                      <Text style={styles.memberSeed}>#{i + 1}</Text>
                      <View style={styles.memberAv}>
                        <Text style={styles.memberAvTxt}>{m?.initials ?? '?'}</Text>
                      </View>
                      <Text style={[styles.memberName, { flex: 1 }]}>
                        {m?.displayName ?? t('league.create.playerFallback')}
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
                <Text style={[styles.lbl, { marginTop: 10 }]}>
                  {t('league.create.roundsThatCount')}
                </Text>
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
                <Text style={styles.helper}>
                  {t('league.create.bestOfRoundsHelper', { count: roundsThatCount })}
                </Text>
              </>
            )}
            {!isGroupChallenge ? (
              <>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLbl}>{t('league.create.useHandicap')}</Text>
              <View style={styles.toggleRight}>
                <Text style={styles.toggleVal}>
                  {useHandicap ? t('league.create.on') : t('league.create.off')}
                </Text>
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
            <Text style={styles.helper}>{t('league.create.useHandicapHelper')}</Text>
              </>
            ) : null}
            {!isMatchPlay && !needsTeams ? (
              <>
                <Text style={[styles.sectionLbl, { marginTop: 12 }]}>
                  {t('league.create.players')}
                </Text>
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
                  {t('league.create.overrideTeamHandicap')}
                </Text>
                <TextInput
                  style={styles.input}
                  value={scrambleHandicapOverride}
                  onChangeText={setScrambleHandicapOverride}
                  placeholder={t('league.create.overrideHandicapPlaceholder')}
                  placeholderTextColor={colors.subtle}
                  keyboardType="decimal-pad"
                />
                <Text style={styles.helper}>{t('league.create.overrideHandicapHelper')}</Text>
              </>
            ) : null}
            {activeSeason && !isGroupChallenge ? (
              <View style={styles.toggleRow}>
                <View style={styles.toggleLblRow}>
                  <Text style={styles.toggleLbl}>
                    {t('league.create.partOfSeason', { name: activeSeason.name })}
                  </Text>
                  <Pressable
                    style={styles.infoBtn}
                    onPress={() => setInfoSheet('season')}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={t('league.create.aboutJoinSeasonA11y')}
                  >
                    <Text style={styles.infoBtnTxt}>ⓘ</Text>
                  </Pressable>
                </View>
                <View style={styles.toggleRight}>
                  <Text style={styles.toggleVal}>
                    {joinSeason ? t('log.round.yes') : t('log.round.no')}
                  </Text>
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
              <Text style={styles.lbl}>{t('league.create.tournamentNotes')}</Text>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder={t('league.create.notesPlaceholder')}
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
              <Text style={styles.primaryBtnTxt}>{t('common.continue')}</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'teams' && needsTeams ? (
          <>
            <Text style={styles.head}>{t('league.create.assignTeams')}</Text>
            <Text style={styles.helper}>
              {isScramble
                ? t('league.create.assignTeamsScrambleHelper')
                : isBestBall
                  ? t('league.create.assignTeamsBestBallHelper')
                  : t('league.create.assignTeamsDefaultHelper')}
            </Text>
            <Pressable style={styles.outlineBtn} onPress={onAutoAssignTeams}>
              <Text style={styles.outlineBtnTxt}>{t('league.create.autoAssignTeams')}</Text>
            </Pressable>

            <Text style={styles.sectionLbl}>{t('league.create.unassignedPlayers')}</Text>
            {unassignedMembers.length === 0 ? (
              <Text style={styles.helper}>{t('league.create.everyoneOnTeam')}</Text>
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

            <Text style={[styles.sectionLbl, { marginTop: 16 }]}>{t('league.create.teams')}</Text>
            {teams.map((team) => (
              <View key={team.id} style={styles.teamBucket}>
                <View style={styles.teamBucketHead}>
                  <TextInput
                    style={[styles.teamNameInput, { flex: 1 }]}
                    value={team.name}
                    onChangeText={(v) =>
                      setTeams((prev) =>
                        prev.map((x) => (x.id === team.id ? { ...x, name: v } : x))
                      )
                    }
                  />
                </View>
                {selectedMemberId && unassignedMembers.some((m) => m.userId === selectedMemberId) ? (
                  <Pressable
                    style={styles.addToTeamBtn}
                    onPress={() => assignMemberToTeam(selectedMemberId, team.id)}
                  >
                    <Text style={styles.addToTeamBtnTxt}>
                      {t('league.create.addToTeam', { name: team.name })}
                    </Text>
                  </Pressable>
                ) : null}
                <View style={styles.teamMembersCol}>
                  {team.memberIds.length === 0 ? (
                    <Text style={styles.teamEmptyTxt}>{t('league.create.noPlayersYet')}</Text>
                  ) : (
                    team.memberIds.map((uid) => {
                      const m = playingMembers.find((x) => x.userId === uid);
                      const showActions =
                        assignedMemberAction?.userId === uid &&
                        assignedMemberAction.fromTeamId === team.id;
                      return (
                        <View key={uid} style={styles.assignedMemberBlock}>
                          <Pressable
                            style={[styles.chip, showActions && styles.chipOn]}
                            onPress={() =>
                              setAssignedMemberAction((prev) =>
                                prev?.userId === uid && prev.fromTeamId === team.id
                                  ? null
                                  : { userId: uid, fromTeamId: team.id }
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
                                <Text style={styles.memberActionRemove}>
                                  {t('league.create.removeFromTeam')}
                                </Text>
                              </Pressable>
                              {teams
                                .filter((other) => other.id !== team.id)
                                .map((other) => (
                                  <Pressable
                                    key={other.id}
                                    style={styles.memberActionBtn}
                                    onPress={() => assignMemberToTeam(uid, other.id)}
                                  >
                                    <Text style={styles.memberActionMove}>
                                      {t('league.create.moveToTeam', { name: other.name })}
                                    </Text>
                                  </Pressable>
                                ))}
                            </View>
                          ) : null}
                        </View>
                      );
                    })
                  )}
                </View>
                {isScramble && team.memberIds.length >= 2 ? (
                  <View style={styles.scorerBlock}>
                    <View style={styles.scorerLblRow}>
                      <Text style={styles.scorerLbl}>{t('league.create.designatedScorer')}</Text>
                      <Pressable
                        style={styles.infoBtn}
                        onPress={() => setInfoSheet('scorer')}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={t('league.create.aboutScorerA11y')}
                      >
                        <Text style={styles.infoBtnTxt}>ⓘ</Text>
                      </Pressable>
                    </View>
                    <View style={styles.scorerRow}>
                      {team.memberIds.map((uid) => {
                        const m = playingMembers.find((x) => x.userId === uid);
                        const on = team.designatedScorerUserId === uid;
                        return (
                          <Pressable
                            key={uid}
                            style={[styles.scorerChip, on && styles.scorerChipOn]}
                            onPress={() =>
                              setTeams((prev) =>
                                prev.map((x) =>
                                  x.id === team.id ? { ...x, designatedScorerUserId: uid } : x
                                )
                              )
                            }
                          >
                            <Text style={[styles.scorerChipTxt, on && styles.scorerChipTxtOn]}>
                              {m?.displayName ?? t('league.create.playerFallback')}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {(() => {
                      const idxs = team.memberIds
                        .map((uid) => playingMembers.find((m) => m.userId === uid)?.index)
                        .filter((v): v is number => v != null);
                      const teamIdx = computeScrambleTeamIndex(idxs);
                      return teamIdx != null ? (
                        <Text style={styles.teamIdxLine}>
                          {t('league.create.teamIndexLine', { index: teamIdx.toFixed(1) })}
                        </Text>
                      ) : null;
                    })()}
                  </View>
                ) : null}
              </View>
            ))}
            {!teamsStepCanContinue && allAssigned ? (
              <Text style={styles.helper}>{t('league.create.eachTeamNeedsTwo')}</Text>
            ) : null}
            <Pressable
              style={[styles.primaryBtn, !teamsStepCanContinue && styles.btnDisabled]}
              disabled={!teamsStepCanContinue}
              onPress={() => goToStep('review')}
            >
              <Text style={styles.primaryBtnTxt}>{t('common.continue')}</Text>
            </Pressable>
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <Text style={styles.head}>
              {isGroupChallenge
                ? t('league.create.groupChallenge.reviewTitle')
                : t('league.create.reviewLaunch')}
            </Text>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLine}>{name}</Text>
              {isGroupChallenge && opponentGroup ? (
                <Text style={styles.summaryMeta}>
                  {t('league.create.groupChallenge.vsLine', { name: opponentGroup.name })}
                </Text>
              ) : null}
              {tournamentCourseId ? (
                <Text style={styles.summaryMeta}>
                  📍 {tournamentCourseName ?? t('log.round.course')}
                  {isGroupChallenge && challengeTeeName ? ` · ${challengeTeeName}` : ''}
                </Text>
              ) : null}
              <Text style={styles.summaryMeta}>
                {isGroupChallenge
                  ? t('league.create.groupChallenge.summaryFormat')
                  : t(`league.create.formats.${format}.title`)}{' '}
                · {formatYmdDisplay(startDateYmd)} – {formatYmdDisplay(endDateYmd)}
              </Text>
              {dateError || dateRangeError ? (
                <Text style={[styles.helper, { color: colors.danger, fontWeight: '600' }]}>
                  {dateError ?? dateRangeError}
                </Text>
              ) : null}
              {isGroupChallenge ? (
                <Text style={styles.summaryMeta}>
                  {t('league.create.groupChallenge.summaryDetails', {
                    roster: GROUP_CHALLENGE_ROSTER_SIZE,
                    mode:
                      verificationMode === 'verified'
                        ? t('league.create.groupChallenge.verifiedOption')
                        : t('league.create.groupChallenge.casualOption'),
                    holes: holesPerRound,
                  })}
                </Text>
              ) : (
              <Text style={styles.summaryMeta}>
                {(isMatchPlay
                  ? t('league.create.summaryBracket', {
                      count: playingMembers.length,
                      handicap: useHandicap ? t('league.create.on').toLowerCase() : t('league.create.off').toLowerCase(),
                    })
                  : t('league.create.summaryBestRounds', {
                      count: roundsThatCount,
                      handicap: useHandicap ? t('league.create.on').toLowerCase() : t('league.create.off').toLowerCase(),
                    })) +
                  (holesPerRound === '9'
                    ? isMatchPlay
                      ? t('league.create.summaryNineHolesNamed', {
                          nine:
                            matchPlayNine === 'back'
                              ? t('home.latestBack9')
                              : t('home.latestFront9'),
                        })
                      : t('league.create.summaryNineHoles')
                    : '')}
              </Text>
              )}
              {notes.trim() ? (
                <Text style={styles.summaryMeta}>
                  {t('league.create.notesPrefix', { notes: notes.trim() })}
                </Text>
              ) : null}
              {activeSeason && !isGroupChallenge ? (
                <Text style={styles.summaryMeta}>
                  {joinSeason
                    ? t('league.create.seasonPrefix', { name: activeSeason.name })
                    : t('league.create.notPartOfSeason')}
                </Text>
              ) : null}
              {needsTeams ? (
                <Text style={styles.summaryMeta}>
                  {t('league.create.teamCountPlayers', {
                    teamResult: formatTeamCountResult(playingMembers.length, playersPerTeam),
                    count: playingMembers.length,
                  })}
                </Text>
              ) : null}
              {needsTeams
                ? teams.map((team) => {
                    const scorer = playingMembers.find(
                      (m) => m.userId === team.designatedScorerUserId
                    );
                    return (
                      <Text key={team.id} style={styles.summaryMeta}>
                        {t('league.create.teamPlayersLine', {
                          name: team.name,
                          count: team.memberIds.length,
                        })}
                        {isScramble && scorer
                          ? t('league.create.teamScorerSuffix', {
                              scorer: scorer.displayName.replace(' (you)', ''),
                            })
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
                        ? t('handicap.sourceSimcap')
                        : m?.handicapSource === 'ghin'
                          ? t('handicap.sourceGhin')
                          : t('handicap.sourceNone');
                    const display = m?.displayName ?? t('league.create.playerFallback');
                    return (
                      <Text key={uid} style={styles.summaryMeta}>
                        {m?.index != null
                          ? t('league.create.seedLineWithIndex', {
                              seed: i + 1,
                              name: display,
                              index: m.index.toFixed(1),
                              source: src,
                            })
                          : t('league.create.seedLineNoIndex', {
                              seed: i + 1,
                              name: display,
                              source: src,
                            })}
                      </Text>
                    );
                  })
                : null}
            </View>
            <Pressable
              style={[styles.primaryBtn, (busy || !!dateRangeError || !!dateError) && styles.btnDisabled]}
              disabled={busy || !!dateRangeError || !!dateError}
              onPress={() => void onLaunch()}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnTxt}>
                  {isGroupChallenge
                    ? t('league.create.groupChallenge.send')
                    : t('league.create.launchTournament')}
                </Text>
              )}
            </Pressable>
            <Pressable
              style={styles.secondaryBtn}
              onPress={goBackStep}
              accessibilityRole="button"
              accessibilityLabel={t('match.create.goBack')}
            >
              <Text style={styles.secondaryBtnTxt}>{t('match.create.back')}</Text>
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
                <Text style={styles.infoExplainTitle}>{t('league.create.seasonInfoTitle')}</Text>
                <Text style={styles.infoExplainBody}>{t('league.create.seasonInfoBody')}</Text>
              </>
            ) : null}
            {infoSheet === 'scorer' ? (
              <>
                <Text style={styles.infoExplainTitle}>{t('league.create.scorerInfoTitle')}</Text>
                <Text style={styles.infoExplainBody}>{t('league.create.scorerInfoBody')}</Text>
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
  wizardBackLink: { alignSelf: 'flex-start', marginBottom: 10, paddingVertical: 4 },
  wizardBackLinkTxt: { fontSize: 15, fontWeight: '600', color: colors.accent },
  secondaryBtn: {
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
  },
  secondaryBtnTxt: { fontSize: 16, fontWeight: '600', color: colors.ink },
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
