import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useAuth } from '../../../src/auth/AuthContext';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, Alert, ActivityIndicator, InputAccessoryView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardBottomInset } from '../../../src/lib/useKeyboardBottomInset';
import * as ImagePicker from 'expo-image-picker';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { PendingTournamentHolesBanner } from '../../../src/components/PendingTournamentHolesBanner';
import { IconCheckmark } from '../../../src/components/SvgUiIcons';
import { DatePlayedField } from '../../../src/components/DatePlayedField';
import i18n, { useTranslation } from '../../../src/i18n';
import { PLATFORMS, colors, type PlatformId } from '../../../src/lib/constants';
import { useResponsive } from '../../../src/lib/responsive';
import {
  adjustedDifferentialForVersion,
  CURRENT_DIFFERENTIAL_VERSION,
  difficultyProduct,
  formatDifferentialDisplay,
  MULLIGAN_PICKER_OPTS,
  normalizeMulligans,
  round1,
  type Mulligans,
  type PinDay,
  type PuttingMode,
  type Wind,
} from '../../../src/lib/handicap';
import { pinOptionsForPlatform, isGsProPlatform } from '../../../src/lib/pinPlacement';
import { isoToLocalYmd, localYmdToIso, todayLocalYmd } from '../../../src/lib/dates';
import { showAppAlert } from '../../../src/lib/alertCompat';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import { roundsForLeagueRecordingAfterSave } from '../../../src/lib/effectiveHandicap';
import {
  effectiveHandicapForLeagueRecording,
  fetchActiveTournamentsForUser,
  isTeamLeagueFormat,
  recordOptedInLeagueRounds,
  type ActiveTournamentOption,
} from '../../../src/lib/leagues';
import { resolveSocialGroupsAccessToken } from '../../../src/lib/socialGroups';
import { courseSnapshot } from '../../../src/lib/rounds';
import { nearestTeeByYards } from '../../../src/lib/communityEnrichment';
import {
  curatedPickerCourses,
  fetchCommunityCoursesForPicker,
  isCommunityCourseId,
  mergePickerCourses,
  resolveLogCourse,
  type CommunityCourseRow,
  type ResolvedLogCourse,
} from '../../../src/lib/communityCourses';
import {
  addTeeToCustomCourse,
  fetchCustomCoursesForPicker,
  type CustomCourseRow,
} from '../../../src/lib/customCourses';
import { DEFAULT_UNRATED_SLOPE, isUnratedTee } from '../../../src/lib/ratingSource';
import { UnverifiedCourseBadge } from '../../../src/components/UnverifiedCourseBadge';
import { UnratedCourseBadge } from '../../../src/components/UnratedCourseBadge';
import { CustomCourseCreateModal } from '../../../src/components/CustomCourseCreateModal';
import { yardageForCourseTee } from '../../../src/lib/courseTeeYardages';
import { uploadLogScorecardForParse } from '../../../src/lib/logScorecardStorage';
import { invokeParseScorecard } from '../../../src/lib/parseScorecard';
import {
  applyParseScorecardToLogForm,
  type ScanBannerKind,
} from '../../../src/lib/scorecardParseApply';
import {
  matchCourseFromScannedName,
  teeNamesForScannedCourseMatch,
} from '../../../src/lib/scorecardCourseMatch';
import { settingsScreenshotPickerOptions } from '../../../src/lib/settingsScreenshotPicker';
import { supabase, isSupabaseConfigured } from '../../../src/lib/supabase';
import {
  CUSTOM_TEE_ID,
  getCourseById,
  getCourseTees,
  middleCourseTee,
  ratingForCourse,
} from '../../../src/lib/courses';
import { targetGrossToImprove } from '../../../src/lib/preRoundPrediction';
import { latestGhinIndex } from '../../../src/lib/realVsSim';
import { currentIndexFromRounds, useAppStore, type SimRound } from '../../../src/store/useAppStore';
import {
  clampGrossScore,
  grossScoreBounds,
  isNineHolePlayed,
  nineHoleLoggingUnlocked,
  parAnchorForHoles,
  ratingSlopeForHolesPlayed,
  type HolesPlayed,
} from '../../../src/lib/nineHoleRating';

type DiffInfoKind = 'adjusted' | 'expected' | null;

const PUTTING_KEYS: PuttingMode[] = ['auto_2putt', 'gimme_5', 'putt_all'];
const WIND_KEYS: Wind[] = ['off', 'light', 'strong'];
const MULL_KEYS = MULLIGAN_PICKER_OPTS.map((o) => o.key);

const LOG_ROUND_NUMERIC_ACCESSORY_ID = 'log-round-numeric-done';

function NumericKeyboardDoneBar() {
  if (Platform.OS !== 'ios') return null;
  const done = i18n.t('common.done');
  return (
    <InputAccessoryView nativeID={LOG_ROUND_NUMERIC_ACCESSORY_ID}>
      <View style={styles.keyboardAccessory}>
        <Pressable
          style={styles.keyboardDoneBtn}
          onPress={() => Keyboard.dismiss()}
          accessibilityRole="button"
          accessibilityLabel={done}
        >
          <Text style={styles.keyboardDoneTxt}>{done}</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

function scanBannerText(
  t: TFunction,
  kind: ScanBannerKind,
  detail?: {
    detectedCourseName?: string | null;
    matchedCourseName?: string | null;
    courseMatchConfidence?: 'exact' | 'fuzzy' | null;
  }
): string | null {
  if (kind == null) return null;
  if (kind === 'failed') return t('log.round.scan.failed');

  const detected = detail?.detectedCourseName?.trim();
  const matched = detail?.matchedCourseName?.trim();
  const courseBit = (() => {
    if (matched && detected) {
      if (detail?.courseMatchConfidence === 'fuzzy') {
        return t('log.round.scan.courseFuzzy', { matched, detected });
      }
      return t('log.round.scan.courseSet', { matched });
    }
    if (detected && !matched) {
      return t('log.round.scan.courseDetectedNoMatch', { detected });
    }
    if (matched) {
      return t('log.round.scan.courseSet', { matched });
    }
    return '';
  })();

  if (kind === 'low') return `${t('log.round.scan.low')}${courseBit}`;
  return `${t('log.round.scan.review')}${courseBit}`;
}

/** Set true to log gross resolution in dev tools when saving a round. */
const DEBUG_LOG_GROSS_SAVE = false;

function ordinalPlace(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

export default function LogRoundScreen() {
  const { t } = useTranslation();
  const { gutter, isWide } = useResponsive();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardBottomInset = useKeyboardBottomInset();
  const courseListMaxHeight = useMemo(() => {
    const sheetCap = keyboardBottomInset > 0 ? 0.92 : 0.7;
    const available = windowHeight - keyboardBottomInset;
    // Title + search field + padding ≈ 120; keep a usable scroll region above the keyboard.
    return Math.max(140, available * sheetCap - 120);
  }, [windowHeight, keyboardBottomInset]);
  const router = useRouter();
  const params = useLocalSearchParams<{ editId?: string }>();
  const editId =
    typeof params.editId === 'string' && params.editId.length > 0 ? params.editId : undefined;

  const pinLabel = useCallback(
    (key: PinDay, platformId: PlatformId) => {
      if (isGsProPlatform(platformId)) {
        return t(`log.round.pin.${key}`);
      }
      if (key === 'thu') return t('log.round.pin.easy');
      if (key === 'fri') return t('log.round.pin.medium');
      if (key === 'sun') return t('log.round.pin.hard');
      return t(`log.round.pin.${key}`);
    },
    [t]
  );
  const pinSublabel = useCallback(
    (key: PinDay, platformId: PlatformId) => {
      if (!isGsProPlatform(platformId)) return undefined;
      const map: Record<PinDay, string> = {
        thu: t('log.round.pin.round1'),
        fri: t('log.round.pin.round2'),
        sat: t('log.round.pin.round3'),
        sun: t('log.round.pin.round4'),
      };
      return map[key];
    },
    [t]
  );

  const { user } = useAuth();
  const addRound = useAppStore((s) => s.addRound);
  const updateRound = useAppStore((s) => s.updateRound);
  const rounds = useAppStore((s) => s.rounds);
  const groups = useAppStore((s) => s.groups);
  const supabaseOn = isSupabaseConfigured();
  const pendingH2hMatchup = useAppStore((s) => s.pendingH2hMatchup);
  const setPendingH2hMatchup = useAppStore((s) => s.setPendingH2hMatchup);
  const preferredLogPlatform = useAppStore((s) => s.preferredLogPlatform);
  const ghinSnapshots = useAppStore((s) => s.ghinSnapshots);
  const existing = editId ? rounds.find((r) => r.id === editId) : undefined;

  const [platform, setPlatform] = useState<PlatformId>(preferredLogPlatform);
  const [courseId, setCourseId] = useState('pebble');
  const [holesPlayed, setHolesPlayed] = useState<HolesPlayed>('18');
  const [grossScore, setGrossScore] = useState(72);
  const [putting, setPutting] = useState<PuttingMode>('auto_2putt');
  const [pin, setPin] = useState<PinDay>('thu');
  const [wind, setWind] = useState<Wind>('off');
  const [mulligans, setMulligans] = useState<Mulligans>('none');
  const [teePickKey, setTeePickKey] = useState('White');
  const [customRating, setCustomRating] = useState('');
  const [customSlope, setCustomSlope] = useState('');
  const [platOpen, setPlatOpen] = useState(false);
  const [courseOpen, setCourseOpen] = useState(false);
  const [courseSearchQuery, setCourseSearchQuery] = useState('');
  const [playedDate, setPlayedDate] = useState(todayLocalYmd);
  const [diffInfoOpen, setDiffInfoOpen] = useState<DiffInfoKind>(null);
  const [activeTournaments, setActiveTournaments] = useState<ActiveTournamentOption[]>([]);
  const [tournamentApply, setTournamentApply] = useState<Record<string, boolean>>({});
  const [communityCourses, setCommunityCourses] = useState<CommunityCourseRow[]>([]);
  const [customCourses, setCustomCourses] = useState<CustomCourseRow[]>([]);
  const [customCreateOpen, setCustomCreateOpen] = useState(false);
  const [dismissCourseSuggestions, setDismissCourseSuggestions] = useState(false);
  const [addTeeOpen, setAddTeeOpen] = useState(false);
  const [addTeeName, setAddTeeName] = useState('');
  const [addTeePar, setAddTeePar] = useState('72');
  const [addTeeYards, setAddTeeYards] = useState('');
  const [addTeeKnowOfficial, setAddTeeKnowOfficial] = useState(false);
  const [addTeeRating, setAddTeeRating] = useState('');
  const [addTeeSlope, setAddTeeSlope] = useState('');
  const [addTeeBusy, setAddTeeBusy] = useState(false);
  const [yardsPlayed, setYardsPlayed] = useState('');
  /** False until the latest active-tournament fetch finishes — prevents stale prompt flash. */
  const [tournamentsReady, setTournamentsReady] = useState(false);
  const tournamentsFetchGen = useRef(0);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanBanner, setScanBanner] = useState<ScanBannerKind>(null);
  const [scanBannerDetail, setScanBannerDetail] = useState<{
    detectedCourseName?: string | null;
    matchedCourseName?: string | null;
    courseMatchConfidence?: 'exact' | 'fuzzy' | null;
  } | null>(null);
  /** Honored once by the courseId→tee sync effect so a scan tee isn't overwritten by the default tee. */
  const pendingScanTeeRef = useRef<string | null>(null);
  /** Latest form fields for save (deferred save must not read stale render closures). */
  const latestSaveRef = useRef<{
    grossScore: number;
    playedDate: string;
    courseId: string;
    platform: PlatformId;
    putting: PuttingMode;
    pin: PinDay;
    wind: Wind;
    mulligans: Mulligans;
    course: ResolvedLogCourse | null;
    yardsPlayed: string;
    existing: SimRound | undefined;
    teePickKey: string;
    customRating: string;
    customSlope: string;
    holesPlayed: HolesPlayed;
  } | null>(null);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setPlatOpen(false);
        setCourseOpen(false);
        setDiffInfoOpen(null);
      };
    }, [])
  );

  const resetLogForm = useCallback(() => {
    setPlatform(preferredLogPlatform);
    setCourseId('pebble');
    setHolesPlayed('18');
    setGrossScore(parAnchorForHoles('18'));
    setPutting('auto_2putt');
    setPin('thu');
    setWind('off');
    setMulligans('none');
    setPlayedDate(todayLocalYmd());
    const c0 = getCourseById('pebble');
    if (c0) {
      const tees0 = getCourseTees(c0, preferredLogPlatform);
      if (c0.confident === false && tees0.length > 0) {
        setTeePickKey(tees0[Math.floor(tees0.length / 2)].name);
      } else {
        const def0 = c0.defaultTee?.trim();
        setTeePickKey(
          tees0.find((t) => t.name === def0)?.name ?? tees0[tees0.length - 1]?.name ?? tees0[0]?.name ?? 'White'
        );
      }
    } else {
      setTeePickKey('White');
    }
    setCustomRating('');
    setCustomSlope('');
    setActiveTournaments([]);
    setTournamentApply({});
  }, [preferredLogPlatform]);

  const loadActiveTournaments = useCallback(async () => {
    const fetchGen = ++tournamentsFetchGen.current;
    if (!supabaseOn || !user?.id || existing) {
      setActiveTournaments([]);
      setTournamentApply({});
      setTournamentsReady(true);
      return;
    }
    // Hide any prior list immediately so a deleted tournament can't flash.
    setTournamentsReady(false);
    setActiveTournaments([]);
    try {
      const accessToken =
        googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
      const memberGroups = groups
        .filter((gr) => gr.members.some((m) => m.userId === user.id))
        .map((gr) => ({ id: gr.id, name: gr.name }));
      const list = await fetchActiveTournamentsForUser({
        userId: user.id,
        groups: memberGroups,
        playedAt: localYmdToIso(playedDate),
        holesPlayed,
        courseId,
        accessToken,
      });
      if (fetchGen !== tournamentsFetchGen.current) return;
      setActiveTournaments(list);
      setTournamentApply((prev) =>
        Object.fromEntries(list.map((t) => [t.leagueId, prev[t.leagueId] ?? true]))
      );
    } finally {
      if (fetchGen === tournamentsFetchGen.current) {
        setTournamentsReady(true);
      }
    }
  }, [supabaseOn, user?.id, existing, groups, playedDate, holesPlayed, courseId]);

  useEffect(() => {
    void loadActiveTournaments();
  }, [loadActiveTournaments]);

  useFocusEffect(
    useCallback(() => {
      void loadActiveTournaments();
    }, [loadActiveTournaments])
  );

  const hasExpandedCourseList = useMemo(() => {
    if (!user?.id) return false;
    return groups.some(
      (g) => g.expandedCourseListEnabled && g.members.some((m) => m.userId === user.id)
    );
  }, [groups, user?.id]);

  const loadCommunityCourses = useCallback(async () => {
    const needsCommunity =
      hasExpandedCourseList || (courseId.length > 0 && isCommunityCourseId(courseId));
    if (!supabaseOn || !needsCommunity) {
      if (!needsCommunity) setCommunityCourses([]);
      return;
    }
    try {
      const accessToken =
        googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
      const rows = await fetchCommunityCoursesForPicker(accessToken);
      setCommunityCourses(rows);
    } catch {
      setCommunityCourses([]);
    }
  }, [supabaseOn, hasExpandedCourseList, courseId]);

  const loadCustomCourses = useCallback(async () => {
    if (!supabaseOn) {
      setCustomCourses([]);
      return;
    }
    try {
      const accessToken =
        googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
      const rows = await fetchCustomCoursesForPicker(accessToken);
      setCustomCourses(rows);
    } catch {
      setCustomCourses([]);
    }
  }, [supabaseOn]);

  useEffect(() => {
    void loadCommunityCourses();
  }, [loadCommunityCourses]);

  useEffect(() => {
    void loadCustomCourses();
  }, [loadCustomCourses]);

  useFocusEffect(
    useCallback(() => {
      void loadCommunityCourses();
      void loadCustomCourses();
    }, [loadCommunityCourses, loadCustomCourses])
  );

  useEffect(() => {
    if (editId) return;
    if (pendingH2hMatchup) return;
    setPlatform(preferredLogPlatform);
  }, [editId, pendingH2hMatchup, preferredLogPlatform]);

  useEffect(() => {
    if (editId) return;
    const p = pendingH2hMatchup;
    if (!p) return;
    setPlatform(p.platform);
    setCourseId(p.courseId);
    setPutting(p.putting);
    setPin(p.pin);
    setWind(p.wind);
    setMulligans(normalizeMulligans(p.mulligans));
    setPendingH2hMatchup(null);
  }, [editId, pendingH2hMatchup, setPendingH2hMatchup]);

  useEffect(() => {
    if (!existing) return;
    setPlatform(existing.platform);
    setCourseId(existing.courseId);
    setPutting(existing.putting);
    setPin(existing.pin);
    setWind(existing.wind);
    setMulligans(normalizeMulligans(existing.mulligans));
    setPlayedDate(isoToLocalYmd(existing.playedAt));
    const hp =
      existing.holesPlayed === 'front' || existing.holesPlayed === 'back'
        ? existing.holesPlayed
        : '18';
    setHolesPlayed(hp);
    setGrossScore(clampGrossScore(existing.grossScore, hp));
    const ec = getCourseById(existing.courseId);
    if (ec) {
      if (ec.confident === false) {
        const mid = middleCourseTee(ec, existing.platform);
        if (mid) {
          setTeePickKey(mid.name);
          setCustomRating('');
          setCustomSlope('');
        }
      } else {
        const teesE = getCourseTees(ec, existing.platform);
        const matchTee = existing.teeName && teesE.find((t) => t.name === existing.teeName);
        if (matchTee) {
          setTeePickKey(matchTee.name);
          setCustomRating('');
          setCustomSlope('');
        } else {
          setTeePickKey(CUSTOM_TEE_ID);
          setCustomRating(String(existing.courseRating));
          setCustomSlope(String(existing.slope));
        }
      }
    }
  }, [existing]);

  useEffect(() => {
    if (courseOpen) setCourseSearchQuery('');
  }, [courseOpen]);

  useEffect(() => {
    // eslint-disable-next-line no-console -- debug: tee selection state
    console.log('[log] teePickKey', teePickKey);
  }, [teePickKey]);

  /** New round only: keep tee aligned with the selected course / platform. (Edit mode sets tee from the saved round.) */
  useEffect(() => {
    if (editId) return;
    const resolved = resolveLogCourse(courseId, platform, communityCourses, customCourses);
    if (!resolved) return;

    const pendingTee = pendingScanTeeRef.current;
    if (pendingTee) {
      pendingScanTeeRef.current = null;
      const hit = resolved.tees.find((t) => t.name === pendingTee);
      if (hit) {
        setTeePickKey(hit.name);
        setCustomRating('');
        setCustomSlope('');
        return;
      }
      // Scanned tee not on this course — fall through to default.
    }

    if (resolved.source === 'community') {
      setYardsPlayed('');
      if (resolved.tees.length > 0) {
        setTeePickKey(resolved.tees[0].name);
      }
      return;
    }
    if (resolved.source === 'custom') {
      if (resolved.tees.length > 0) {
        setTeePickKey(resolved.tees[0].name);
      }
      setCustomRating('');
      setCustomSlope('');
      return;
    }
    const c = resolved.seed;
    if (!c) return;
    const tees = getCourseTees(c, platform);
    if (c.confident === false && tees.length > 0) {
      setTeePickKey(tees[Math.floor(tees.length / 2)].name);
    } else {
      const def = c.defaultTee?.trim();
      setTeePickKey(tees.find((t) => t.name === def)?.name ?? tees[tees.length - 1]?.name ?? tees[0].name);
    }
    setCustomRating('');
    setCustomSlope('');
  }, [courseId, platform, editId, communityCourses, customCourses]);

  const pinOpts = useMemo(() => pinOptionsForPlatform(platform), [platform]);

  useEffect(() => {
    const keys = pinOpts.map((o) => o.key);
    if (!keys.includes(pin)) {
      setPin(keys[0] ?? 'thu');
    }
  }, [platform, pinOpts, pin]);

  const resolvedCourse = useMemo(
    () => resolveLogCourse(courseId, platform, communityCourses, customCourses),
    [courseId, platform, communityCourses, customCourses]
  );
  const courseTees = useMemo(() => resolvedCourse?.tees ?? [], [resolvedCourse]);
  const parseCourseTees = useMemo(
    () =>
      resolvedCourse
        ? courseTees.map((t) => ({
            name: t.name,
            yards:
              (typeof t.yards === 'number' && Number.isFinite(t.yards) ? t.yards : undefined) ??
              (resolvedCourse.source === 'curated' && resolvedCourse.seed
                ? yardageForCourseTee(resolvedCourse.seed.id, t.name)
                : null) ??
              null,
          }))
        : [],
    [resolvedCourse, courseTees]
  );

  const onScanScorecard = useCallback(async () => {
    if (scanBusy || !user?.id || !supabaseOn) return;

    const runPick = async (source: 'library' | 'camera') => {
      const pickerOpts = settingsScreenshotPickerOptions();
      if (source === 'camera') {
        let camPerm = await ImagePicker.getCameraPermissionsAsync();
        if (!camPerm.granted) camPerm = await ImagePicker.requestCameraPermissionsAsync();
        if (!camPerm.granted) {
          showAppAlert(t('log.round.alerts.cameraTitle'), t('log.round.alerts.cameraBody'));
          return;
        }
      } else {
        let perm = await ImagePicker.getMediaLibraryPermissionsAsync(false);
        if (!perm.granted) perm = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
        if (!perm.granted) {
          showAppAlert(t('log.round.alerts.photosTitle'), t('log.round.alerts.photosBody'));
          return;
        }
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(pickerOpts)
          : await ImagePicker.launchImageLibraryAsync(pickerOpts);
      if (result.canceled || !result.assets[0]) return;

      setScanBusy(true);
      setScanBanner(null);
      setScanBannerDetail(null);

      const { data: sessionData } = await supabase!.auth.getSession();
      const token = sessionData.session?.access_token;

      const up = await uploadLogScorecardForParse({
        userId: user.id,
        localUri: result.assets[0].uri,
        accessToken: token,
      });
      if ('error' in up) {
        setScanBusy(false);
        showAppAlert(t('log.round.alerts.uploadFailed'), up.error);
        return;
      }

      const parsed = await invokeParseScorecard({
        imageUrl: up.signedUrl,
        courseTees: parseCourseTees,
        accessToken: token,
      });
      setScanBusy(false);

      const courseMatch = matchCourseFromScannedName(parsed.raw_course_name, communityCourses);
      const teeNames = courseMatch
        ? teeNamesForScannedCourseMatch(courseMatch, platform, communityCourses)
        : courseTees.map((t) => t.name);
      const applied = applyParseScorecardToLogForm(parsed, teeNames, courseMatch);
      setScanBanner(applied.banner);
      setScanBannerDetail({
        detectedCourseName: applied.detectedCourseName,
        matchedCourseName: applied.matchedCourseName,
        courseMatchConfidence: applied.courseMatchConfidence,
      });

      if (applied.banner === 'failed') return;

      if (applied.courseId) {
        if (applied.courseId !== courseId) {
          if (applied.teePickKey) pendingScanTeeRef.current = applied.teePickKey;
          setCourseId(applied.courseId);
          setCustomRating('');
          setCustomSlope('');
          setYardsPlayed('');
        } else if (applied.teePickKey) {
          setTeePickKey(applied.teePickKey);
          setCustomRating('');
          setCustomSlope('');
        }
      } else if (applied.teePickKey) {
        setTeePickKey(applied.teePickKey);
        setCustomRating('');
        setCustomSlope('');
      }
      if (applied.grossScore != null) setGrossScore(applied.grossScore);
      if (applied.putting) setPutting(applied.putting);
      if (applied.pin) setPin(applied.pin);
      if (applied.wind) setWind(applied.wind);
      if (applied.mulligans) setMulligans(normalizeMulligans(applied.mulligans));
    };

    if (Platform.OS === 'web') {
      void runPick('library');
      return;
    }

    Alert.alert(t('log.round.alerts.scanTitle'), t('log.round.alerts.scanChooseSource'), [
      { text: t('log.round.alerts.photoLibrary'), onPress: () => void runPick('library') },
      { text: t('log.round.alerts.camera'), onPress: () => void runPick('camera') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }, [scanBusy, user?.id, supabaseOn, parseCourseTees, courseTees, communityCourses, platform, courseId, t]);

  useEffect(() => {
    if (!isGsProPlatform(platform)) {
      setScanBanner(null);
      setScanBannerDetail(null);
    }
  }, [platform]);

  const resolvedTeeRating = useMemo(() => {
    const resolved = ((): {
      rating: number;
      slope: number;
      teeLabel: string;
      customNine?: boolean;
    } => {
      if (!resolvedCourse) return { rating: 72, slope: 130, teeLabel: '' as string };
      if (resolvedCourse.source === 'community') {
        const yards = parseInt(yardsPlayed.replace(/,/g, '').trim(), 10);
        if (Number.isFinite(yards) && yards > 0) {
          const near = nearestTeeByYards(resolvedCourse.tees, yards);
          if (near) return { rating: near.rating, slope: near.slope, teeLabel: near.name };
        }
        const first = resolvedCourse.tees[0];
        if (first) return { rating: first.rating, slope: first.slope, teeLabel: first.name };
        return { rating: 72, slope: 113, teeLabel: 'Default' };
      }
      if (resolvedCourse.source === 'custom') {
        const row = resolvedCourse.tees.find((t) => t.name === teePickKey) ?? resolvedCourse.tees[0];
        if (row) return { rating: row.rating, slope: row.slope, teeLabel: row.name };
        return { rating: 72, slope: DEFAULT_UNRATED_SLOPE, teeLabel: 'Default' };
      }
      const course = resolvedCourse.seed;
      if (!course) return { rating: 72, slope: 130, teeLabel: '' as string };
      if (course.confident === false) {
        const mid = middleCourseTee(course, platform);
        if (mid) return { rating: mid.rating, slope: mid.slope, teeLabel: mid.name };
        const fb = ratingForCourse(course, platform);
        return { rating: fb.rating, slope: fb.slope, teeLabel: course.defaultTee ?? 'Default' };
      }
      if (teePickKey === CUSTOM_TEE_ID) {
        const r = parseFloat(customRating.replace(/,/g, '.').trim());
        const s = parseFloat(customSlope.replace(/,/g, '.').trim());
        if (Number.isFinite(r) && Number.isFinite(s) && s > 0) {
          // Custom entry is the rating/slope for the holes selected (18 or that nine).
          return {
            rating: round1(r),
            slope: Math.round(s),
            teeLabel: 'Custom',
            customNine: true,
          };
        }
        const fb = ratingForCourse(course, platform);
        return { rating: fb.rating, slope: fb.slope, teeLabel: 'Custom' };
      }
      const row = courseTees.find((t) => t.name === teePickKey);
      if (row) return { rating: row.rating, slope: row.slope, teeLabel: row.name };
      const fb = ratingForCourse(course, platform);
      return { rating: fb.rating, slope: fb.slope, teeLabel: course.defaultTee ?? 'Default' };
    })();
    // eslint-disable-next-line no-console -- debug: resolved tee for handicap preview
    console.log('[log] resolvedTeeRating', resolved.rating, resolved.slope);
    return resolved;
  }, [resolvedCourse, platform, teePickKey, customRating, customSlope, courseTees, yardsPlayed]);

  const effectiveTeeForDiff = useMemo(() => {
    const base = {
      rating: resolvedTeeRating.rating,
      slope: resolvedTeeRating.slope,
    };
    if (isNineHolePlayed(holesPlayed) && resolvedTeeRating.customNine) {
      return {
        rating: base.rating,
        slope: base.slope,
        nineHoleSource: 'real' as const,
      };
    }
    return ratingSlopeForHolesPlayed(base, holesPlayed);
  }, [resolvedTeeRating, holesPlayed]);

  const showTeeSelector =
    (resolvedCourse?.source === 'curated' && resolvedCourse.confident !== false) ||
    resolvedCourse?.source === 'custom';
  const showYardageInput = resolvedCourse?.source === 'community';
  const selectedCustomTee =
    resolvedCourse?.source === 'custom'
      ? resolvedCourse.tees.find((t) => t.name === teePickKey) ?? resolvedCourse.tees[0]
      : null;

  // Course list is independent of tournament state — apply-to-tournament matching is per-round via leagueAcceptsLoggedHoles.
  const showCommunityInPicker = hasExpandedCourseList;

  const coursesForPicker = useMemo(() => {
    const curated = curatedPickerCourses(courseSearchQuery);
    const community = showCommunityInPicker ? communityCourses : [];
    return mergePickerCourses(curated, community, courseSearchQuery, customCourses);
  }, [courseSearchQuery, showCommunityInPicker, communityCourses, customCourses]);

  const showAddNewCourseCta =
    dismissCourseSuggestions ||
    (courseSearchQuery.trim().length > 0 && coursesForPicker.length === 0);

  const { rating, slope } = resolvedCourse
    ? { rating: effectiveTeeForDiff.rating, slope: effectiveTeeForDiff.slope }
    : { rating: 72, slope: 130 };

  const effectiveGross = grossScore;

  const previewDifferentialVersion = existing?.differentialVersion ?? CURRENT_DIFFERENTIAL_VERSION;
  const preview = useMemo(() => {
    return adjustedDifferentialForVersion(
      previewDifferentialVersion,
      effectiveGross,
      rating,
      slope,
      putting,
      pin,
      wind,
      mulligans
    );
  }, [previewDifferentialVersion, effectiveGross, rating, slope, putting, pin, wind, mulligans]);
  const adjustedDisplay = formatDifferentialDisplay(preview.adjusted);

  const modifier = difficultyProduct(putting, pin, wind, mulligans);
  const modPct = Math.min(100, Math.max(0, ((modifier - 0.5) / 0.5) * 100));

  const simIndexCurrent = useMemo(() => currentIndexFromRounds(rounds), [rounds]);
  /** Decision 2: 9-hole logging unlocked once Home would show a non-null SimCap index. */
  const canLogNineHole = nineHoleLoggingUnlocked(
    simIndexCurrent,
    existing != null && isNineHolePlayed(existing.holesPlayed)
  );
  const scoreBounds = grossScoreBounds(holesPlayed);
  const expectedDiffPre = useMemo(() => {
    if (simIndexCurrent == null || modifier <= 0 || slope <= 0) return null;
    const ratingAnchor = parAnchorForHoles(holesPlayed);
    let e = (simIndexCurrent * slope) / 113 + (rating - ratingAnchor);
    e *= modifier;
    return Number.isFinite(e) ? round1(e) : null;
  }, [simIndexCurrent, modifier, rating, slope, holesPlayed]);
  const targetGrossPre = useMemo(() => {
    if (simIndexCurrent == null || !resolvedCourse) return null;
    const t = targetGrossToImprove(simIndexCurrent, rating, slope, modifier);
    return Number.isFinite(t) ? t : null;
  }, [simIndexCurrent, resolvedCourse, rating, slope, modifier]);

  latestSaveRef.current = {
    grossScore,
    playedDate,
    courseId,
    platform,
    putting,
    pin,
    wind,
    mulligans,
    course: resolvedCourse,
    yardsPlayed,
    existing,
    teePickKey,
    customRating,
    customSlope,
    holesPlayed,
  };

  const onSave = () => {
    const L = latestSaveRef.current;
    if (!L?.course) {
      showAppAlert(t('log.round.alerts.courseRequiredTitle'), t('log.round.alerts.courseRequiredBody'));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(L.playedDate.trim())) {
      showAppAlert(t('datePlayed.label'), t('log.round.alerts.datePlayedBody'));
      return;
    }

    const finishSave = async () => {
      const snap = latestSaveRef.current;
      if (!snap?.course) {
        showAppAlert(t('log.round.alerts.courseRequiredTitle'), t('log.round.alerts.courseRequiredBody'));
        return;
      }

      // Eligibility (holes_per_round / match_play_nine) is already enforced upstream in
      // fetchActiveTournamentsForUser via leagueAcceptsLoggedHoles, so activeTournaments only
      // contains tournaments valid for the currently selected holesPlayed value.
      const optedIn = activeTournaments.filter((tour) => tournamentApply[tour.leagueId] !== false);
      if (optedIn.length > 0 && snap.course.source === 'community') {
        showAppAlert(
          t('log.round.alerts.tournamentRoundTitle'),
          t('log.round.alerts.tournamentRoundBody')
        );
        return;
      }

      if (isNineHolePlayed(snap.holesPlayed)) {
        const hasIndex =
          currentIndexFromRounds(useAppStore.getState().rounds) != null ||
          (snap.existing != null && isNineHolePlayed(snap.existing.holesPlayed));
        if (!hasIndex) {
          showAppAlert(t('log.round.alerts.full18Title'), t('log.round.alerts.full18Body'));
          return;
        }
      }

      const playedAt = localYmdToIso(snap.playedDate);
      const grossToSave = clampGrossScore(snap.grossScore, snap.holesPlayed);

      let teeNameSave = snap.course.seed?.defaultTee ?? 'Default';
      let courseRatingSave: number;
      let slopeSave: number;
      let nineHoleSourceSave: 'derived' | 'real' | undefined;

      let teeRatingSourceSave:
        | 'curated'
        | 'community'
        | 'user_reported'
        | 'default_unrated'
        | undefined;

      if (snap.course.source === 'community') {
        const yards = parseInt(snap.yardsPlayed.replace(/,/g, '').trim(), 10);
        const yardsMin = isNineHolePlayed(snap.holesPlayed) ? 800 : 1000;
        const yardsMax = isNineHolePlayed(snap.holesPlayed) ? 5000 : 9000;
        if (!Number.isFinite(yards) || yards < yardsMin || yards > yardsMax) {
          showAppAlert(
            t('log.round.alerts.yardageTitle'),
            isNineHolePlayed(snap.holesPlayed)
              ? t('log.round.alerts.yardageBody9')
              : t('log.round.alerts.yardageBody18')
          );
          return;
        }
        const tee = nearestTeeByYards(snap.course.tees, yards);
        if (!tee) {
          showAppAlert(t('log.round.alerts.teeTitle'), t('log.round.alerts.teeNoData'));
          return;
        }
        const rs = ratingSlopeForHolesPlayed(tee, snap.holesPlayed);
        courseRatingSave = rs.rating;
        slopeSave = rs.slope;
        nineHoleSourceSave = rs.nineHoleSource ?? undefined;
        teeNameSave = tee.name;
        teeRatingSourceSave = tee.ratingSource ?? 'community';
      } else if (snap.course.source === 'custom') {
        const row =
          snap.course.tees.find((t) => t.name === snap.teePickKey) ?? snap.course.tees[0];
        if (!row) {
          showAppAlert(t('log.round.alerts.teeTitle'), t('log.round.alerts.teePickList'));
          return;
        }
        const rs = ratingSlopeForHolesPlayed(row, snap.holesPlayed);
        courseRatingSave = rs.rating;
        slopeSave = rs.slope;
        nineHoleSourceSave = rs.nineHoleSource ?? undefined;
        teeNameSave = row.name;
        teeRatingSourceSave = row.ratingSource ?? 'default_unrated';
      } else if (snap.course.confident === false && snap.course.seed) {
        const mid = middleCourseTee(snap.course.seed, snap.platform);
        if (!mid) {
          showAppAlert(t('log.round.alerts.teeTitle'), t('log.round.alerts.teeNoData'));
          return;
        }
        const rs = ratingSlopeForHolesPlayed(mid, snap.holesPlayed);
        courseRatingSave = rs.rating;
        slopeSave = rs.slope;
        nineHoleSourceSave = rs.nineHoleSource ?? undefined;
        teeNameSave = mid.name;
        teeRatingSourceSave = 'curated';
      } else if (snap.teePickKey === CUSTOM_TEE_ID) {
        const r = parseFloat(snap.customRating.replace(/,/g, '.').trim());
        const s = parseFloat(snap.customSlope.replace(/,/g, '.').trim());
        const nine = isNineHolePlayed(snap.holesPlayed);
        const rMin = nine ? 28 : 60;
        const rMax = nine ? 45 : 85;
        if (!Number.isFinite(r) || !Number.isFinite(s) || s < 55 || s > 155 || r < rMin || r > rMax) {
          showAppAlert(
            t('log.round.alerts.customTeeTitle'),
            nine
              ? t('log.round.alerts.customTeeBody9', { rMin, rMax })
              : t('log.round.alerts.customTeeBody18')
          );
          return;
        }
        courseRatingSave = round1(r);
        slopeSave = Math.round(s);
        teeNameSave = 'Custom';
        nineHoleSourceSave = nine ? 'real' : undefined;
        teeRatingSourceSave = 'user_reported';
      } else if (snap.course.seed) {
        const tees = getCourseTees(snap.course.seed, snap.platform);
        const row = tees.find((t) => t.name === snap.teePickKey);
        if (!row) {
          showAppAlert(t('log.round.alerts.teeTitle'), t('log.round.alerts.teePickList'));
          return;
        }
        const rs = ratingSlopeForHolesPlayed(row, snap.holesPlayed);
        courseRatingSave = rs.rating;
        slopeSave = rs.slope;
        nineHoleSourceSave = rs.nineHoleSource ?? undefined;
        teeNameSave = row.name;
        teeRatingSourceSave = 'curated';
      } else {
        showAppAlert(t('log.round.alerts.teeTitle'), t('log.round.alerts.teePick'));
        return;
      }

      if (__DEV__ && DEBUG_LOG_GROSS_SAVE) {
        // eslint-disable-next-line no-console
        console.log('[simhandicap log save]', {
          platform: Platform.OS,
          stateGross: snap.grossScore,
          grossToSave,
          holesPlayed: snap.holesPlayed,
        });
      }
      const base = {
        courseId: snap.courseId,
        courseName: snap.course.name,
        platform: snap.platform,
        grossScore: grossToSave,
        holeScores: [],
        putting: snap.putting,
        pin: snap.pin,
        wind: snap.wind,
        mulligans: snap.mulligans,
        playedAt,
        teeName: teeNameSave,
        courseRating: courseRatingSave,
        slope: slopeSave,
        holesPlayed: snap.holesPlayed,
        nineHoleSource: nineHoleSourceSave,
        handicapSource: snap.course.handicapSource,
        teeRatingSource: teeRatingSourceSave,
        ...(snap.existing?.h2hGroupId &&
        snap.existing.h2hOpponentMemberId &&
        snap.existing.h2hOpponentDisplayName
          ? {
              h2hGroupId: snap.existing.h2hGroupId,
              h2hOpponentMemberId: snap.existing.h2hOpponentMemberId,
              h2hOpponentDisplayName: snap.existing.h2hOpponentDisplayName,
            }
          : {}),
      };
      try {
        if (snap.existing) {
          await updateRound(snap.existing.id, base);
          resetLogForm();
          router.replace('/(tabs)/analyze');
        } else {
          const optedIn = activeTournaments.filter(
            (tour) => tournamentApply[tour.leagueId] !== false
          );
          const hasScrambleOptIn = optedIn.some((tour) => tour.format === 'scramble');
          const hasIndexCountingOptIn = optedIn.some(
            (tour) => tour.format === 'stroke' || tour.format === 'best_ball'
          );
          const excludesFromSimcapIndex = hasScrambleOptIn && !hasIndexCountingOptIn;

          const saved = await addRound({
            ...base,
            excludesFromSimcapIndex: excludesFromSimcapIndex || undefined,
          });
          resetLogForm();

          let leagueBanner: string | undefined;
          if (supabaseOn && user?.id && optedIn.length > 0) {
            const displayNames: Record<string, string> = {};
            for (const gr of groups) {
              for (const m of gr.members) {
                if (m.userId) displayNames[m.userId] = m.displayName.replace(' (you)', '');
              }
            }
            const saveAccessToken =
              googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
            const snapshot = courseSnapshot(saved.courseId, saved.holesPlayed);
            // Read store after addRound — render-time `rounds` can lag when the user logs
            // several rounds quickly without a remount (stale closure → net falls back to gross).
            const storeAfterSave = useAppStore.getState();
            const leagueResults = await recordOptedInLeagueRounds({
              userId: user.id,
              roundId: saved.id,
              grossScore: saved.grossScore,
              playedAt: saved.playedAt,
              simIndex: effectiveHandicapForLeagueRecording(
                roundsForLeagueRecordingAfterSave(storeAfterSave.rounds, saved),
                latestGhinIndex(storeAfterSave.ghinSnapshots)
              ),
              selections: activeTournaments.map((tour) => ({
                leagueId: tour.leagueId,
                apply: tournamentApply[tour.leagueId] !== false,
              })),
              displayNames,
              accessToken: saveAccessToken,
              holesPlayed: saved.holesPlayed ?? '18',
              courseId: saved.courseId,
              courseRating: saved.courseRating,
              slope: saved.slope,
              coursePar: snapshot.course_par,
            });
            const pendingHoleResults = leagueResults.filter((r) => r.needsHoleByHoleEntry);
            const completedLeagueResults = leagueResults.filter((r) => !r.needsHoleByHoleEntry);

            if (completedLeagueResults.length > 0) {
              const hit = completedLeagueResults[0];
              const place = ordinalPlace(hit.position);
              const isTeamFmt = isTeamLeagueFormat(hit.format);
              leagueBanner =
                isTeamFmt && hit.teamName
                  ? t('log.round.leagueBannerTeam', { teamName: hit.teamName, place })
                  : t('log.round.leagueBanner', { leagueName: hit.leagueName, place });
            }

            if (pendingHoleResults.length > 0) {
              const [first, ...rest] = pendingHoleResults;
              router.replace({
                pathname: '/(tabs)/tournament-holes/[leagueRoundId]',
                params: {
                  leagueRoundId: first.leagueRoundId,
                  leagueId: first.leagueId,
                  format: first.format,
                  grossScore: String(saved.grossScore),
                  courseId: snap.courseId,
                  leagueName: first.leagueName,
                  shareRoundId: saved.id,
                  ...(rest.length > 0
                    ? {
                        queue: JSON.stringify(
                          rest.map((r) => ({
                            leagueRoundId: r.leagueRoundId,
                            leagueId: r.leagueId,
                            format: r.format,
                            leagueName: r.leagueName,
                            grossScore: String(saved.grossScore),
                            courseId: snap.courseId,
                          }))
                        ),
                      }
                    : {}),
                },
              } as never);
              return;
            }
          }
          router.replace({
            pathname: '/(tabs)/analyze',
            params: {
              ...(leagueBanner ? { leagueBanner } : {}),
              shareRoundId: saved.id,
            },
          });
        }
      } catch (e) {
        showAppAlert(t('log.round.alerts.couldNotSave'), String(e));
      }
    };

    void finishSave();
  };

  return (
    <ContentWidth bg={colors.surface}>
      <>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 56 : 0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingTop: Math.max(gutter, 14),
            paddingBottom: insets.bottom + 100,
          }}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          <PendingTournamentHolesBanner gutter={0} />
          <View style={isWide ? styles.pickRow : undefined}>
            <View style={isWide ? styles.pickCol : undefined}>
              <Text style={styles.sectionLabel}>{t('log.round.simPlatform')}</Text>
              <Pressable style={[styles.pill, platOpen && styles.pillActive]} onPress={() => setPlatOpen(true)}>
                <Text style={styles.pillVal}>{platform}</Text>
                <Text style={styles.chev}>▾</Text>
              </Pressable>
            </View>
            <View style={isWide ? styles.pickCol : undefined}>
              <Text style={styles.sectionLabel}>{t('log.round.course')}</Text>
              <Pressable
                style={[styles.pill, courseOpen && styles.pillActive]}
                onPress={() => {
                  setDismissCourseSuggestions(false);
                  setCourseOpen(true);
                }}
              >
                <View style={styles.pillValRow}>
                  <Text style={styles.pillVal}>{resolvedCourse?.name ?? t('log.round.select')}</Text>
                  {resolvedCourse?.source === 'custom' ? (
                    <UnratedCourseBadge compact />
                  ) : resolvedCourse?.handicapSource === 'unverified' ? (
                    <UnverifiedCourseBadge
                      compact
                      source={resolvedCourse.source}
                      confident={resolvedCourse.confident}
                      enrichmentTier={resolvedCourse.enrichmentTier}
                      enrichmentSource={resolvedCourse.enrichmentSource}
                    />
                  ) : null}
                </View>
                <Text style={styles.chev}>▾</Text>
              </Pressable>
            </View>
          </View>

          {isGsProPlatform(platform) ? (
            <>
              <Pressable
                style={[styles.scanBtn, scanBusy && styles.scanBtnDisabled]}
                disabled={scanBusy || !supabaseOn || !user}
                onPress={() => void onScanScorecard()}
                accessibilityRole="button"
                accessibilityLabel={t('log.round.scanScorecardA11y')}
              >
                {scanBusy ? (
                  <ActivityIndicator color={colors.sage} size="small" />
                ) : (
                  <Text style={styles.scanBtnTxt}>{t('log.round.scanScorecard')}</Text>
                )}
              </Pressable>
              <Text style={styles.scanTip}>{t('log.round.scanTip')}</Text>
              {scanBanner ? (
                <View
                  style={[
                    styles.scanBanner,
                    scanBanner === 'failed'
                      ? styles.scanBannerRed
                      : scanBanner === 'low'
                        ? styles.scanBannerYellow
                        : styles.scanBannerGreen,
                  ]}
                >
                  <Text
                    style={[
                      styles.scanBannerTxt,
                      scanBanner === 'failed'
                        ? styles.scanBannerTxtRed
                        : scanBanner === 'low'
                          ? styles.scanBannerTxtYellow
                          : styles.scanBannerTxtGreen,
                    ]}
                  >
                    {scanBannerText(t, scanBanner, scanBannerDetail ?? undefined)}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}

          <DatePlayedField value={playedDate} onChange={setPlayedDate} />

          <Text style={styles.sectionLabel}>{t('log.round.holes')}</Text>
          <View style={styles.dayRow}>
            {(
              [
                { key: '18' as const, title: t('log.round.holes18'), sub: t('log.round.holes18Sub') },
                { key: 'front' as const, title: t('roundList.front9'), sub: t('log.round.front9Sub') },
                { key: 'back' as const, title: t('roundList.back9'), sub: t('log.round.back9Sub') },
              ] as const
            ).map((h) => {
              const locked = h.key !== '18' && !canLogNineHole;
              const on = holesPlayed === h.key;
              return (
                <Pressable
                  key={h.key}
                  style={[
                    styles.dayBtn,
                    on && styles.dayBtnOn,
                    locked && styles.dayBtnLocked,
                  ]}
                  disabled={locked}
                  onPress={() => {
                    setHolesPlayed(h.key);
                    setGrossScore(parAnchorForHoles(h.key));
                  }}
                  accessibilityState={{ disabled: locked, selected: on }}
                >
                  <Text style={[styles.dayDn, on && styles.dayDnOn, locked && styles.dayDnLocked]}>
                    {h.title}
                  </Text>
                  <Text style={[styles.dayDs, on && styles.dayDsOn, locked && styles.dayDsLocked]}>
                    {h.sub}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!canLogNineHole ? (
            <Text style={styles.teeTip}>{t('log.round.nineHoleLockedTip')}</Text>
          ) : null}

          {showYardageInput ? (
            <>
              <Text style={styles.sectionLabel}>{t('log.round.yardagePlayed')}</Text>
              <Text style={styles.teeTip}>{t('log.round.yardageTip')}</Text>
              <TextInput
                style={styles.courseSearchInput}
                value={yardsPlayed}
                onChangeText={setYardsPlayed}
                placeholder={t('log.round.yardagePlaceholder')}
                placeholderTextColor={colors.subtle}
                keyboardType="number-pad"
                inputAccessoryViewID={Platform.OS === 'ios' ? LOG_ROUND_NUMERIC_ACCESSORY_ID : undefined}
              />
            </>
          ) : null}

          {resolvedCourse && showTeeSelector ? (
            <>
              <Text style={styles.sectionLabel}>{t('log.round.tee')}</Text>
              <Text style={styles.teeTip}>{t('log.round.teeTip')}</Text>
              <View style={styles.teeChipWrap}>
                {courseTees.map((teeRow) => {
                  const yardsFull =
                    (typeof teeRow.yards === 'number' && Number.isFinite(teeRow.yards)
                      ? teeRow.yards
                      : undefined) ??
                    (resolvedCourse.source === 'curated' && resolvedCourse.seed
                      ? yardageForCourseTee(resolvedCourse.seed.id, teeRow.name)
                      : undefined);
                  const chipRs = ratingSlopeForHolesPlayed(teeRow, holesPlayed);
                  const yards =
                    yardsFull != null && isNineHolePlayed(holesPlayed)
                      ? Math.round(yardsFull / 2)
                      : yardsFull;
                  return (
                  <Pressable
                    key={teeRow.name}
                    style={[styles.teeChip, teePickKey === teeRow.name && styles.teeChipOn]}
                    onPress={() => {
                      setTeePickKey(teeRow.name);
                      setCustomRating('');
                      setCustomSlope('');
                    }}
                  >
                    <Text style={[styles.teeChipTxt, teePickKey === teeRow.name && styles.teeChipTxtOn]}>
                      {teeRow.name}
                    </Text>
                    <Text style={[styles.teeChipSub, teePickKey === teeRow.name && styles.teeChipSubOn]}>
                      {yards != null
                        ? t('log.round.teeChipYards', {
                            rating: chipRs.rating,
                            slope: chipRs.slope,
                            yards: yards.toLocaleString('en-US'),
                          })
                        : t('log.round.teeChipRatingSlope', {
                            rating: chipRs.rating,
                            slope: chipRs.slope,
                          })}
                    </Text>
                  </Pressable>
                  );
                })}
                {resolvedCourse.source === 'curated' ? (
                <Pressable
                  style={[styles.teeChip, teePickKey === CUSTOM_TEE_ID && styles.teeChipOn]}
                  onPress={() => setTeePickKey(CUSTOM_TEE_ID)}
                >
                  <Text style={[styles.teeChipTxt, teePickKey === CUSTOM_TEE_ID && styles.teeChipTxtOn]}>
                    {t('log.round.custom')}
                  </Text>
                  <Text style={[styles.teeChipSub, teePickKey === CUSTOM_TEE_ID && styles.teeChipSubOn]}>
                    {isNineHolePlayed(holesPlayed)
                      ? t('log.round.customTeeSubNine', {
                          holes:
                            holesPlayed === 'front'
                              ? t('roundList.front9')
                              : t('roundList.back9'),
                        })
                      : t('log.round.customTeeSub')}
                  </Text>
                </Pressable>
                ) : null}
              </View>
              {resolvedCourse.source === 'custom' && selectedCustomTee ? (
                <View style={styles.unratedBox}>
                  {isUnratedTee(selectedCustomTee.ratingSource) ? (
                    <Text style={styles.unratedBoxTxt}>
                      {selectedCustomTee.ratingSource === 'user_reported'
                        ? t('log.round.unratedDisclosureReported', {
                            rating: selectedCustomTee.rating,
                            slope: selectedCustomTee.slope,
                          })
                        : t('log.round.unratedDisclosure', {
                            par: selectedCustomTee.par ?? selectedCustomTee.rating,
                            slope: selectedCustomTee.slope || DEFAULT_UNRATED_SLOPE,
                          })}
                    </Text>
                  ) : null}
                  <UnratedCourseBadge />
                  <Pressable
                    style={styles.addTeeLink}
                    onPress={() => {
                      setAddTeeName('');
                      setAddTeePar('72');
                      setAddTeeYards('');
                      setAddTeeKnowOfficial(false);
                      setAddTeeRating('');
                      setAddTeeSlope('');
                      setAddTeeOpen(true);
                    }}
                  >
                    <Text style={styles.addTeeLinkTxt}>{t('log.round.addTeeToCourse')}</Text>
                  </Pressable>
                </View>
              ) : null}
              {teePickKey === CUSTOM_TEE_ID && resolvedCourse.source === 'curated' ? (
                <View style={styles.teeCustomRow}>
                  <View style={styles.teeCustomField}>
                    <Text style={styles.teeCustomLbl}>
                      {isNineHolePlayed(holesPlayed)
                        ? t('log.round.nineRating', {
                            holes:
                              holesPlayed === 'front'
                                ? t('roundList.front9')
                                : t('roundList.back9'),
                          })
                        : t('log.round.courseRating')}
                    </Text>
                    <TextInput
                      style={styles.teeNumInput}
                      value={customRating}
                      onChangeText={setCustomRating}
                      placeholder={
                        isNineHolePlayed(holesPlayed)
                          ? t('log.round.ratingPlaceholder9')
                          : t('log.round.ratingPlaceholder18')
                      }
                      placeholderTextColor={colors.subtle}
                      keyboardType="decimal-pad"
                      inputAccessoryViewID={Platform.OS === 'ios' ? LOG_ROUND_NUMERIC_ACCESSORY_ID : undefined}
                    />
                  </View>
                  <View style={styles.teeCustomField}>
                    <Text style={styles.teeCustomLbl}>{t('log.round.slope')}</Text>
                    <TextInput
                      style={styles.teeNumInput}
                      value={customSlope}
                      onChangeText={setCustomSlope}
                      placeholder={t('log.round.slopePlaceholder')}
                      placeholderTextColor={colors.subtle}
                      keyboardType="number-pad"
                      inputAccessoryViewID={Platform.OS === 'ios' ? LOG_ROUND_NUMERIC_ACCESSORY_ID : undefined}
                    />
                  </View>
                </View>
              ) : null}
            </>
          ) : null}

        <Text style={styles.sectionLabel}>{t('log.round.score')}</Text>
        <View style={styles.scoreBlock}>
          <View style={styles.scoreMain}>
            <Pressable
              style={styles.scoreBtn}
              onPress={() => {
                setGrossScore((g) => Math.max(scoreBounds.min, g - 1));
              }}
            >
              <Text style={styles.scoreBtnTxt}>−</Text>
            </Pressable>
            <View style={[styles.scoreInput, styles.scoreInputStatic]}>
              <Text style={styles.scoreInputStaticTxt}>{String(grossScore)}</Text>
            </View>
            <Pressable
              style={styles.scoreBtn}
              onPress={() => {
                setGrossScore((g) => Math.min(scoreBounds.max, g + 1));
              }}
            >
              <Text style={styles.scoreBtnTxt}>+</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionLabel}>{t('log.round.puttingMode')}</Text>
        <View style={styles.dayRow}>
          {PUTTING_KEYS.map((key) => (
            <Pressable
              key={key}
              style={[styles.dayBtn, putting === key && styles.dayBtnOn]}
              onPress={() => setPutting(key)}
            >
              <Text style={[styles.dayDn, putting === key && styles.dayDnOn]}>
                {t(`log.round.putting.${key}.dn`)}
              </Text>
              <Text style={[styles.dayDs, putting === key && styles.dayDsOn]}>
                {t(`log.round.putting.${key}.ds`)}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>{t('log.round.pinPlacement')}</Text>
        <View style={styles.dayRow}>
          {pinOpts.map((d) => {
            const sub = pinSublabel(d.key, platform);
            return (
            <Pressable key={d.key} style={[styles.dayBtn, pin === d.key && styles.dayBtnOn]} onPress={() => setPin(d.key)}>
              <Text style={[styles.dayDn, pin === d.key && styles.dayDnOn]}>
                {pinLabel(d.key, platform)}
              </Text>
              {sub ? (
                <Text style={[styles.dayDs, pin === d.key && styles.dayDsOn]}>{sub}</Text>
              ) : null}
            </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>{t('log.round.wind')}</Text>
        <View style={styles.dayRow}>
          {WIND_KEYS.map((key) => (
            <Pressable
              key={key}
              style={[styles.dayBtn, wind === key && styles.dayBtnOn]}
              onPress={() => setWind(key)}
            >
              <Text style={[styles.dayDn, wind === key && styles.dayDnOn]}>
                {t(`log.round.windOpts.${key}.dn`)}
              </Text>
              <Text style={[styles.dayDs, wind === key && styles.dayDsOn]}>
                {t(`log.round.windOpts.${key}.ds`)}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>{t('log.round.mulligans')}</Text>
        <View style={styles.dayRow}>
          {MULL_KEYS.map((key) => (
            <Pressable
              key={key}
              style={[styles.dayBtn, mulligans === key && styles.dayBtnOn]}
              onPress={() => setMulligans(key)}
            >
              <Text style={[styles.dayDn, mulligans === key && styles.dayDnOn]}>
                {t(`log.round.mulliganOpts.${key}.dn`)}
              </Text>
              <Text style={[styles.dayDs, mulligans === key && styles.dayDsOn]}>
                {t(`log.round.mulliganOpts.${key}.ds`)}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.diffWrap}>
          <View style={styles.diffTop}>
            <Text style={styles.diffLbl}>{t('log.round.difficultyModifier')}</Text>
            <Text style={styles.diffNum}>{modifier.toFixed(2)}</Text>
          </View>
          <View style={styles.diffTrack}>
            <View style={[styles.diffFill, { width: `${modPct}%` }]} />
          </View>
        </View>

        {resolvedCourse ? (
          <View style={styles.predCard}>
            <View style={styles.predStatRow}>
              <Text style={styles.predStatLbl}>{t('log.round.adjustedDifferential')}</Text>
              <View style={styles.predStatRight}>
                <Text style={styles.predAdjustedNum}>{adjustedDisplay}</Text>
                <Pressable
                  style={styles.infoBtn}
                  onPress={() => setDiffInfoOpen('adjusted')}
                  accessibilityRole="button"
                  accessibilityLabel={t('log.round.adjustedDiffA11y')}
                >
                  <Text style={styles.infoBtnTxt}>ⓘ</Text>
                </Pressable>
              </View>
            </View>
            {expectedDiffPre != null ? (
              <>
                <View style={[styles.predStatRow, styles.predStatRowSpaced]}>
                  <Text style={styles.predStatLbl}>{t('log.round.expectedDifferential')}</Text>
                  <View style={styles.predStatRight}>
                    <Text style={styles.predExpectedNum}>{formatDifferentialDisplay(expectedDiffPre)}</Text>
                    <Pressable
                      style={styles.infoBtn}
                      onPress={() => setDiffInfoOpen('expected')}
                      accessibilityRole="button"
                      accessibilityLabel={t('log.round.expectedDiffA11y')}
                    >
                      <Text style={styles.infoBtnTxt}>ⓘ</Text>
                    </Pressable>
                  </View>
                </View>
                {targetGrossPre != null &&
                targetGrossPre >= scoreBounds.min &&
                targetGrossPre <= scoreBounds.max ? (
                  <Text style={styles.predTarget}>
                    {t('log.round.shootTarget', { score: targetGrossPre })}
                  </Text>
                ) : (
                  <Text style={styles.predTargetSoft}>
                    {t('log.round.benchmarkOutside', {
                      min: scoreBounds.min,
                      max: scoreBounds.max,
                    })}
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.predNoIndex}>{t('log.round.noIndexYet')}</Text>
            )}
          </View>
        ) : null}

        {!existing && tournamentsReady && activeTournaments.length > 0 ? (
          <View style={styles.tournamentSection}>
            <Text style={styles.tournamentSectionTitle}>{t('log.round.activeTournaments')}</Text>
            {activeTournaments.map((tour) => {
                const apply = tournamentApply[tour.leagueId] !== false;
                return (
                  <View key={tour.leagueId} style={styles.tournamentCard}>
                    <Text style={styles.tournamentQ}>
                      {t('log.round.applyToTournament', { leagueName: tour.leagueName })}
                    </Text>
                    <Text style={styles.tournamentMeta}>{tour.groupName}</Text>
                    <View style={styles.tournamentYesNo}>
                      <Pressable
                        style={[styles.tournamentOpt, apply && styles.tournamentOptOn]}
                        onPress={() =>
                          setTournamentApply((prev) => ({ ...prev, [tour.leagueId]: true }))
                        }
                      >
                        <Text style={[styles.tournamentOptTxt, apply && styles.tournamentOptTxtOn]}>
                          {t('log.round.yes')}
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.tournamentOpt, !apply && styles.tournamentOptOn]}
                        onPress={() =>
                          setTournamentApply((prev) => ({ ...prev, [tour.leagueId]: false }))
                        }
                      >
                        <Text style={[styles.tournamentOptTxt, !apply && styles.tournamentOptTxtOn]}>
                          {t('log.round.no')}
                        </Text>
                      </Pressable>
                    </View>
                    {tour.format === 'scramble' ? (
                      <Text style={styles.tournamentTeamNote}>{t('log.round.scrambleNote')}</Text>
                    ) : null}
                    {tour.format === 'best_ball' ? (
                      <Text style={styles.tournamentTeamNote}>{t('log.round.bestBallNote')}</Text>
                    ) : null}
                  </View>
                );
              })}
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.saveBtn,
            isWide && styles.saveBtnLg,
            pressed && styles.saveBtnPressed,
          ]}
          onPress={onSave}
          accessibilityRole="button"
          accessibilityLabel={existing ? t('log.round.updateRoundA11y') : t('log.round.saveRoundA11y')}
          hitSlop={{ top: 8, bottom: 12, left: 8, right: 8 }}
        >
          <Text style={styles.saveTxt}>
            {existing ? t('log.round.saveChanges') : t('log.round.saveRound')}
          </Text>
        </Pressable>
        <Text style={styles.saveHint}>{t('log.round.saveHint')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={diffInfoOpen != null}
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        transparent
        onRequestClose={() => setDiffInfoOpen(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdropPress} onPress={() => setDiffInfoOpen(null)} />
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.modalTitle}>
              {diffInfoOpen === 'adjusted'
                ? t('log.round.diffInfoAdjustedTitle')
                : t('log.round.diffInfoExpectedTitle')}
            </Text>
            <Text style={styles.diffInfoBody}>
              {diffInfoOpen === 'adjusted'
                ? t('log.round.diffInfoAdjustedBody')
                : t('log.round.diffInfoExpectedBody')}
            </Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={platOpen}
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        transparent
        onRequestClose={() => setPlatOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdropPress} onPress={() => setPlatOpen(false)} />
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.modalTitle}>{t('log.round.platformModal')}</Text>
            {PLATFORMS.map((p) => (
              <Pressable
                key={p}
                style={styles.modalRow}
                onPress={() => {
                  setPlatform(p);
                  setPlatOpen(false);
                }}
              >
                <Text style={styles.modalRowTxt}>{p}</Text>
                {platform === p ? <IconCheckmark size={18} color={colors.accent} /> : null}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      <Modal
        visible={courseOpen}
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        transparent
        onRequestClose={() => setCourseOpen(false)}
      >
        <View
          style={[
            styles.modalRoot,
            { paddingBottom: keyboardBottomInset > 0 ? keyboardBottomInset : 0 },
          ]}
        >
          <Pressable
            style={styles.modalBackdropPress}
            onPress={() => {
              Keyboard.dismiss();
              setCourseOpen(false);
            }}
          />
          <View
            style={[
              styles.modalSheet,
              styles.modalSheetTall,
              keyboardBottomInset > 0 && styles.modalSheetTallKeyboard,
              {
                paddingBottom:
                  keyboardBottomInset > 0 ? 12 : insets.bottom + 16,
              },
            ]}
          >
            <Text style={styles.modalTitle}>{t('log.round.course')}</Text>
            <TextInput
              style={styles.courseSearchInput}
              value={courseSearchQuery}
              onChangeText={(q) => {
                setCourseSearchQuery(q);
                setDismissCourseSuggestions(false);
              }}
              placeholder={t('log.round.searchCourse')}
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
              blurOnSubmit={false}
            />
            <FlatList
              data={dismissCourseSuggestions ? [] : coursesForPicker}
              keyExtractor={(c) => c.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              style={[styles.courseSearchList, { maxHeight: courseListMaxHeight }]}
              nestedScrollEnabled
              initialNumToRender={24}
              windowSize={10}
              ListEmptyComponent={
                <Text style={styles.courseSearchEmpty}>{t('log.round.noCoursesMatch')}</Text>
              }
              ListFooterComponent={
                <View style={styles.coursePickerFooter}>
                  {!dismissCourseSuggestions && coursesForPicker.length > 0 && courseSearchQuery.trim() ? (
                    <Pressable
                      style={styles.coursePickerFooterBtn}
                      onPress={() => setDismissCourseSuggestions(true)}
                    >
                      <Text style={styles.coursePickerFooterTxt}>
                        {t('log.round.dismissSuggestions')}
                      </Text>
                    </Pressable>
                  ) : null}
                  {showAddNewCourseCta || dismissCourseSuggestions ? (
                    <Pressable
                      style={styles.coursePickerFooterBtnPrimary}
                      onPress={() => {
                        Keyboard.dismiss();
                        setCourseOpen(false);
                        setCustomCreateOpen(true);
                      }}
                    >
                      <Text style={styles.coursePickerFooterTxtPrimary}>
                        {t('log.round.addNewCourse')}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              }
              renderItem={({ item: c }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    Keyboard.dismiss();
                    setCourseId(c.id);
                    setDismissCourseSuggestions(false);
                    if (c.source === 'community') {
                      setYardsPlayed('');
                      setCourseOpen(false);
                      return;
                    }
                    if (c.source === 'custom') {
                      const row = customCourses.find((x) => x.id === c.id);
                      if (row?.course_tees?.[0]) setTeePickKey(row.course_tees[0].name);
                      setCourseOpen(false);
                      return;
                    }
                    const seed = getCourseById(c.id);
                    if (!seed) {
                      setCourseOpen(false);
                      return;
                    }
                    const teesPick = getCourseTees(seed, platform);
                    if (seed.confident === false && teesPick.length > 0) {
                      setTeePickKey(teesPick[Math.floor(teesPick.length / 2)].name);
                    } else {
                      const defPick = seed.defaultTee?.trim();
                      setTeePickKey(
                        teesPick.find((t) => t.name === defPick)?.name ??
                          teesPick[teesPick.length - 1]?.name ??
                          teesPick[0].name
                      );
                    }
                    setCustomRating('');
                    setCustomSlope('');
                    setCourseOpen(false);
                  }}
                >
                  <View style={styles.modalRowCourse}>
                    <Text style={styles.modalRowTxt}>{c.name}</Text>
                    <Text style={styles.courseSourceLbl}>
                      {c.source === 'curated'
                        ? t('course.badge.sourceCurated')
                        : c.source === 'community'
                          ? t('course.badge.sourceCommunity')
                          : t('course.badge.sourceCustom')}
                    </Text>
                    {c.source === 'community' || (c.source === 'curated' && !c.confident) ? (
                      <UnverifiedCourseBadge
                        compact
                        source={c.source}
                        confident={c.confident}
                        enrichmentTier={c.enrichmentTier}
                        enrichmentSource={c.enrichmentSource}
                      />
                    ) : c.source === 'custom' ? (
                      <UnratedCourseBadge compact />
                    ) : null}
                  </View>
                  {courseId === c.id ? <IconCheckmark size={18} color={colors.accent} /> : null}
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>

      {user?.id ? (
        <CustomCourseCreateModal
          visible={customCreateOpen}
          userId={user.id}
          initialName={courseSearchQuery.trim()}
          onClose={() => setCustomCreateOpen(false)}
          onCreated={(course) => {
            setCustomCourses((prev) => {
              if (prev.some((c) => c.id === course.id)) {
                return prev.map((c) => (c.id === course.id ? course : c));
              }
              return [...prev, course].sort((a, b) => a.name.localeCompare(b.name));
            });
            setCourseId(course.id);
            if (course.course_tees[0]) setTeePickKey(course.course_tees[0].name);
            setCustomCreateOpen(false);
            setDismissCourseSuggestions(false);
          }}
        />
      ) : null}

      <Modal
        visible={addTeeOpen}
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        transparent
        onRequestClose={() => setAddTeeOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdropPress} onPress={() => setAddTeeOpen(false)} />
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.modalTitle}>{t('log.round.addTeeToCourse')}</Text>
            <Text style={styles.teeTip}>{t('log.round.customCourse.teeName')}</Text>
            <TextInput
              style={styles.courseSearchInput}
              value={addTeeName}
              onChangeText={setAddTeeName}
              placeholder={t('log.round.customCourse.teeNamePlaceholder')}
              placeholderTextColor={colors.subtle}
            />
            <View style={styles.teeCustomRow}>
              <View style={styles.teeCustomField}>
                <Text style={styles.teeCustomLbl}>{t('log.round.customCourse.par')}</Text>
                <TextInput
                  style={styles.teeNumInput}
                  value={addTeePar}
                  onChangeText={setAddTeePar}
                  keyboardType="number-pad"
                  placeholder="72"
                  placeholderTextColor={colors.subtle}
                />
              </View>
              <View style={styles.teeCustomField}>
                <Text style={styles.teeCustomLbl}>{t('log.round.customCourse.yards')}</Text>
                <TextInput
                  style={styles.teeNumInput}
                  value={addTeeYards}
                  onChangeText={setAddTeeYards}
                  keyboardType="number-pad"
                  placeholder={t('log.round.customCourse.yardsOptional')}
                  placeholderTextColor={colors.subtle}
                />
              </View>
            </View>
            <Pressable
              style={styles.addTeeCheckRow}
              onPress={() => setAddTeeKnowOfficial((v) => !v)}
            >
              <Text style={styles.teeTip}>{t('log.round.customCourse.knowOfficial')}</Text>
            </Pressable>
            {addTeeKnowOfficial ? (
              <View style={styles.teeCustomRow}>
                <View style={styles.teeCustomField}>
                  <Text style={styles.teeCustomLbl}>{t('log.round.courseRating')}</Text>
                  <TextInput
                    style={styles.teeNumInput}
                    value={addTeeRating}
                    onChangeText={setAddTeeRating}
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors.subtle}
                  />
                </View>
                <View style={styles.teeCustomField}>
                  <Text style={styles.teeCustomLbl}>{t('log.round.slope')}</Text>
                  <TextInput
                    style={styles.teeNumInput}
                    value={addTeeSlope}
                    onChangeText={setAddTeeSlope}
                    keyboardType="number-pad"
                    placeholderTextColor={colors.subtle}
                  />
                </View>
              </View>
            ) : null}
            <Pressable
              style={[styles.saveBtnInline, addTeeBusy && { opacity: 0.6 }]}
              disabled={addTeeBusy}
              onPress={() => {
                void (async () => {
                  if (!resolvedCourse || resolvedCourse.source !== 'custom' || addTeeBusy) return;
                  setAddTeeBusy(true);
                  try {
                    const par = parseInt(addTeePar.replace(/,/g, '').trim(), 10);
                    const yardsRaw = addTeeYards.replace(/,/g, '').trim();
                    const yards = yardsRaw ? parseInt(yardsRaw, 10) : null;
                    const result = await addTeeToCustomCourse({
                      courseId: resolvedCourse.id,
                      tee: {
                        name: addTeeName.trim() || 'White',
                        par,
                        yards: yards != null && Number.isFinite(yards) ? yards : null,
                        ratingRaw: addTeeKnowOfficial ? addTeeRating : '',
                        slopeRaw: addTeeKnowOfficial ? addTeeSlope : '',
                      },
                    });
                    if ('error' in result) {
                      showAppAlert(t('log.round.customCourse.alerts.createTitle'), result.error);
                      return;
                    }
                    setCustomCourses((prev) =>
                      prev.map((c) => (c.id === result.course.id ? result.course : c))
                    );
                    setTeePickKey(addTeeName.trim() || 'White');
                    setAddTeeOpen(false);
                  } finally {
                    setAddTeeBusy(false);
                  }
                })();
              }}
            >
              {addTeeBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnInlineTxt}>{t('log.round.customCourse.save')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      <NumericKeyboardDoneBar />
      </>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.surface, width: '100%' },
  scroll: { flex: 1, minHeight: 0, width: '100%' },
  pickRow: { flexDirection: 'row', gap: 12, width: '100%' },
  pickCol: { flex: 1, minWidth: 0 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.subtle,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 5,
    marginTop: 10,
  },
  scanBtn: {
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    backgroundColor: colors.surface,
  },
  scanBtnDisabled: { opacity: 0.6 },
  scanBtnTxt: { fontSize: 15, fontWeight: '700', color: colors.sage },
  scanBanner: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  scanBannerGreen: {
    backgroundColor: '#ecf6f1',
    borderColor: colors.sage,
  },
  scanBannerYellow: {
    backgroundColor: '#fff8eb',
    borderColor: colors.warn,
  },
  scanBannerRed: {
    backgroundColor: '#fef2f2',
    borderColor: colors.danger,
  },
  scanBannerTxt: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  scanBannerTxtGreen: { color: colors.forestMid },
  scanBannerTxtYellow: { color: colors.warn },
  scanBannerTxtRed: { color: colors.danger },
  scanTip: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginTop: 8,
    marginBottom: 4,
  },
  teeTip: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginBottom: 10,
  },
  teeChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  teeChip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    backgroundColor: colors.surface,
    minWidth: 72,
  },
  teeChipOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  teeChipTxt: { fontSize: 12, fontWeight: '700', color: colors.ink },
  teeChipTxtOn: { color: colors.accentDark },
  teeChipSub: { fontSize: 9, color: colors.subtle, marginTop: 2 },
  teeChipSubOn: { color: colors.accent },
  teeCustomRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  teeCustomField: { flex: 1, minWidth: 0 },
  teeCustomLbl: { fontSize: 10, fontWeight: '600', color: colors.subtle, marginBottom: 4 },
  teeNumInput: {
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  pill: {
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 11,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  pillActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pillValRow: { flexDirection: 'row', alignItems: 'center', flex: 1, flexWrap: 'wrap', gap: 4 },
  pillVal: { fontSize: 12, fontWeight: '600', color: colors.ink },
  chev: { fontSize: 9, color: colors.subtle },
  scoreBlock: { borderWidth: 0.5, borderColor: colors.pillBorder, borderRadius: 9, overflow: 'hidden' },
  scoreMain: { flexDirection: 'row', alignItems: 'center' },
  scoreBtn: {
    width: 40,
    height: 44,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreBtnTxt: { fontSize: 18, color: colors.muted },
  scoreInput: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '600',
    color: colors.ink,
    borderLeftWidth: 0.5,
    borderRightWidth: 0.5,
    borderColor: colors.border,
    paddingVertical: 10,
    minWidth: 0,
  },
  scoreInputStatic: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreInputStaticTxt: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.ink,
    textAlign: 'center',
    width: '100%',
  },
  dayRow: { flexDirection: 'row', gap: 5 },
  dayBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  dayBtnOn: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  dayBtnLocked: { opacity: 0.45 },
  dayDn: { fontSize: 11, fontWeight: '600', color: colors.muted },
  dayDnOn: { color: colors.accentDark },
  dayDnLocked: { color: colors.subtle },
  dayDs: { fontSize: 9, color: colors.subtle, marginTop: 1 },
  dayDsOn: { color: colors.accent },
  dayDsLocked: { color: colors.subtle },
  diffWrap: { backgroundColor: colors.bg, borderRadius: 9, padding: 10, marginTop: 12 },
  diffTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  diffLbl: { fontSize: 11, color: colors.muted },
  diffNum: { fontSize: 16, fontWeight: '600', color: colors.ink },
  diffTrack: { height: 5, borderRadius: 99, backgroundColor: colors.pillBorder, marginTop: 6, overflow: 'hidden' },
  diffFill: { height: 5, borderRadius: 99, backgroundColor: colors.accent },
  predCard: {
    backgroundColor: '#f0f7f4',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 14,
    marginBottom: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cfe8dc',
  },
  predStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 4,
    marginBottom: 10,
  },
  predStatRowSpaced: { marginTop: 4 },
  predStatLbl: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1a3d2b',
  },
  predStatRight: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
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
  predAdjustedNum: { fontSize: 28, fontWeight: '700', color: '#1a3d2b' },
  predExpectedNum: { fontSize: 26, fontWeight: '700', color: '#1a3d2b' },
  predTarget: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a3d2b',
    marginTop: 10,
    lineHeight: 20,
  },
  predTargetSoft: { fontSize: 12, color: '#3d5a4f', marginTop: 10, lineHeight: 17 },
  predNoIndex: { fontSize: 13, color: '#3d5a4f', lineHeight: 19, marginBottom: 4 },
  diffInfoBody: { fontSize: 14, lineHeight: 21, color: colors.ink },
  saveBtn: {
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 16,
    minHeight: 48,
    justifyContent: 'center',
    zIndex: 10,
    ...Platform.select({
      web: { cursor: 'pointer' as const },
      default: {},
    }),
  },
  saveBtnPressed: { opacity: 0.88 },
  saveBtnLg: { paddingVertical: 14, maxWidth: 480, alignSelf: 'center', width: '100%' },
  saveTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  tournamentSection: {
    marginTop: 20,
    marginBottom: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f0f7f3',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tournamentSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  tournamentCard: {
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 6,
  },
  tournamentCardDisabled: { opacity: 0.55 },
  tournamentQ: { fontSize: 14, fontWeight: '600', color: colors.ink },
  tournamentQDisabled: { color: colors.subtle },
  tournamentComingSoon: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.subtle,
    marginTop: 4,
  },
  tournamentMeta: { fontSize: 12, color: colors.muted },
  tournamentYesNo: { flexDirection: 'row', gap: 10, marginTop: 6 },
  tournamentOpt: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  tournamentOptOn: { backgroundColor: colors.header, borderColor: colors.header },
  tournamentOptTxt: { fontSize: 14, fontWeight: '700', color: colors.ink },
  tournamentOptTxtOn: { color: '#fff' },
  tournamentTeamNote: { fontSize: 11, color: colors.muted, lineHeight: 16, marginTop: 4 },
  saveHint: { fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 10, lineHeight: 15, paddingHorizontal: 8 },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdropPress: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
  },
  modalSheetTall: { maxHeight: '70%' },
  /** With keyboard open, use more of the remaining viewport so filtered results stay usable. */
  modalSheetTallKeyboard: { maxHeight: '92%' },
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
    flexShrink: 0,
  },
  courseSearchList: { flexGrow: 0 },
  courseSearchEmpty: { fontSize: 14, color: colors.muted, paddingVertical: 16, textAlign: 'center' },
  courseSourceLbl: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.subtle,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginLeft: 6,
  },
  coursePickerFooter: { paddingTop: 8, paddingBottom: 4, gap: 8 },
  coursePickerFooterBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  coursePickerFooterTxt: { fontSize: 14, fontWeight: '600', color: colors.muted },
  coursePickerFooterBtnPrimary: {
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.header,
    alignItems: 'center',
  },
  coursePickerFooterTxtPrimary: { fontSize: 14, fontWeight: '700', color: '#fff' },
  unratedBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fdba74',
    gap: 8,
  },
  unratedBoxTxt: { fontSize: 13, lineHeight: 18, color: colors.ink, fontWeight: '500' },
  addTeeLink: { alignSelf: 'flex-start', marginTop: 2 },
  addTeeLinkTxt: { fontSize: 13, fontWeight: '700', color: colors.accent },
  addTeeCheckRow: { marginTop: 8, marginBottom: 4 },
  saveBtnInline: {
    marginTop: 14,
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnInlineTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  keyboardAccessory: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  keyboardDoneBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  keyboardDoneTxt: { fontSize: 17, fontWeight: '600', color: colors.accent },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  modalRowTxt: { fontSize: 15, color: colors.ink },
  modalRowCourse: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  modalRowSub: { fontSize: 12, color: colors.subtle, marginTop: 2 },
});
