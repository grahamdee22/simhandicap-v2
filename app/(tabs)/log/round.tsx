import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/auth/AuthContext';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableWithoutFeedback, useWindowDimensions, View, Alert, ActivityIndicator, InputAccessoryView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardBottomInset } from '../../../src/lib/useKeyboardBottomInset';
import * as ImagePicker from 'expo-image-picker';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { PendingTournamentHolesBanner } from '../../../src/components/PendingTournamentHolesBanner';
import { IconCheckmark } from '../../../src/components/SvgUiIcons';
import { DatePlayedField } from '../../../src/components/DatePlayedField';
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
import {
  effectiveHandicapForLeagueRecording,
  fetchActiveTournamentsForUser,
  isTeamLeagueFormat,
  recordOptedInLeagueRounds,
  type ActiveTournamentOption,
} from '../../../src/lib/leagues';
import { resolveSocialGroupsAccessToken } from '../../../src/lib/socialGroups';
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
import { UnverifiedCourseBadge } from '../../../src/components/UnverifiedCourseBadge';
import { yardageForCourseTee } from '../../../src/lib/courseTeeYardages';
import { uploadLogScorecardForParse } from '../../../src/lib/logScorecardStorage';
import { invokeParseScorecard } from '../../../src/lib/parseScorecard';
import {
  applyParseScorecardToLogForm,
  scanBannerMessage,
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
  holesPlayedLabel,
  isNineHolePlayed,
  nineHoleLoggingUnlocked,
  ratingSlopeForHolesPlayed,
  type HolesPlayed,
} from '../../../src/lib/nineHoleRating';

type DiffInfoKind = 'adjusted' | 'expected' | null;

const PUTTING_OPTS: { key: PuttingMode; dn: string; ds: string }[] = [
  { key: 'auto_2putt', dn: 'Auto', ds: '2-putt' },
  { key: 'gimme_5', dn: 'Gimme', ds: '<5ft' },
  { key: 'putt_all', dn: 'Putt', ds: 'Everything' },
];

const WIND_OPTS: { key: Wind; dn: string; ds: string }[] = [
  { key: 'off', dn: 'Off', ds: 'Calm' },
  { key: 'light', dn: 'Light', ds: 'Breeze' },
  { key: 'strong', dn: 'Strong', ds: 'Heavy' },
];

const MULL_OPTS = MULLIGAN_PICKER_OPTS;

const LOG_ROUND_NUMERIC_ACCESSORY_ID = 'log-round-numeric-done';

function NumericKeyboardDoneBar() {
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={LOG_ROUND_NUMERIC_ACCESSORY_ID}>
      <View style={styles.keyboardAccessory}>
        <Pressable
          style={styles.keyboardDoneBtn}
          onPress={() => Keyboard.dismiss()}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={styles.keyboardDoneTxt}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
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
    setGrossScore(72);
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
  }, [supabaseOn, user?.id, existing, groups, playedDate]);

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

  const optedInTournaments = useMemo(
    () => activeTournaments.filter((t) => tournamentApply[t.leagueId] !== false),
    [activeTournaments, tournamentApply]
  );

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

  useEffect(() => {
    void loadCommunityCourses();
  }, [loadCommunityCourses]);

  useFocusEffect(
    useCallback(() => {
      void loadCommunityCourses();
    }, [loadCommunityCourses])
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
    const resolved = resolveLogCourse(courseId, platform, communityCourses);
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
  }, [courseId, platform, editId, communityCourses]);

  const pinOpts = useMemo(() => pinOptionsForPlatform(platform), [platform]);

  useEffect(() => {
    const keys = pinOpts.map((o) => o.key);
    if (!keys.includes(pin)) {
      setPin(keys[0] ?? 'thu');
    }
  }, [platform, pinOpts, pin]);

  const resolvedCourse = useMemo(
    () => resolveLogCourse(courseId, platform, communityCourses),
    [courseId, platform, communityCourses]
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
          showAppAlert('Camera access needed', 'Allow camera access to photograph your scorecard.');
          return;
        }
      } else {
        let perm = await ImagePicker.getMediaLibraryPermissionsAsync(false);
        if (!perm.granted) perm = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
        if (!perm.granted) {
          showAppAlert('Photos access needed', 'Allow photo library access to upload your scorecard.');
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
        showAppAlert('Upload failed', up.error);
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

    Alert.alert('Scan scorecard', 'Choose a source', [
      { text: 'Photo library', onPress: () => void runPick('library') },
      { text: 'Camera', onPress: () => void runPick('camera') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [scanBusy, user?.id, supabaseOn, parseCourseTees, courseTees, communityCourses, platform, courseId]);

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
    resolvedCourse?.source === 'curated' && resolvedCourse.confident !== false;
  const showYardageInput = resolvedCourse?.source === 'community';

  const showCommunityInPicker = hasExpandedCourseList && optedInTournaments.length === 0;

  const coursesForPicker = useMemo(() => {
    const curated = curatedPickerCourses(courseSearchQuery);
    if (!showCommunityInPicker) return curated;
    return mergePickerCourses(curated, communityCourses, courseSearchQuery);
  }, [courseSearchQuery, showCommunityInPicker, communityCourses]);

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
    const ratingAnchor = isNineHolePlayed(holesPlayed) ? 36 : 72;
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
      showAppAlert('Course required', 'Select a course from the list.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(L.playedDate.trim())) {
      showAppAlert('Date played', 'Pick a valid date using the date field.');
      return;
    }

    const finishSave = async () => {
      const snap = latestSaveRef.current;
      if (!snap?.course) {
        showAppAlert('Course required', 'Select a course from the list.');
        return;
      }

      const optedInRaw = activeTournaments.filter((t) => tournamentApply[t.leagueId] !== false);
      // 9-hole rounds cannot apply to tournaments (Decision 3) — client guard; DB trigger also rejects.
      const optedIn = isNineHolePlayed(snap.holesPlayed) ? [] : optedInRaw;
      if (optedIn.length > 0 && snap.course.source === 'community') {
        showAppAlert(
          'Tournament round',
          'Community courses cannot be used for tournament rounds. Pick a verified course or set tournament apply to No.'
        );
        return;
      }

      if (isNineHolePlayed(snap.holesPlayed)) {
        const hasIndex =
          currentIndexFromRounds(useAppStore.getState().rounds) != null ||
          (snap.existing != null && isNineHolePlayed(snap.existing.holesPlayed));
        if (!hasIndex) {
          showAppAlert(
            'Full 18 first',
            'Log a full 18-hole round first to establish your SimCap index. You can log 9-hole rounds after that.'
          );
          return;
        }
      }

      const playedAt = localYmdToIso(snap.playedDate);
      const grossToSave = clampGrossScore(snap.grossScore, snap.holesPlayed);

      let teeNameSave = snap.course.seed?.defaultTee ?? 'Default';
      let courseRatingSave: number;
      let slopeSave: number;
      let nineHoleSourceSave: 'derived' | 'real' | undefined;

      if (snap.course.source === 'community') {
        const yards = parseInt(snap.yardsPlayed.replace(/,/g, '').trim(), 10);
        const yardsMin = isNineHolePlayed(snap.holesPlayed) ? 800 : 1000;
        const yardsMax = isNineHolePlayed(snap.holesPlayed) ? 5000 : 9000;
        if (!Number.isFinite(yards) || yards < yardsMin || yards > yardsMax) {
          showAppAlert(
            'Yardage',
            isNineHolePlayed(snap.holesPlayed)
              ? 'Enter the total yardage you played for that nine (about 800–5,000).'
              : 'Enter the total yardage you played (about 1,000–9,000).'
          );
          return;
        }
        const tee = nearestTeeByYards(snap.course.tees, yards);
        if (!tee) {
          showAppAlert('Tee', 'This course has no tee data.');
          return;
        }
        const rs = ratingSlopeForHolesPlayed(tee, snap.holesPlayed);
        courseRatingSave = rs.rating;
        slopeSave = rs.slope;
        nineHoleSourceSave = rs.nineHoleSource ?? undefined;
        teeNameSave = tee.name;
      } else if (snap.course.confident === false && snap.course.seed) {
        const mid = middleCourseTee(snap.course.seed, snap.platform);
        if (!mid) {
          showAppAlert('Tee', 'This course has no tee data.');
          return;
        }
        const rs = ratingSlopeForHolesPlayed(mid, snap.holesPlayed);
        courseRatingSave = rs.rating;
        slopeSave = rs.slope;
        nineHoleSourceSave = rs.nineHoleSource ?? undefined;
        teeNameSave = mid.name;
      } else if (snap.teePickKey === CUSTOM_TEE_ID) {
        const r = parseFloat(snap.customRating.replace(/,/g, '.').trim());
        const s = parseFloat(snap.customSlope.replace(/,/g, '.').trim());
        const nine = isNineHolePlayed(snap.holesPlayed);
        const rMin = nine ? 28 : 60;
        const rMax = nine ? 45 : 85;
        if (!Number.isFinite(r) || !Number.isFinite(s) || s < 55 || s > 155 || r < rMin || r > rMax) {
          showAppAlert(
            'Custom tee',
            nine
              ? `Enter the rating and slope for this nine (rating about ${rMin}–${rMax}, slope 55–155).`
              : 'Enter a valid course rating and slope (rating about 60–85, slope 55–155).'
          );
          return;
        }
        courseRatingSave = round1(r);
        slopeSave = Math.round(s);
        teeNameSave = 'Custom';
        nineHoleSourceSave = nine ? 'real' : undefined;
      } else if (snap.course.seed) {
        const tees = getCourseTees(snap.course.seed, snap.platform);
        const row = tees.find((t) => t.name === snap.teePickKey);
        if (!row) {
          showAppAlert('Tee', 'Pick a tee from the list, or choose Custom and enter rating and slope.');
          return;
        }
        const rs = ratingSlopeForHolesPlayed(row, snap.holesPlayed);
        courseRatingSave = rs.rating;
        slopeSave = rs.slope;
        nineHoleSourceSave = rs.nineHoleSource ?? undefined;
        teeNameSave = row.name;
      } else {
        showAppAlert('Tee', 'Pick a tee from the list.');
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
            (t) => tournamentApply[t.leagueId] !== false
          );
          const hasScrambleOptIn = optedIn.some((t) => t.format === 'scramble');
          const hasIndexCountingOptIn = optedIn.some(
            (t) => t.format === 'stroke' || t.format === 'best_ball'
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
            const leagueResults = await recordOptedInLeagueRounds({
              userId: user.id,
              roundId: saved.id,
              grossScore: saved.grossScore,
              playedAt: saved.playedAt,
              simIndex: effectiveHandicapForLeagueRecording(
                rounds.concat(saved),
                latestGhinIndex(ghinSnapshots)
              ),
              selections: activeTournaments.map((t) => ({
                leagueId: t.leagueId,
                apply: tournamentApply[t.leagueId] !== false,
              })),
              displayNames,
              accessToken: saveAccessToken,
              holesPlayed: saved.holesPlayed ?? '18',
            });
            const pendingHoleResults = leagueResults.filter((r) => r.needsHoleByHoleEntry);
            const completedLeagueResults = leagueResults.filter((r) => !r.needsHoleByHoleEntry);

            if (completedLeagueResults.length > 0) {
              const hit = completedLeagueResults[0];
              const place = ordinalPlace(hit.position);
              const isTeamFmt = isTeamLeagueFormat(hit.format);
              leagueBanner =
                isTeamFmt && hit.teamName
                  ? `This round counts toward Team ${hit.teamName}'s score! You're currently in ${place} place.`
                  : `This round counts toward ${hit.leagueName}! You're currently in ${place} place.`;
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
        showAppAlert('Could not save', String(e));
      }
    };

    void finishSave();
  };

  return (
    <ContentWidth bg={colors.surface}>
      <>
      <View style={styles.root}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <View style={styles.scrollWrap}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingTop: Math.max(gutter, 14),
            paddingBottom: insets.bottom + 100,
          }}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          <PendingTournamentHolesBanner gutter={0} />
          <View style={isWide ? styles.pickRow : undefined}>
            <View style={isWide ? styles.pickCol : undefined}>
              <Text style={styles.sectionLabel}>Sim platform</Text>
              <Pressable style={[styles.pill, platOpen && styles.pillActive]} onPress={() => setPlatOpen(true)}>
                <Text style={styles.pillVal}>{platform}</Text>
                <Text style={styles.chev}>▾</Text>
              </Pressable>
            </View>
            <View style={isWide ? styles.pickCol : undefined}>
              <Text style={styles.sectionLabel}>Course</Text>
              <Pressable style={[styles.pill, courseOpen && styles.pillActive]} onPress={() => setCourseOpen(true)}>
                <View style={styles.pillValRow}>
                  <Text style={styles.pillVal}>{resolvedCourse?.name ?? 'Select'}</Text>
                  {resolvedCourse?.handicapSource === 'unverified' ? (
                    <UnverifiedCourseBadge
                      compact
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
                accessibilityLabel="Scan GS Pro scorecard"
              >
                {scanBusy ? (
                  <ActivityIndicator color={colors.sage} size="small" />
                ) : (
                  <Text style={styles.scanBtnTxt}>Scan Scorecard 📷</Text>
                )}
              </Pressable>
              <Text style={styles.scanTip}>
                Snap a photo of the scorecard on your simulator's screen at the end of the round — not a
                screenshot from SGT or another website.
              </Text>
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
                    {scanBannerMessage(scanBanner, scanBannerDetail ?? undefined)}
                  </Text>
                </View>
              ) : null}
            </>
          ) : null}

          <DatePlayedField value={playedDate} onChange={setPlayedDate} />

          <Text style={styles.sectionLabel}>Holes</Text>
          <View style={styles.dayRow}>
            {(
              [
                { key: '18' as const, title: '18 holes', sub: 'Full round' },
                { key: 'front' as const, title: 'Front 9', sub: 'Holes 1–9' },
                { key: 'back' as const, title: 'Back 9', sub: 'Holes 10–18' },
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
                    setGrossScore((g) => clampGrossScore(g, h.key));
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
            <Text style={styles.teeTip}>
              Log a full 18 first to unlock 9-hole rounds and establish your SimCap index.
            </Text>
          ) : null}

          {showYardageInput ? (
            <>
              <Text style={styles.sectionLabel}>Yardage played</Text>
              <Text style={styles.teeTip}>
                Enter the total yardage from your round. Helps us describe which tee you played.
              </Text>
              <TextInput
                style={styles.courseSearchInput}
                value={yardsPlayed}
                onChangeText={setYardsPlayed}
                placeholder="e.g. 6,400"
                placeholderTextColor={colors.subtle}
                keyboardType="number-pad"
                inputAccessoryViewID={Platform.OS === 'ios' ? LOG_ROUND_NUMERIC_ACCESSORY_ID : undefined}
              />
            </>
          ) : null}

          {resolvedCourse && showTeeSelector ? (
            <>
              <Text style={styles.sectionLabel}>Tee</Text>
              <Text style={styles.teeTip}>
                Pick the tee closest to the total yardage you actually played, tee names and colors vary by
                simulator. If nothing's close, use Custom.
              </Text>
              <View style={styles.teeChipWrap}>
                {courseTees.map((t) => {
                  const yardsFull =
                    (typeof t.yards === 'number' && Number.isFinite(t.yards) ? t.yards : undefined) ??
                    (resolvedCourse.source === 'curated' && resolvedCourse.seed
                      ? yardageForCourseTee(resolvedCourse.seed.id, t.name)
                      : undefined);
                  const chipRs = ratingSlopeForHolesPlayed(t, holesPlayed);
                  const yards =
                    yardsFull != null && isNineHolePlayed(holesPlayed)
                      ? Math.round(yardsFull / 2)
                      : yardsFull;
                  return (
                  <Pressable
                    key={t.name}
                    style={[styles.teeChip, teePickKey === t.name && styles.teeChipOn]}
                    onPress={() => {
                      setTeePickKey(t.name);
                      setCustomRating('');
                      setCustomSlope('');
                    }}
                  >
                    <Text style={[styles.teeChipTxt, teePickKey === t.name && styles.teeChipTxtOn]}>{t.name}</Text>
                    <Text style={[styles.teeChipSub, teePickKey === t.name && styles.teeChipSubOn]}>
                      {yards != null
                        ? `${chipRs.rating} / ${chipRs.slope} · ${yards.toLocaleString('en-US')} yds`
                        : `${chipRs.rating} / ${chipRs.slope}`}
                    </Text>
                  </Pressable>
                  );
                })}
                <Pressable
                  style={[styles.teeChip, teePickKey === CUSTOM_TEE_ID && styles.teeChipOn]}
                  onPress={() => setTeePickKey(CUSTOM_TEE_ID)}
                >
                  <Text style={[styles.teeChipTxt, teePickKey === CUSTOM_TEE_ID && styles.teeChipTxtOn]}>Custom</Text>
                  <Text style={[styles.teeChipSub, teePickKey === CUSTOM_TEE_ID && styles.teeChipSubOn]}>
                    {isNineHolePlayed(holesPlayed)
                      ? `${holesPlayedLabel(holesPlayed)} rating / slope`
                      : 'Your rating / slope'}
                  </Text>
                </Pressable>
              </View>
              {teePickKey === CUSTOM_TEE_ID ? (
                <View style={styles.teeCustomRow}>
                  <View style={styles.teeCustomField}>
                    <Text style={styles.teeCustomLbl}>
                      {isNineHolePlayed(holesPlayed)
                        ? `${holesPlayedLabel(holesPlayed)} rating`
                        : 'Course rating'}
                    </Text>
                    <TextInput
                      style={styles.teeNumInput}
                      value={customRating}
                      onChangeText={setCustomRating}
                      placeholder={isNineHolePlayed(holesPlayed) ? 'e.g. 36.1' : 'e.g. 72.1'}
                      placeholderTextColor={colors.subtle}
                      keyboardType="decimal-pad"
                      inputAccessoryViewID={Platform.OS === 'ios' ? LOG_ROUND_NUMERIC_ACCESSORY_ID : undefined}
                    />
                  </View>
                  <View style={styles.teeCustomField}>
                    <Text style={styles.teeCustomLbl}>Slope</Text>
                    <TextInput
                      style={styles.teeNumInput}
                      value={customSlope}
                      onChangeText={setCustomSlope}
                      placeholder="e.g. 128"
                      placeholderTextColor={colors.subtle}
                      keyboardType="number-pad"
                      inputAccessoryViewID={Platform.OS === 'ios' ? LOG_ROUND_NUMERIC_ACCESSORY_ID : undefined}
                    />
                  </View>
                </View>
              ) : null}
            </>
          ) : null}

        <Text style={styles.sectionLabel}>Score</Text>
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

        <Text style={styles.sectionLabel}>Putting mode</Text>
        <View style={styles.dayRow}>
          {PUTTING_OPTS.map((o) => (
            <Pressable
              key={o.key}
              style={[styles.dayBtn, putting === o.key && styles.dayBtnOn]}
              onPress={() => setPutting(o.key)}
            >
              <Text style={[styles.dayDn, putting === o.key && styles.dayDnOn]}>{o.dn}</Text>
              <Text style={[styles.dayDs, putting === o.key && styles.dayDsOn]}>{o.ds}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Pin placement</Text>
        <View style={styles.dayRow}>
          {pinOpts.map((d) => (
            <Pressable key={d.key} style={[styles.dayBtn, pin === d.key && styles.dayBtnOn]} onPress={() => setPin(d.key)}>
              <Text style={[styles.dayDn, pin === d.key && styles.dayDnOn]}>{d.label}</Text>
              {d.sublabel ? (
                <Text style={[styles.dayDs, pin === d.key && styles.dayDsOn]}>{d.sublabel}</Text>
              ) : null}
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Wind</Text>
        <View style={styles.dayRow}>
          {WIND_OPTS.map((w) => (
            <Pressable
              key={w.key}
              style={[styles.dayBtn, wind === w.key && styles.dayBtnOn]}
              onPress={() => setWind(w.key)}
            >
              <Text style={[styles.dayDn, wind === w.key && styles.dayDnOn]}>{w.dn}</Text>
              <Text style={[styles.dayDs, wind === w.key && styles.dayDsOn]}>{w.ds}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Mulligans</Text>
        <View style={styles.dayRow}>
          {MULL_OPTS.map((m) => (
            <Pressable
              key={m.key}
              style={[styles.dayBtn, mulligans === m.key && styles.dayBtnOn]}
              onPress={() => setMulligans(m.key)}
            >
              <Text style={[styles.dayDn, mulligans === m.key && styles.dayDnOn]}>{m.dn}</Text>
              <Text style={[styles.dayDs, mulligans === m.key && styles.dayDsOn]}>{m.ds}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.diffWrap}>
          <View style={styles.diffTop}>
            <Text style={styles.diffLbl}>Difficulty modifier</Text>
            <Text style={styles.diffNum}>{modifier.toFixed(2)}</Text>
          </View>
          <View style={styles.diffTrack}>
            <View style={[styles.diffFill, { width: `${modPct}%` }]} />
          </View>
        </View>

        {resolvedCourse ? (
          <View style={styles.predCard}>
            <View style={styles.predStatRow}>
              <Text style={styles.predStatLbl}>Adjusted differential:</Text>
              <View style={styles.predStatRight}>
                <Text style={styles.predAdjustedNum}>{adjustedDisplay}</Text>
                <Pressable
                  style={styles.infoBtn}
                  onPress={() => setDiffInfoOpen('adjusted')}
                  accessibilityRole="button"
                  accessibilityLabel="About adjusted differential"
                >
                  <Text style={styles.infoBtnTxt}>ⓘ</Text>
                </Pressable>
              </View>
            </View>
            {expectedDiffPre != null ? (
              <>
                <View style={[styles.predStatRow, styles.predStatRowSpaced]}>
                  <Text style={styles.predStatLbl}>Expected differential:</Text>
                  <View style={styles.predStatRight}>
                    <Text style={styles.predExpectedNum}>{formatDifferentialDisplay(expectedDiffPre)}</Text>
                    <Pressable
                      style={styles.infoBtn}
                      onPress={() => setDiffInfoOpen('expected')}
                      accessibilityRole="button"
                      accessibilityLabel="About expected differential"
                    >
                      <Text style={styles.infoBtnTxt}>ⓘ</Text>
                    </Pressable>
                  </View>
                </View>
                {targetGrossPre != null &&
                targetGrossPre >= scoreBounds.min &&
                targetGrossPre <= scoreBounds.max ? (
                  <Text style={styles.predTarget}>
                    Shoot {targetGrossPre} or better to improve your index
                  </Text>
                ) : (
                  <Text style={styles.predTargetSoft}>
                    For these conditions, your index benchmark sits outside the usual gross range (
                    {scoreBounds.min}–{scoreBounds.max}). Every stroke still feeds your rolling differentials.
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.predNoIndex}>
                Log at least one round to see your expected differential and a target gross for these conditions.
              </Text>
            )}
          </View>
        ) : null}

        {!existing &&
        tournamentsReady &&
        activeTournaments.length > 0 &&
        !isNineHolePlayed(holesPlayed) ? (
          <View style={styles.tournamentSection}>
            <Text style={styles.tournamentSectionTitle}>Active Tournaments</Text>
            {activeTournaments.map((t) => {
                const apply = tournamentApply[t.leagueId] !== false;
                return (
                  <View key={t.leagueId} style={styles.tournamentCard}>
                    <Text style={styles.tournamentQ}>
                      Apply this round to {t.leagueName}?
                    </Text>
                    <Text style={styles.tournamentMeta}>{t.groupName}</Text>
                    <View style={styles.tournamentYesNo}>
                      <Pressable
                        style={[styles.tournamentOpt, apply && styles.tournamentOptOn]}
                        onPress={() =>
                          setTournamentApply((prev) => ({ ...prev, [t.leagueId]: true }))
                        }
                      >
                        <Text style={[styles.tournamentOptTxt, apply && styles.tournamentOptTxtOn]}>
                          Yes
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.tournamentOpt, !apply && styles.tournamentOptOn]}
                        onPress={() =>
                          setTournamentApply((prev) => ({ ...prev, [t.leagueId]: false }))
                        }
                      >
                        <Text style={[styles.tournamentOptTxt, !apply && styles.tournamentOptTxtOn]}>
                          No
                        </Text>
                      </Pressable>
                    </View>
                    {t.format === 'scramble' ? (
                      <Text style={styles.tournamentTeamNote}>
                        Only the designated scorer can apply rounds. Scramble won&apos;t affect your
                        SimCap index.
                      </Text>
                    ) : null}
                    {t.format === 'best_ball' ? (
                      <Text style={styles.tournamentTeamNote}>
                        Best Ball rounds count toward your SimCap index.
                      </Text>
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
          accessibilityLabel={existing ? 'Update round' : 'Save round'}
          hitSlop={{ top: 8, bottom: 12, left: 8, right: 8 }}
        >
          <Text style={styles.saveTxt}>{existing ? 'Save changes' : 'Save round'}</Text>
        </Pressable>
        <Text style={styles.saveHint}>
          Saves to your SimCap account, opens Round analysis, and updates your sim index, home chart, and profile.
        </Text>
        </ScrollView>
          </View>
        </TouchableWithoutFeedback>
      </View>

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
              {diffInfoOpen === 'adjusted' ? 'Adjusted differential' : 'Expected differential'}
            </Text>
            <Text style={styles.diffInfoBody}>
              {diffInfoOpen === 'adjusted'
                ? 'Your raw score differential after applying a difficulty modifier based on your sim settings — putting mode, wind, pins, and mulligans. This is what gets used to calculate your SimCap index.'
                : "The differential we'd expect from a golfer at your current index on this course. If your adjusted differential is lower than this, your index will improve."}
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
            <Text style={styles.modalTitle}>Platform</Text>
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
            <Text style={styles.modalTitle}>Course</Text>
            <TextInput
              style={styles.courseSearchInput}
              value={courseSearchQuery}
              onChangeText={setCourseSearchQuery}
              placeholder="Search by course name"
              placeholderTextColor={colors.subtle}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
              blurOnSubmit={false}
            />
            <FlatList
              data={coursesForPicker}
              keyExtractor={(c) => c.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              style={[styles.courseSearchList, { maxHeight: courseListMaxHeight }]}
              nestedScrollEnabled
              initialNumToRender={24}
              windowSize={10}
              ListEmptyComponent={
                <Text style={styles.courseSearchEmpty}>No courses match that search.</Text>
              }
              renderItem={({ item: c }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    Keyboard.dismiss();
                    setCourseId(c.id);
                    if (c.source === 'community') {
                      setYardsPlayed('');
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
                    {c.source === 'community' ? (
                      <UnverifiedCourseBadge
                        compact
                        enrichmentTier={c.enrichmentTier}
                        enrichmentSource={c.enrichmentSource}
                      />
                    ) : null}
                  </View>
                  {courseId === c.id ? <IconCheckmark size={18} color={colors.accent} /> : null}
                </Pressable>
              )}
            />
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
  scrollWrap: { flex: 1, minHeight: 0 },
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
