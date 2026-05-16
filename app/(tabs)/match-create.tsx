import { useNavigation } from '@react-navigation/native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
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
import { useAuth } from '../../src/auth/AuthContext';
import { ContentWidth } from '../../src/components/ContentWidth';
import { IconCheckmark } from '../../src/components/SvgUiIcons';
import { PLATFORMS, colors, type PlatformId } from '../../src/lib/constants';
import {
  COURSE_SEEDS,
  courseMatchesSearch,
  CUSTOM_TEE_ID,
  findCourseSeedIdByCourseName,
  getCourseById,
  getCourseTees,
  middleCourseTee,
  ratingForCourse,
} from '../../src/lib/courses';
import {
  formatHandicapIndexDisplay,
  round1,
  type Mulligans,
  type PinDay,
  type PuttingMode,
  type Wind,
} from '../../src/lib/handicap';
import { showAppAlert } from '../../src/lib/alertCompat';
import { settingsScreenshotPickerOptions } from '../../src/lib/settingsScreenshotPicker';
import {
  countActiveDirectMatchesForUser,
  findActiveDirectMatchBetween,
  hasBlockingDirectMatchWithOpponent,
  MAX_ACTIVE_DIRECT_CHALLENGES,
} from '../../src/lib/matchDirectChallenges';
import { googleOAuthAccessToken } from '../../src/lib/googleOAuthAccessToken';
import { getMatchById, insertMatch, listMyMatches, updateMatchById } from '../../src/lib/matchPlay';
import { uploadMatchSettingsScreenshot } from '../../src/lib/matchPlayStorage';
import { useResponsive } from '../../src/lib/responsive';
import { isSupabaseConfigured } from '../../src/lib/supabase';
import { currentIndexFromRounds, useAppStore, type FriendGroup } from '../../src/store/useAppStore';

type ChallengeKind = 'direct' | 'open';
type OpenChallengeMode = 'now' | 'future';

/** Release builds require a settings screenshot; dev/simulator can skip. */
const ALLOW_SKIP_SETTINGS_SCREENSHOT = __DEV__;

const MAX_OPEN_CHALLENGES_POSTED = 3;
const FUTURE_OPEN_MAX_DAYS = 30;

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

const MULL_OPTS: { key: Mulligans; dn: string; ds: string }[] = [
  { key: 'off', dn: 'Off', ds: 'None' },
  { key: 'on', dn: 'On', ds: 'Allowed' },
];

const PIN_OPTS: { key: PinDay; dn: string; ds: string }[] = [
  { key: 'thu', dn: 'Thu', ds: 'Round 1' },
  { key: 'fri', dn: 'Fri', ds: 'Round 2' },
  { key: 'sat', dn: 'Sat', ds: 'Round 3' },
  { key: 'sun', dn: 'Sun', ds: 'Round 4' },
];

type OpponentPick = {
  userId: string;
  displayName: string;
  groupLine: string;
};

type HolesChoice = '18' | 'front' | 'back';

function collectOpponents(groups: FriendGroup[], selfId: string): OpponentPick[] {
  const map = new Map<string, OpponentPick>();
  for (const g of groups) {
    for (const m of g.members) {
      if (m.isYou || m.userId === selfId) continue;
      const name = m.displayName.replace(/\s*\(you\)\s*$/i, '').trim();
      const ex = map.get(m.userId);
      if (ex) {
        if (!ex.groupLine.includes(g.name)) ex.groupLine = `${ex.groupLine}, ${g.name}`;
      } else {
        map.set(m.userId, { userId: m.userId, displayName: name, groupLine: g.name });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function resolvePlayer1Tee(args: {
  course: NonNullable<ReturnType<typeof getCourseById>>;
  platform: PlatformId;
  teePickKey: string;
  customRating: string;
  customSlope: string;
  courseTees: ReturnType<typeof getCourseTees>;
}): { rating: number; slope: number; teeName: string } {
  const { course, platform, teePickKey, customRating, customSlope, courseTees } = args;
  if (course.confident === false) {
    const mid = middleCourseTee(course, platform);
    if (mid) return { rating: mid.rating, slope: mid.slope, teeName: mid.name };
    const fb = ratingForCourse(course, platform);
    return { rating: fb.rating, slope: fb.slope, teeName: course.defaultTee ?? 'Default' };
  }
  if (teePickKey === CUSTOM_TEE_ID) {
    const r = parseFloat(customRating);
    const s = parseInt(customSlope, 10);
    if (Number.isFinite(r) && Number.isFinite(s)) {
      return { rating: round1(r), slope: Math.round(s), teeName: 'Custom' };
    }
    const fb = ratingForCourse(course, platform);
    return { rating: fb.rating, slope: fb.slope, teeName: 'Custom' };
  }
  const row = courseTees.find((t) => t.name === teePickKey);
  if (row) return { rating: row.rating, slope: row.slope, teeName: row.name };
  const fb = ratingForCourse(course, platform);
  return { rating: fb.rating, slope: fb.slope, teeName: course.defaultTee ?? 'Default' };
}

function minScheduleDate(now = new Date()): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  return d;
}

function maxScheduleDate(now = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + FUTURE_OPEN_MAX_DAYS);
  d.setHours(23, 59, 0, 0);
  return d;
}

function clampScheduledDate(v: Date, now = new Date()): Date {
  const min = minScheduleDate(now).getTime();
  const max = maxScheduleDate(now).getTime();
  const t = Math.min(max, Math.max(min, v.getTime()));
  return new Date(t);
}

export default function MatchCreateScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { fresh: freshRaw, rematchFrom: rematchFromRaw } = useLocalSearchParams<{
    fresh?: string | string[];
    rematchFrom?: string | string[];
  }>();
  const freshParam = Array.isArray(freshRaw) ? freshRaw[0] : freshRaw;
  const rematchFromParam = Array.isArray(rematchFromRaw) ? rematchFromRaw[0] : rematchFromRaw;
  const insets = useSafeAreaInsets();
  const { gutter, isWide } = useResponsive();
  const { user } = useAuth();
  const groups = useAppStore((s) => s.groups);
  const preferredLogPlatform = useAppStore((s) => s.preferredLogPlatform);
  const supabaseOn = isSupabaseConfigured();

  const [challengeKind, setChallengeKind] = useState<ChallengeKind>('direct');
  const [openChallengeMode, setOpenChallengeMode] = useState<OpenChallengeMode>('now');
  const [stepIdx, setStepIdx] = useState(0);
  const [opponent, setOpponent] = useState<OpponentPick | null>(null);
  const [platform, setPlatform] = useState<PlatformId>(preferredLogPlatform);
  const [courseId, setCourseId] = useState('pebble');
  const [teePickKey, setTeePickKey] = useState('White');
  const [customRating, setCustomRating] = useState('');
  const [customSlope, setCustomSlope] = useState('');
  const [putting, setPutting] = useState<PuttingMode>('auto_2putt');
  const [pin, setPin] = useState<PinDay>('thu');
  const [wind, setWind] = useState<Wind>('off');
  const [mulligans, setMulligans] = useState<Mulligans>('off');
  const [holesChoice, setHolesChoice] = useState<HolesChoice>('18');
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [settingsImage, setSettingsImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [platOpen, setPlatOpen] = useState(false);
  const [courseOpen, setCourseOpen] = useState(false);
  const [courseSearchQuery, setCourseSearchQuery] = useState('');
  const [submitBusy, setSubmitBusy] = useState(false);
  const [libraryPermissionBlocked, setLibraryPermissionBlocked] = useState(false);
  const [devSkipSettingsPhoto, setDevSkipSettingsPhoto] = useState(false);
  const [devFutureTwoMinuteMode, setDevFutureTwoMinuteMode] = useState(false);
  const [scheduledForDraft, setScheduledForDraft] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setSeconds(0, 0);
    return d;
  });
  const [rematchHydrating, setRematchHydrating] = useState(false);
  /** Completed match id to store on inserted row as `rematch_from` when sending a rematch challenge. */
  const [rematchSourceMatchId, setRematchSourceMatchId] = useState<string | null>(null);

  const lastRematchHydratedRef = useRef<string | undefined>(undefined);

  const resetWizardToInitial = useCallback(() => {
    lastRematchHydratedRef.current = undefined;
    setRematchSourceMatchId(null);
    const plat = useAppStore.getState().preferredLogPlatform;
    setChallengeKind('direct');
    setOpenChallengeMode('now');
    setStepIdx(0);
    setOpponent(null);
    setPlatform(plat);
    setCourseId('pebble');
    setTeePickKey('White');
    setCustomRating('');
    setCustomSlope('');
    setPutting('auto_2putt');
    setPin('thu');
    setWind('off');
    setMulligans('off');
    setHolesChoice('18');
    setSettingsImage(null);
    setPlatOpen(false);
    setCourseOpen(false);
    setCourseSearchQuery('');
    setSubmitBusy(false);
    setLibraryPermissionBlocked(false);
    setDevSkipSettingsPhoto(false);
    setDevFutureTwoMinuteMode(false);
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setSeconds(0, 0);
    setScheduledForDraft(next);
  }, []);

  const lastFreshAppliedRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (freshParam == null || freshParam === '') return;
    if (lastFreshAppliedRef.current === freshParam) return;
    lastFreshAppliedRef.current = freshParam;
    resetWizardToInitial();
  }, [freshParam, resetWizardToInitial]);

  useLayoutEffect(() => {
    const r = rematchFromParam?.trim();
    if (r) setRematchHydrating(true);
    else setRematchHydrating(false);
  }, [rematchFromParam]);

  useEffect(() => {
    const rid = rematchFromParam?.trim();
    if (!rid) {
      setRematchHydrating(false);
      return;
    }
    if (!supabaseOn || !user?.id) {
      setRematchHydrating(false);
      return;
    }
    if (lastRematchHydratedRef.current === rid) {
      setRematchHydrating(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const sourceRes = await getMatchById(rid, googleOAuthAccessToken ?? undefined);
        if (cancelled) return;
        if (sourceRes.error || !sourceRes.data) {
          lastRematchHydratedRef.current = rid;
          showAppAlert('Rematch', sourceRes.error ?? 'Could not load that match.', {
            onOk: () => router.back(),
          });
          return;
        }
        const source = sourceRes.data;
        if (source.status !== 'complete' || !source.player_2_id) {
          lastRematchHydratedRef.current = rid;
          showAppAlert('Rematch', 'That match is not available for a rematch.', {
            onOk: () => router.back(),
          });
          return;
        }
        if (user.id !== source.player_1_id && user.id !== source.player_2_id) {
          lastRematchHydratedRef.current = rid;
          showAppAlert('Rematch', 'You were not in that match.', { onOk: () => router.back() });
          return;
        }

        const myRes = await listMyMatches(user.id, googleOAuthAccessToken ?? undefined);
        if (cancelled) return;
        if (myRes.error || !myRes.data) {
          showAppAlert('Rematch', myRes.error ?? 'Could not verify your matches.');
          return;
        }

        const oppId = source.player_1_id === user.id ? source.player_2_id : source.player_1_id;
        const existing = findActiveDirectMatchBetween(myRes.data, user.id, oppId);
        if (existing) {
          lastRematchHydratedRef.current = rid;
          if (user.id === existing.player_2_id && existing.status === 'pending') {
            showAppAlert('Rematch', 'Your opponent already wants a rematch!', {
              onOk: () => router.replace(`/(tabs)/match-accept/${existing.id}` as never),
            });
          } else if (user.id === existing.player_1_id && existing.status === 'pending') {
            showAppAlert(
              'Rematch',
              'You already have a direct challenge waiting. Finish or resolve it before starting another rematch.',
              { onOk: () => router.back() }
            );
          } else {
            showAppAlert('Rematch', 'You already have a match in progress with this opponent.', {
              onOk: () => router.replace(`/(tabs)/match-score/${existing.id}` as never),
            });
          }
          return;
        }

        if (countActiveDirectMatchesForUser(myRes.data, user.id) >= MAX_ACTIVE_DIRECT_CHALLENGES) {
          lastRematchHydratedRef.current = rid;
          showAppAlert(
            'Challenge limit',
            `You have ${MAX_ACTIVE_DIRECT_CHALLENGES} active challenges. Finish or resolve one before sending a rematch.`,
            { onOk: () => router.back() }
          );
          return;
        }

        const groupsNow = useAppStore.getState().groups;
        const opps = collectOpponents(groupsNow, user.id);
        const oppPick =
          opps.find((o) => o.userId === oppId) ??
          ({
            userId: oppId,
            displayName: 'Golfer',
            groupLine: 'Rematch',
          } as OpponentPick);

        const amP1Old = source.player_1_id === user.id;
        const myTeeName = (amP1Old ? source.player_1_tee : source.player_2_tee) ?? 'White';
        const myRating = amP1Old ? source.player_1_course_rating : source.player_2_course_rating;
        const mySlope = amP1Old ? source.player_1_course_slope : source.player_2_course_slope;

        const cid = findCourseSeedIdByCourseName(source.course_name) ?? 'pebble';
        const courseSeed = getCourseById(cid);
        const plat = useAppStore.getState().preferredLogPlatform;
        const tees = courseSeed ? getCourseTees(courseSeed, plat) : [];

        if (cancelled) return;

        setChallengeKind('direct');
        setOpenChallengeMode('now');
        setOpponent(oppPick);
        setPlatform(plat);
        setCourseId(cid);
        setPutting(
          PUTTING_OPTS.some((x) => x.key === source.putting_mode)
            ? (source.putting_mode as PuttingMode)
            : 'auto_2putt'
        );
        setPin(
          PIN_OPTS.some((x) => x.key === source.pin_placement)
            ? (source.pin_placement as PinDay)
            : 'thu'
        );
        setWind(WIND_OPTS.some((x) => x.key === source.wind) ? (source.wind as Wind) : 'off');
        setMulligans(
          MULL_OPTS.some((x) => x.key === source.mulligans) ? (source.mulligans as Mulligans) : 'off'
        );

        if (source.holes === 18) {
          setHolesChoice('18');
        } else if (source.nine_selection === 'back') {
          setHolesChoice('back');
        } else {
          setHolesChoice('front');
        }

        const teeMatchesNamed =
          courseSeed?.confident !== false &&
          tees.some((t) => t.name === myTeeName) &&
          myTeeName.trim().toLowerCase() !== 'custom';
        if (teeMatchesNamed) {
          setTeePickKey(myTeeName);
          setCustomRating('');
          setCustomSlope('');
        } else {
          setTeePickKey(CUSTOM_TEE_ID);
          setCustomRating(String(myRating ?? ''));
          setCustomSlope(mySlope != null ? String(mySlope) : '');
        }

        const myPhotoUrl = amP1Old
          ? source.player_1_settings_photo_url?.trim() || null
          : source.player_2_settings_photo_url?.trim() || null;

        if (myPhotoUrl) {
          const lower = myPhotoUrl.toLowerCase();
          const mimeType = lower.includes('.png')
            ? 'image/png'
            : lower.includes('.webp')
              ? 'image/webp'
              : 'image/jpeg';
          setSettingsImage({ uri: myPhotoUrl, mimeType, width: 0, height: 0 } as ImagePicker.ImagePickerAsset);
          setDevSkipSettingsPhoto(false);
          setStepIdx(6);
        } else {
          setSettingsImage(null);
          setDevSkipSettingsPhoto(false);
          setStepIdx(5);
        }

        setPlatOpen(false);
        setCourseOpen(false);
        setCourseSearchQuery('');
        setLibraryPermissionBlocked(false);
        setSubmitBusy(false);

        setRematchSourceMatchId(rid);
        lastRematchHydratedRef.current = rid;
      } finally {
        setRematchHydrating(false);
      }
    })();

    return () => {
      cancelled = true;
      setRematchHydrating(false);
    };
  }, [rematchFromParam, supabaseOn, user?.id, router, googleOAuthAccessToken]);

  const opponents = useMemo(
    () => (user?.id ? collectOpponents(groups, user.id) : []),
    [groups, user?.id]
  );

  const stepSequence = useMemo(() => {
    if (challengeKind === 'direct') return [0, 1, 2, 3, 4, 5, 6];
    return openChallengeMode === 'future' ? [0, 2, 3, 4, 7, 6] : [0, 2, 3, 4, 5, 6];
  }, [challengeKind, openChallengeMode]);
  const totalSteps = stepSequence.length;
  const screenStep = stepSequence[Math.min(stepIdx, Math.max(0, stepSequence.length - 1))] ?? 0;

  const indexByUserId = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const g of groups) {
      for (const mem of g.members) {
        if (!m.has(mem.userId)) m.set(mem.userId, mem.index);
      }
    }
    return m;
  }, [groups]);

  const course = getCourseById(courseId);
  const courseTees = useMemo(() => (course ? getCourseTees(course, platform) : []), [course, platform]);
  const showTeeSelector = course?.confident !== false;

  const coursesForPicker = useMemo(
    () =>
      COURSE_SEEDS.filter((c) => c.confident !== false && courseMatchesSearch(c, courseSearchQuery)).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    [courseSearchQuery]
  );

  useEffect(() => {
    const c = getCourseById(courseId);
    if (!c) return;
    const tees = getCourseTees(c, platform);
    if (tees.length === 0) return;
    if (c.confident === false) {
      setTeePickKey(tees[Math.floor(tees.length / 2)].name);
    } else {
      const def = c.defaultTee?.trim();
      setTeePickKey(
        tees.find((t) => t.name === def)?.name ?? tees[tees.length - 1]?.name ?? tees[0].name
      );
    }
    setCustomRating('');
    setCustomSlope('');
  }, [courseId, platform]);

  useEffect(() => {
    if (courseOpen) setCourseSearchQuery('');
  }, [courseOpen]);

  useEffect(() => {
    if (screenStep !== 5) setLibraryPermissionBlocked(false);
    if (screenStep < 5) setDevSkipSettingsPhoto(false);
  }, [screenStep]);

  useEffect(() => {
    if (screenStep !== 5 || !libraryPermissionBlocked) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void ImagePicker.getMediaLibraryPermissionsAsync(false).then((p) => {
        if (p.granted) setLibraryPermissionBlocked(false);
      });
    });
    return () => sub.remove();
  }, [screenStep, libraryPermissionBlocked]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.headerCancelPress}
          accessibilityRole="button"
          accessibilityLabel="Cancel create match"
        >
          <Text style={styles.headerCancelTxt}>Cancel</Text>
        </Pressable>
      ),
    });
  }, [navigation, router]);

  const openPhotoSettings = useCallback(() => {
    if (Platform.OS === 'web') {
      return;
    }
    void Linking.openSettings();
  }, []);

  const onPickImage = useCallback(async () => {
    const pickerOptions = settingsScreenshotPickerOptions();

    // Web: `requestMediaLibraryPermissionsAsync` is a no-op; keep the chain short so
    // `launchImageLibraryAsync` stays tied to the button press (user activation).
    if (Platform.OS === 'web') {
      const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
      if (!result.canceled && result.assets[0]) {
        setSettingsImage(result.assets[0]);
        setLibraryPermissionBlocked(false);
        setDevSkipSettingsPhoto(false);
      }
      return;
    }

    let perm = await ImagePicker.getMediaLibraryPermissionsAsync(false);
    if (!perm.granted) {
      perm = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
    }
    if (!perm.granted) {
      setLibraryPermissionBlocked(true);
      return;
    }
    setLibraryPermissionBlocked(false);

    const result = await ImagePicker.launchImageLibraryAsync(pickerOptions);
    if (!result.canceled && result.assets[0]) {
      setSettingsImage(result.assets[0]);
      setLibraryPermissionBlocked(false);
      setDevSkipSettingsPhoto(false);
    }
  }, []);

  const canContinue = useMemo(() => {
    if (!supabaseOn || !user) return false;
    switch (screenStep) {
      case 0:
        return true;
      case 1:
        return opponent != null;
      case 2: {
        if (!course) return false;
        if (course.confident === false) return true;
        if (teePickKey === CUSTOM_TEE_ID) {
          const r = parseFloat(customRating);
          const s = parseInt(customSlope, 10);
          return Number.isFinite(r) && Number.isFinite(s);
        }
        return courseTees.some((t) => t.name === teePickKey);
      }
      case 3:
        return true;
      case 4:
        return true;
      case 5:
        return (
          settingsImage?.uri != null || (ALLOW_SKIP_SETTINGS_SCREENSHOT && devSkipSettingsPhoto)
        );
      case 6:
        return true;
      case 7: {
        const base = devFutureTwoMinuteMode ? new Date(Date.now() + 2 * 60 * 1000) : scheduledForDraft;
        const t = base.getTime();
        return t >= minScheduleDate().getTime() && t <= maxScheduleDate().getTime();
      }
      default:
        return false;
    }
  }, [
    screenStep,
    supabaseOn,
    user,
    opponent,
    course,
    course?.confident,
    teePickKey,
    customRating,
    customSlope,
    courseTees,
    settingsImage,
    devSkipSettingsPhoto,
    devFutureTwoMinuteMode,
    scheduledForDraft,
  ]);

  const canSendChallenge = useMemo(() => {
    if (!user || !course) return false;
    if (challengeKind === 'direct' && !opponent) return false;
    if (challengeKind === 'open' && openChallengeMode === 'future') return true;
    const photoUri = settingsImage?.uri;
    const skipPhotoDev =
      ALLOW_SKIP_SETTINGS_SCREENSHOT && devSkipSettingsPhoto && photoUri == null;
    if (photoUri == null && !skipPhotoDev) return false;
    return true;
  }, [user, course, challengeKind, openChallengeMode, opponent, settingsImage, devSkipSettingsPhoto]);

  const selectChallengeKind = useCallback(
    async (key: ChallengeKind) => {
      if (key === 'direct') {
        setChallengeKind('direct');
        setOpenChallengeMode('now');
        return;
      }
      const uid = user?.id;
      if (!uid) return;
      const myRes = await listMyMatches(uid, googleOAuthAccessToken ?? undefined);
      if (myRes.error || myRes.data == null) {
        showAppAlert('Could not verify open challenges', myRes.error ?? 'Something went wrong.');
        return;
      }
      const openPostedCount = myRes.data.filter(
        (row) => row.is_open && row.status === 'open' && row.player_1_id === uid
      ).length;
      if (openPostedCount >= MAX_OPEN_CHALLENGES_POSTED) {
        showAppAlert(
          'Open challenge limit',
          `You already have ${MAX_OPEN_CHALLENGES_POSTED} open challenges. Cancel one from the Match Play section on Social before posting another.`
        );
        return;
      }
      setChallengeKind('open');
      setOpenChallengeMode('now');
    },
    [user?.id, googleOAuthAccessToken]
  );

  const goNext = useCallback(async () => {
    if (!canContinue) return;
    if (challengeKind === 'direct' && opponent && screenStep === 1 && user?.id) {
      const res = await listMyMatches(user.id, googleOAuthAccessToken ?? undefined);
      if (res.error || res.data == null) {
        showAppAlert('Could not verify your matches', res.error ?? 'Something went wrong.');
        return;
      }
      if (countActiveDirectMatchesForUser(res.data, user.id) >= MAX_ACTIVE_DIRECT_CHALLENGES) {
        showAppAlert(
          'Challenge limit',
          `You have ${MAX_ACTIVE_DIRECT_CHALLENGES} active challenges. Finish or resolve an existing match before sending a new one.`
        );
        return;
      }
      if (hasBlockingDirectMatchWithOpponent(res.data, user.id, opponent.userId)) {
        showAppAlert(
          'Match already in progress',
          `You already have a match with ${opponent.displayName} that is pending, active, or waiting. Finish or resolve that match before sending a new challenge.`
        );
        return;
      }
    }
    if (stepIdx < totalSteps - 1) setStepIdx((s) => s + 1);
  }, [canContinue, stepIdx, totalSteps, challengeKind, opponent, screenStep, user?.id, googleOAuthAccessToken]);

  const goBackStep = useCallback(() => {
    if (stepIdx > 0) setStepIdx((s) => s - 1);
  }, [stepIdx]);

  const onSendChallenge = useCallback(async () => {
    if (!user || !course) return;
    if (challengeKind === 'direct' && !opponent) return;
    const photoUri = settingsImage?.uri;
    const skipPhotoDev =
      ALLOW_SKIP_SETTINGS_SCREENSHOT && devSkipSettingsPhoto && photoUri == null;
    const isFutureOpen = challengeKind === 'open' && openChallengeMode === 'future';
    if (!isFutureOpen && photoUri == null && !skipPhotoDev) return;
    const tee = resolvePlayer1Tee({
      course,
      platform,
      teePickKey,
      customRating,
      customSlope,
      courseTees,
    });

    if (challengeKind === 'direct' && opponent) {
      const res = await listMyMatches(user.id, googleOAuthAccessToken ?? undefined);
      if (res.error || res.data == null) {
        showAppAlert('Could not verify your matches', res.error ?? 'Something went wrong.');
        return;
      }
      if (countActiveDirectMatchesForUser(res.data, user.id) >= MAX_ACTIVE_DIRECT_CHALLENGES) {
        showAppAlert(
          'Challenge limit',
          `You have ${MAX_ACTIVE_DIRECT_CHALLENGES} active challenges. Finish or resolve an existing match before sending a new one.`
        );
        return;
      }
      if (hasBlockingDirectMatchWithOpponent(res.data, user.id, opponent.userId)) {
        showAppAlert(
          'Match already in progress',
          `You already have a match with ${opponent.displayName} that is pending, active, or waiting. Finish or resolve that match before sending a new challenge.`
        );
        return;
      }
    }

    setSubmitBusy(true);

    // Final submit order (required by `match-settings` storage RLS): insert the `matches` row
    // first so the path `{match_id}/{user_id}/…` is allowed, then upload, then patch the signed URL.
    const idxSnapshot = currentIndexFromRounds(useAppStore.getState().rounds);
    const resolvedScheduledFor = isFutureOpen
      ? devFutureTwoMinuteMode
        ? new Date(Date.now() + 2 * 60 * 1000)
        : clampScheduledDate(scheduledForDraft)
      : null;
    const ins = await insertMatch(
      {
        player_2_id: challengeKind === 'open' ? null : opponent!.userId,
        is_open: challengeKind === 'open',
        course_name: course.name,
        player_1_course_rating: tee.rating,
        player_1_course_slope: tee.slope,
        player_1_tee: tee.teeName,
        putting_mode: putting,
        pin_placement: pin,
        wind,
        mulligans,
        holes: holesChoice === '18' ? 18 : 9,
        nine_selection: holesChoice === '18' ? null : holesChoice === 'front' ? 'front' : 'back',
        status: challengeKind === 'open' ? 'open' : 'pending',
        player_1_settings_photo_url: null,
        scheduled_for: resolvedScheduledFor?.toISOString() ?? null,
        challenge_status: challengeKind === 'open' ? (isFutureOpen ? 'scheduled' : 'active') : null,
        rematch_from: challengeKind === 'direct' && rematchSourceMatchId ? rematchSourceMatchId : null,
        player_1_ghin_index_at_post: idxSnapshot != null && Number.isFinite(idxSnapshot) ? idxSnapshot : null,
        player_1_platform: platform,
        verification_required: verificationRequired,
      },
      user.id,
      googleOAuthAccessToken ?? undefined
    );
    if (ins.error || !ins.data) {
      setSubmitBusy(false);
      showAppAlert('Could not create match', ins.error ?? 'Unknown error');
      return;
    }
    const matchId = ins.data.id;

    if (!isFutureOpen && photoUri != null) {
      const up = await uploadMatchSettingsScreenshot({
        matchId,
        userId: user.id,
        localUri: photoUri,
        mimeType: settingsImage?.mimeType ?? undefined,
        accessToken: googleOAuthAccessToken ?? undefined,
      });
      if ('error' in up) {
        setSubmitBusy(false);
        showAppAlert(
          'Upload failed',
          `${up.error}\n\nYour challenge was created.${
            challengeKind === 'direct' && opponent
              ? ` Share your sim settings screenshot with ${opponent.displayName} another way for now.`
              : ''
          }`
        );
        router.replace('/(tabs)/groups' as never);
        return;
      }
      const upd = await updateMatchById(matchId, { player_1_settings_photo_url: up.signedUrl }, googleOAuthAccessToken ?? undefined);
      if (upd.error) {
        console.warn('[match-create] update photo url', upd.error);
      }
    }
    setSubmitBusy(false);
    setRematchSourceMatchId(null);
    router.replace('/(tabs)/groups' as never);
  }, [
    user,
    challengeKind,
    openChallengeMode,
    opponent,
    course,
    platform,
    teePickKey,
    customRating,
    customSlope,
    courseTees,
    putting,
    pin,
    wind,
    mulligans,
    holesChoice,
    settingsImage,
    devSkipSettingsPhoto,
    devFutureTwoMinuteMode,
    scheduledForDraft,
    rematchSourceMatchId,
    verificationRequired,
    router,
    googleOAuthAccessToken,
  ]);

  if (!supabaseOn || !user) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.fallback, { padding: gutter }]}>
          <Text style={styles.fallbackTxt}>Sign in with Supabase configured to create a match.</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnTxt}>Go back</Text>
          </Pressable>
        </View>
      </ContentWidth>
    );
  }

  const stepTitle = (n: number) => {
    switch (n) {
      case 0:
        return 'Challenge type';
      case 1:
        return 'Opponent';
      case 2:
        return 'Sim, course & tee';
      case 3:
        return 'Sim settings';
      case 4:
        return 'Holes';
      case 5:
        return 'Sim setup photo';
      case 6:
        return 'Review & send';
      case 7:
        return 'Schedule go-live time';
      default:
        return '';
    }
  };

  const holesLabel =
    holesChoice === '18' ? '18 holes' : holesChoice === 'front' ? 'Front 9 (holes 1–9)' : 'Back 9 (holes 10–18)';

  return (
    <ContentWidth bg={colors.surface}>
      <View style={styles.root}>
        {rematchHydrating ? (
          <View style={styles.rematchHydrateOverlay} pointerEvents="auto">
            <ActivityIndicator size="large" color={colors.header} />
            <Text style={styles.rematchHydrateTxt}>Setting up rematch…</Text>
          </View>
        ) : null}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingTop: 14,
            paddingBottom: insets.bottom + 24,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.stepProg}>
            Step {stepIdx + 1} of {totalSteps}
          </Text>
          <Text style={styles.stepHead}>{stepTitle(screenStep)}</Text>

          {screenStep === 0 ? (
            <>
              <Text style={styles.body}>Choose who can join this match.</Text>
              {(
                [
                  {
                    key: 'direct' as const,
                    title: 'Direct challenge',
                    sub: 'Pick a crewmate from your groups. They accept privately on Social.',
                  },
                  {
                    key: 'open' as const,
                    title: 'Open challenge',
                    sub: 'Post to the SimCap feed. Any signed-in player can review details and accept.',
                  },
                ] as const
              ).map((opt) => {
                const on = challengeKind === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    style={[styles.holeCard, on && styles.holeCardOn]}
                    onPress={() => void selectChallengeKind(opt.key)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.holeTitle}>{opt.title}</Text>
                      <Text style={styles.holeSub}>{opt.sub}</Text>
                    </View>
                    {on ? <IconCheckmark size={20} color={colors.accent} /> : null}
                  </Pressable>
                );
              })}
              {challengeKind === 'open' ? (
                <>
                  <Text style={styles.sectionLabel}>Open challenge type</Text>
                  <View style={styles.openModeRow}>
                    <Pressable
                      style={[styles.openModeBtn, openChallengeMode === 'now' && styles.openModeBtnOn]}
                      onPress={() => {
                        setOpenChallengeMode('now');
                        setDevFutureTwoMinuteMode(false);
                      }}
                    >
                      <Text style={[styles.openModeBtnTxt, openChallengeMode === 'now' && styles.openModeBtnTxtOn]}>
                        Now
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.openModeBtn, openChallengeMode === 'future' && styles.openModeBtnOn]}
                      onPress={() => setOpenChallengeMode('future')}
                    >
                      <Text style={[styles.openModeBtnTxt, openChallengeMode === 'future' && styles.openModeBtnTxtOn]}>
                        Later
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
            </>
          ) : null}

          {screenStep === 1 ? (
            <>
              {opponents.length === 0 ? (
                <Text style={styles.body}>
                  You need group members to send a direct challenge. Create or join a crew on the Social tab, or ask a
                  friend to join SimCap — then try again.
                </Text>
              ) : (
                opponents.map((o) => {
                  const on = opponent?.userId === o.userId;
                  return (
                    <Pressable
                      key={o.userId}
                      style={[styles.oppRow, on && styles.oppRowOn]}
                      onPress={() => setOpponent(o)}
                    >
                      <View style={styles.oppTextCol}>
                        <Text style={styles.oppName}>{o.displayName}</Text>
                        <Text style={styles.oppMeta}>
                          Index {formatHandicapIndexDisplay(indexByUserId.get(o.userId) ?? null)} · {o.groupLine}
                        </Text>
                      </View>
                      {on ? <IconCheckmark size={20} color={colors.accent} /> : null}
                    </Pressable>
                  );
                })
              )}
            </>
          ) : null}

          {screenStep === 2 ? (
            <>
              <Text style={styles.sectionLabel}>Sim platform</Text>
              <Pressable style={[styles.pill, platOpen && styles.pillActive]} onPress={() => setPlatOpen(true)}>
                <Text style={styles.pillVal}>{platform}</Text>
                <Text style={styles.chev}>▾</Text>
              </Pressable>
              <Text style={styles.sectionLabel}>Course</Text>
              <Pressable style={[styles.pill, courseOpen && styles.pillActive]} onPress={() => setCourseOpen(true)}>
                <Text style={styles.pillVal}>{course?.name ?? 'Select'}</Text>
                <Text style={styles.chev}>▾</Text>
              </Pressable>

              {course ? (
                <>
                  {!showTeeSelector ? (
                    <Text style={styles.body}>
                      This course uses a single rating/slope for your platform. We&apos;ll use it for your side of the
                      match.
                    </Text>
                  ) : (
                    <>
                      <Text style={styles.sectionLabel}>Tee</Text>
                      <View style={styles.teeChipWrap}>
                        {courseTees.map((t) => (
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
                              {t.rating} / {t.slope}
                            </Text>
                          </Pressable>
                        ))}
                        <Pressable
                          style={[styles.teeChip, teePickKey === CUSTOM_TEE_ID && styles.teeChipOn]}
                          onPress={() => setTeePickKey(CUSTOM_TEE_ID)}
                        >
                          <Text style={[styles.teeChipTxt, teePickKey === CUSTOM_TEE_ID && styles.teeChipTxtOn]}>
                            Custom
                          </Text>
                          <Text style={[styles.teeChipSub, teePickKey === CUSTOM_TEE_ID && styles.teeChipSubOn]}>
                            Your rating / slope
                          </Text>
                        </Pressable>
                      </View>
                      {teePickKey === CUSTOM_TEE_ID ? (
                        <View style={styles.teeCustomRow}>
                          <View style={styles.teeCustomField}>
                            <Text style={styles.teeCustomLbl}>Course rating</Text>
                            <TextInput
                              style={styles.teeNumInput}
                              value={customRating}
                              onChangeText={setCustomRating}
                              placeholder="e.g. 72.1"
                              placeholderTextColor={colors.subtle}
                              keyboardType="decimal-pad"
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
                            />
                          </View>
                        </View>
                      ) : null}
                    </>
                  )}
                </>
              ) : null}
            </>
          ) : null}

          {screenStep === 3 ? (
            <>
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
                {PIN_OPTS.map((d) => (
                  <Pressable
                    key={d.key}
                    style={[styles.dayBtn, pin === d.key && styles.dayBtnOn]}
                    onPress={() => setPin(d.key)}
                  >
                    <Text style={[styles.dayDn, pin === d.key && styles.dayDnOn]}>{d.dn}</Text>
                    <Text style={[styles.dayDs, pin === d.key && styles.dayDsOn]}>{d.ds}</Text>
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
            </>
          ) : null}

          {screenStep === 4 ? (
            <>
              <Text style={styles.body}>Choose how many holes you&apos;re playing on this course.</Text>
              {(
                [
                  { key: '18' as const, title: '18 holes', sub: 'Full round' },
                  { key: 'front' as const, title: 'Front 9', sub: 'Holes 1–9' },
                  { key: 'back' as const, title: 'Back 9', sub: 'Holes 10–18' },
                ] as const
              ).map((h) => {
                const on = holesChoice === h.key;
                return (
                  <Pressable
                    key={h.key}
                    style={[styles.holeCard, on && styles.holeCardOn]}
                    onPress={() => setHolesChoice(h.key)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.holeTitle}>{h.title}</Text>
                      <Text style={styles.holeSub}>{h.sub}</Text>
                    </View>
                    {on ? <IconCheckmark size={20} color={colors.accent} /> : null}
                  </Pressable>
                );
              })}
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Scorecard verification</Text>
              <Pressable
                style={[styles.holeCard, verificationRequired && styles.holeCardOn]}
                onPress={() => setVerificationRequired((v) => !v)}
                accessibilityRole="switch"
                accessibilityState={{ checked: verificationRequired }}
                accessibilityLabel="Require scorecard verification"
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.holeTitle}>Require scorecard verification</Text>
                  <Text style={styles.holeSub}>
                    Both players upload a final scorecard screenshot; AI confirms scores match before the match
                    completes.
                  </Text>
                </View>
                {verificationRequired ? <IconCheckmark size={20} color={colors.accent} /> : null}
              </Pressable>
            </>
          ) : null}

          {screenStep === 5 ? (
            <>
              <Text style={styles.body}>
                Take a photo of your sim&apos;s settings screen so your opponent can see your exact setup — putting mode,
                pins, wind, and mulligans. Both players use the honor system for conditions.
              </Text>
              {libraryPermissionBlocked ? (
                <View style={styles.photoPermCallout} accessibilityLiveRegion="polite">
                  <Text style={styles.photoPermCalloutTxt}>
                    Photo library access is off. To attach a screenshot, open Settings, allow Photos access for this app,
                    then come back and tap Choose photo again.
                  </Text>
                  {Platform.OS !== 'web' ? (
                    <Pressable
                      style={styles.photoPermSettingsBtn}
                      onPress={openPhotoSettings}
                      accessibilityRole="button"
                      accessibilityLabel="Open Settings to allow photo access"
                    >
                      <Text style={styles.photoPermSettingsBtnTxt}>Open Settings</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <Pressable style={styles.pickPhotoBtn} onPress={() => void onPickImage()}>
                <Text style={styles.pickPhotoBtnTxt}>{settingsImage ? 'Change photo' : 'Choose photo'}</Text>
              </Pressable>
              {ALLOW_SKIP_SETTINGS_SCREENSHOT && !settingsImage?.uri && !devSkipSettingsPhoto ? (
                <Pressable
                  style={styles.skipPhotoBtn}
                  onPress={() => setDevSkipSettingsPhoto(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Skip settings screenshot for now, development only"
                >
                  <Text style={styles.skipPhotoBtnTxt}>Skip for now</Text>
                </Pressable>
              ) : null}
              {settingsImage?.uri ? (
                <Image source={{ uri: settingsImage.uri }} style={styles.preview} resizeMode="contain" />
              ) : null}
            </>
          ) : null}

          {screenStep === 7 ? (
            <>
              <Text style={styles.body}>
                Pick when this challenge should go live. At that time, you&apos;ll be asked to upload your sim setup
                photo before it appears in the active feed.
              </Text>
              <Text style={styles.bodyMuted}>Schedule window: now through {FUTURE_OPEN_MAX_DAYS} days from now.</Text>
              <View style={styles.schedulePickerWrap}>
                <DateTimePicker
                  mode="datetime"
                  value={scheduledForDraft}
                  minimumDate={minScheduleDate()}
                  maximumDate={maxScheduleDate()}
                  onChange={(_, d) => {
                    if (!d) return;
                    setDevFutureTwoMinuteMode(false);
                    setScheduledForDraft(clampScheduledDate(d));
                  }}
                />
              </View>
              {__DEV__ ? (
                <Pressable
                  style={[styles.devFastBtn, devFutureTwoMinuteMode && styles.devFastBtnOn]}
                  onPress={() => setDevFutureTwoMinuteMode((v) => !v)}
                >
                  <Text style={[styles.devFastBtnTxt, devFutureTwoMinuteMode && styles.devFastBtnTxtOn]}>
                    Dev only: go live in 2 minutes
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

          {screenStep === 6 && course && (challengeKind === 'open' || opponent) ? (
            <>
              <View style={styles.summaryBlock}>
                {challengeKind === 'direct' && opponent ? (
                  <Text style={styles.summaryLine}>
                    <Text style={styles.summaryLbl}>Opponent · </Text>
                    {opponent.displayName}
                  </Text>
                ) : null}
                {challengeKind === 'open' ? (
                  <Text style={styles.summaryLine}>
                    <Text style={styles.summaryLbl}>Visibility · </Text>
                    {openChallengeMode === 'future' ? 'Future open challenge — Scheduled feed' : 'Open challenge — Social feed'}
                  </Text>
                ) : null}
                {challengeKind === 'open' && openChallengeMode === 'future' ? (
                  <Text style={styles.summaryLine}>
                    <Text style={styles.summaryLbl}>Go live · </Text>
                    {devFutureTwoMinuteMode ? 'Dev only: in 2 minutes' : scheduledForDraft.toLocaleString()}
                  </Text>
                ) : null}
                <Text style={styles.summaryLine}>
                  <Text style={styles.summaryLbl}>Course · </Text>
                  {course.name}
                </Text>
                <Text style={styles.summaryLine}>
                  <Text style={styles.summaryLbl}>Your tee · </Text>
                  {resolvePlayer1Tee({
                    course,
                    platform,
                    teePickKey,
                    customRating,
                    customSlope,
                    courseTees,
                  }).teeName}
                </Text>
                <Text style={styles.summaryLine}>
                  <Text style={styles.summaryLbl}>Holes · </Text>
                  {holesLabel}
                </Text>
                <Text style={styles.summaryLine}>
                  <Text style={styles.summaryLbl}>Conditions · </Text>
                  {PUTTING_OPTS.find((p) => p.key === putting)?.dn} putting ·{' '}
                  {PIN_OPTS.find((p) => p.key === pin)?.dn} pins · {WIND_OPTS.find((p) => p.key === wind)?.dn} wind ·{' '}
                  {MULL_OPTS.find((p) => p.key === mulligans)?.dn} mulligans
                </Text>
              </View>
              {settingsImage?.uri ? (
                <Image source={{ uri: settingsImage.uri }} style={styles.previewSmall} resizeMode="cover" />
              ) : ALLOW_SKIP_SETTINGS_SCREENSHOT && devSkipSettingsPhoto ? (
                <Text style={styles.devSkipPhotoNote}>Settings screenshot · Skipped (dev only)</Text>
              ) : null}
              {challengeKind === 'open' && openChallengeMode === 'now' ? (
                <>
                  <Text style={styles.sectionLabel}>Open challenge type</Text>
                  <View style={styles.openModeRow}>
                    <Pressable
                      style={[styles.openModeBtn, styles.openModeBtnOn]}
                      onPress={() => {
                        setOpenChallengeMode('now');
                        setDevFutureTwoMinuteMode(false);
                      }}
                    >
                      <Text style={[styles.openModeBtnTxt, styles.openModeBtnTxtOn]}>Now</Text>
                    </Pressable>
                    <Pressable
                      style={styles.openModeBtn}
                      onPress={() => setOpenChallengeMode('future')}
                    >
                      <Text style={styles.openModeBtnTxt}>Later</Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.sendBtn,
                  pressed && styles.sendBtnPressed,
                  (submitBusy || rematchHydrating || !canSendChallenge) && styles.sendBtnDisabled,
                ]}
                onPress={() => void onSendChallenge()}
                disabled={submitBusy || rematchHydrating || !canSendChallenge}
              >
                {submitBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.sendBtnTxt}>
                    {challengeKind === 'open'
                      ? openChallengeMode === 'future'
                        ? 'Schedule future challenge'
                        : 'Post open challenge'
                      : 'Send challenge'}
                  </Text>
                )}
              </Pressable>
            </>
          ) : null}

          {stepIdx === totalSteps - 1 && stepIdx > 0 ? (
            <View style={[styles.navFooterReview, isWide && styles.navRowWide]}>
              <Pressable style={styles.secondaryBtnFull} onPress={goBackStep}>
                <Text style={styles.secondaryBtnTxt}>Back</Text>
              </Pressable>
            </View>
          ) : (
            <View style={[styles.navRow, isWide && styles.navRowWide]}>
              {stepIdx > 0 ? (
                <Pressable style={styles.secondaryBtn} onPress={goBackStep}>
                  <Text style={styles.secondaryBtnTxt}>Back</Text>
                </Pressable>
              ) : (
                <View style={styles.navSpacer} />
              )}
              {stepIdx < totalSteps - 1 ? (
                <Pressable
                  style={[styles.primaryBtn, !canContinue && styles.primaryBtnDisabled]}
                  onPress={() => void goNext()}
                  disabled={!canContinue}
                >
                  <Text style={styles.primaryBtnTxt}>Continue</Text>
                </Pressable>
              ) : (
                <View style={styles.navSpacer} />
              )}
            </View>
          )}
        </ScrollView>

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
          <View style={styles.modalRoot}>
            <Pressable style={styles.modalBackdropPress} onPress={() => setCourseOpen(false)} />
            <View style={[styles.modalSheet, styles.modalSheetTall, { paddingBottom: insets.bottom + 16 }]}>
              <Text style={styles.modalTitle}>Course</Text>
              <TextInput
                style={styles.courseSearchInput}
                value={courseSearchQuery}
                onChangeText={setCourseSearchQuery}
                placeholder="Search by course name"
                placeholderTextColor={colors.subtle}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                {coursesForPicker.length === 0 ? (
                  <Text style={styles.courseSearchEmpty}>No courses match that search.</Text>
                ) : (
                  coursesForPicker.map((c) => (
                    <Pressable
                      key={c.id}
                      style={styles.modalRow}
                      onPress={() => {
                        setCourseId(c.id);
                        const teesPick = getCourseTees(c, platform);
                        if (c.confident === false && teesPick.length > 0) {
                          setTeePickKey(teesPick[Math.floor(teesPick.length / 2)].name);
                        } else {
                          const defPick = c.defaultTee?.trim();
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
                      <Text style={styles.modalRowTxt}>{c.name}</Text>
                      {courseId === c.id ? <IconCheckmark size={18} color={colors.accent} /> : null}
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    backgroundColor: colors.surface,
    width: '100%',
    position: 'relative',
  },
  rematchHydrateOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    opacity: 0.97,
    zIndex: 40,
    paddingHorizontal: 24,
  },
  rematchHydrateTxt: {
    marginTop: 14,
    fontSize: 15,
    fontWeight: '600',
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 21,
  },
  scroll: { flex: 1, minHeight: 0, width: '100%' },
  headerCancelPress: { paddingHorizontal: 8, paddingVertical: 4 },
  headerCancelTxt: { color: '#fff', fontSize: 16, fontWeight: '600' },
  stepProg: { fontSize: 11, fontWeight: '600', color: colors.sage, marginBottom: 4 },
  stepHead: { fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 14 },
  body: { fontSize: 14, color: colors.muted, lineHeight: 21, marginBottom: 10 },
  bodyMuted: { fontSize: 12, color: colors.subtle, lineHeight: 18, marginTop: 8 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.subtle,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 5,
    marginTop: 10,
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
  pillVal: { fontSize: 12, fontWeight: '600', color: colors.ink },
  chev: { fontSize: 9, color: colors.subtle },
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
  openModeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  openModeBtn: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 9,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  openModeBtnOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  openModeBtnTxt: { fontSize: 12, fontWeight: '700', color: colors.muted, textAlign: 'center' },
  openModeBtnTxtOn: { color: colors.accentDark },
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
  dayDn: { fontSize: 11, fontWeight: '600', color: colors.muted },
  dayDnOn: { color: colors.accentDark },
  dayDs: { fontSize: 9, color: colors.subtle, marginTop: 1 },
  dayDsOn: { color: colors.accent },
  oppRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  oppRowOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  oppTextCol: { flex: 1, minWidth: 0, paddingRight: 8 },
  oppName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  oppMeta: { fontSize: 11, color: colors.muted, marginTop: 3 },
  holeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  holeCardOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  holeTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  holeSub: { fontSize: 11, color: colors.muted, marginTop: 2 },
  photoPermCallout: {
    marginTop: 10,
    marginBottom: 4,
    padding: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  photoPermCalloutTxt: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  photoPermSettingsBtn: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.sage,
    backgroundColor: colors.accentSoft,
  },
  photoPermSettingsBtnTxt: { fontSize: 14, fontWeight: '700', color: colors.accent },
  pickPhotoBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.header,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginTop: 8,
    marginBottom: 6,
  },
  pickPhotoBtnTxt: { color: '#fff', fontSize: 14, fontWeight: '700' },
  skipPhotoBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginBottom: 10,
  },
  skipPhotoBtnTxt: { fontSize: 14, fontWeight: '600', color: colors.muted, textDecorationLine: 'underline' },
  devSkipPhotoNote: {
    fontSize: 13,
    color: colors.muted,
    fontStyle: 'italic',
    marginTop: 8,
    lineHeight: 18,
  },
  preview: { width: '100%', height: 220, borderRadius: 10, backgroundColor: colors.bg },
  previewSmall: { width: '100%', height: 120, borderRadius: 10, marginTop: 8, backgroundColor: colors.bg },
  schedulePickerWrap: {
    marginTop: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.bg,
    padding: 10,
    alignItems: 'stretch',
  },
  devFastBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#e08f2b',
    borderRadius: 9,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fff7ea',
  },
  devFastBtnOn: { borderColor: '#b86900', backgroundColor: '#ffe9c5' },
  devFastBtnTxt: { fontSize: 12, fontWeight: '700', color: '#a55f00' },
  devFastBtnTxtOn: { color: '#7a4400' },
  summaryBlock: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  summaryLine: { fontSize: 14, color: colors.ink, marginBottom: 8, lineHeight: 20 },
  summaryLbl: { fontWeight: '700', color: colors.subtle },
  sendBtn: {
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
    minHeight: 48,
    justifyContent: 'center',
  },
  sendBtnPressed: { opacity: 0.9 },
  sendBtnDisabled: { opacity: 0.7 },
  sendBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  navFooterReview: { marginTop: 22, width: '100%', alignSelf: 'stretch' },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, gap: 12 },
  navRowWide: { maxWidth: 480, alignSelf: 'center', width: '100%' },
  navSpacer: { flex: 1 },
  secondaryBtnFull: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderWidth: 1.5,
    borderColor: colors.sage,
    backgroundColor: colors.accentSoft,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.header,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.sage,
    backgroundColor: colors.accentSoft,
  },
  secondaryBtnTxt: { fontSize: 15, fontWeight: '700', color: colors.accent },
  fallback: { flex: 1, justifyContent: 'center', minHeight: 200 },
  fallbackTxt: { fontSize: 14, color: colors.muted, marginBottom: 16, lineHeight: 21 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
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
  courseSearchEmpty: { fontSize: 14, color: colors.muted, paddingVertical: 16, textAlign: 'center' },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
  },
  modalRowTxt: { fontSize: 15, color: colors.ink },
});
