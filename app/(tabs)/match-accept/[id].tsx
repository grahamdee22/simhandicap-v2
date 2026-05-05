import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
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
import { useAuth } from '../../../src/auth/AuthContext';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { IconCheckmark } from '../../../src/components/SvgUiIcons';
import { showAppAlert } from '../../../src/lib/alertCompat';
import { PLATFORMS, colors, type PlatformId } from '../../../src/lib/constants';
import {
  COURSE_SEEDS,
  CUSTOM_TEE_ID,
  findCourseSeedIdByCourseName,
  getCourseById,
  getCourseTees,
  middleCourseTee,
  ratingForCourse,
  type CourseSeed,
} from '../../../src/lib/courses';
import {
  type Mulligans,
  type PinDay,
  type PuttingMode,
  round1,
  type Wind,
} from '../../../src/lib/handicap';
import {
  getMatchById,
  updateMatchById,
  type DbMatchRow,
  type MatchUpdatePatch,
} from '../../../src/lib/matchPlay';
import { uploadMatchSettingsScreenshot } from '../../../src/lib/matchPlayStorage';
import { settingsScreenshotPickerOptions } from '../../../src/lib/settingsScreenshotPicker';
import { useResponsive } from '../../../src/lib/responsive';
import { isSupabaseConfigured, supabase } from '../../../src/lib/supabase';
import { useAppStore } from '../../../src/store/useAppStore';

const STEPS = 4;

const ALLOW_SKIP_SETTINGS_SCREENSHOT = __DEV__;

const PUTTING_OPTS: { key: PuttingMode; dn: string }[] = [
  { key: 'auto_2putt', dn: 'Auto' },
  { key: 'gimme_5', dn: 'Gimme' },
  { key: 'putt_all', dn: 'Putt' },
];

const WIND_OPTS: { key: Wind; dn: string }[] = [
  { key: 'off', dn: 'Off' },
  { key: 'light', dn: 'Light' },
  { key: 'strong', dn: 'Strong' },
];

const MULL_OPTS: { key: Mulligans; dn: string }[] = [
  { key: 'off', dn: 'Off' },
  { key: 'on', dn: 'On' },
];

const PIN_OPTS: { key: PinDay; dn: string }[] = [
  { key: 'thu', dn: 'Thu' },
  { key: 'fri', dn: 'Fri' },
  { key: 'sat', dn: 'Sat' },
  { key: 'sun', dn: 'Sun' },
];

function formatHolesLabel(m: DbMatchRow): string {
  if (m.holes === 18) return '18 holes';
  if (m.nine_selection === 'front') return 'Front 9';
  if (m.nine_selection === 'back') return 'Back 9';
  return `${m.holes} holes`;
}

function conditionsSummary(m: DbMatchRow): string {
  const p = PUTTING_OPTS.find((x) => x.key === m.putting_mode)?.dn ?? m.putting_mode;
  const pin = PIN_OPTS.find((x) => x.key === m.pin_placement)?.dn ?? m.pin_placement;
  const w = WIND_OPTS.find((x) => x.key === m.wind)?.dn ?? m.wind;
  const mu = MULL_OPTS.find((x) => x.key === m.mulligans)?.dn ?? m.mulligans;
  return `${p} putting · ${pin} pins · ${w} wind · ${mu} mulligans`;
}

function findCourseByMatchName(name: string): CourseSeed | undefined {
  return COURSE_SEEDS.find((c) => c.name === name);
}

function resolvePlayer2Tee(args: {
  course: CourseSeed | undefined;
  platform: PlatformId;
  teePickKey: string;
  customRating: string;
  customSlope: string;
  courseTees: ReturnType<typeof getCourseTees>;
}): { rating: number; slope: number; teeName: string } | null {
  const { course, platform, teePickKey, customRating, customSlope, courseTees } = args;
  if (!course) {
    const r = parseFloat(customRating);
    const s = parseInt(customSlope, 10);
    if (!Number.isFinite(r) || !Number.isFinite(s)) return null;
    return { rating: round1(r), slope: Math.round(s), teeName: 'Your tee' };
  }
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

export default function MatchAcceptScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const matchId = typeof rawId === 'string' ? rawId : rawId?.[0] ?? '';
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { gutter, isWide } = useResponsive();
  const { user } = useAuth();
  const preferredLogPlatform = useAppStore((s) => s.preferredLogPlatform);
  const supabaseOn = isSupabaseConfigured();

  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [match, setMatch] = useState<DbMatchRow | null>(null);
  const [challengerName, setChallengerName] = useState('Challenger');
  const [loadingMatch, setLoadingMatch] = useState(true);

  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<PlatformId>(preferredLogPlatform);
  const [teePickKey, setTeePickKey] = useState('White');
  const [customRating, setCustomRating] = useState('');
  const [customSlope, setCustomSlope] = useState('');
  const [platOpen, setPlatOpen] = useState(false);
  const [settingsImage, setSettingsImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [libraryPermissionBlocked, setLibraryPermissionBlocked] = useState(false);
  const [devSkipSettingsPhoto, setDevSkipSettingsPhoto] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [p1SettingsImageError, setP1SettingsImageError] = useState(false);
  /** True when accept flow was hydrated from `rematch_from` (locked path: photo + confirm only). */
  const [rematchAcceptLocked, setRematchAcceptLocked] = useState(false);
  const skipNextCourseTeeResetRef = useRef(false);

  const course = useMemo(
    () => (match ? findCourseByMatchName(match.course_name) : undefined),
    [match?.course_name]
  );
  const courseTees = useMemo(() => (course ? getCourseTees(course, platform) : []), [course, platform]);
  const showTeeSelector = course != null && course.confident !== false;

  useEffect(() => {
    if (!course) return;
    if (skipNextCourseTeeResetRef.current) {
      skipNextCourseTeeResetRef.current = false;
      return;
    }
    const tees = getCourseTees(course, platform);
    if (tees.length === 0) return;
    if (course.confident === false) {
      setTeePickKey(tees[Math.floor(tees.length / 2)].name);
    } else {
      const def = course.defaultTee?.trim();
      setTeePickKey(
        tees.find((t) => t.name === def)?.name ?? tees[tees.length - 1]?.name ?? tees[0].name
      );
    }
    setCustomRating('');
    setCustomSlope('');
  }, [course, platform]);

  useEffect(() => {
    if (step !== 2) setLibraryPermissionBlocked(false);
    if (step < 2) setDevSkipSettingsPhoto(false);
  }, [step]);

  useEffect(() => {
    if (step !== 2 || !libraryPermissionBlocked) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void ImagePicker.getMediaLibraryPermissionsAsync().then((p) => {
        if (p.granted) setLibraryPermissionBlocked(false);
      });
    });
    return () => sub.remove();
  }, [step, libraryPermissionBlocked]);

  useEffect(() => {
    if (!supabaseOn || !user?.id || !matchId) {
      setLoadingMatch(false);
      setLoadErr(!matchId ? 'Missing match.' : 'Sign in to continue.');
      return;
    }

    let cancelled = false;
    setLoadingMatch(true);
    setLoadErr(null);
    setStep(0);
    setSettingsImage(null);
    setRematchAcceptLocked(false);

    void (async () => {
      const res = await getMatchById(matchId);
      if (cancelled) return;
      if (res.error || !res.data) {
        setLoadErr(res.error ?? 'Could not load this match.');
        setMatch(null);
        setLoadingMatch(false);
        return;
      }
      let displayMatch = res.data;
      if (displayMatch.player_2_id !== user.id || displayMatch.status !== 'pending' || displayMatch.is_open) {
        setLoadErr('This challenge is no longer available to accept.');
        setMatch(null);
        setLoadingMatch(false);
        return;
      }

      const rematchId = displayMatch.rematch_from?.trim();
      if (rematchId) {
        const srcRes = await getMatchById(rematchId);
        if (!cancelled && srcRes.data && srcRes.data.status === 'complete') {
          const src = srcRes.data;
          const uid = user.id;
          if (src.player_1_id === uid || src.player_2_id === uid) {
            const wasP1OnSource = src.player_1_id === uid;
            const prefs: MatchUpdatePatch = {};
            if (PUTTING_OPTS.some((x) => x.key === src.putting_mode) && src.putting_mode !== displayMatch.putting_mode) {
              prefs.putting_mode = src.putting_mode;
            }
            if (PIN_OPTS.some((x) => x.key === src.pin_placement) && src.pin_placement !== displayMatch.pin_placement) {
              prefs.pin_placement = src.pin_placement;
            }
            if (WIND_OPTS.some((x) => x.key === src.wind) && src.wind !== displayMatch.wind) {
              prefs.wind = src.wind;
            }
            if (MULL_OPTS.some((x) => x.key === src.mulligans) && src.mulligans !== displayMatch.mulligans) {
              prefs.mulligans = src.mulligans;
            }
            if (Object.keys(prefs).length > 0) {
              const prefUpd = await updateMatchById(displayMatch.id, prefs);
              if (!cancelled && !prefUpd.error && prefUpd.data) {
                displayMatch = prefUpd.data;
              }
            }

            const plat = useAppStore.getState().preferredLogPlatform;
            const cid = findCourseSeedIdByCourseName(src.course_name) ?? null;
            const courseSeed = cid ? getCourseById(cid) : undefined;
            const tees = courseSeed ? getCourseTees(courseSeed, plat) : [];
            const myTeeName = (wasP1OnSource ? src.player_1_tee : src.player_2_tee) ?? 'White';
            const myRating = wasP1OnSource ? src.player_1_course_rating : src.player_2_course_rating;
            const mySlope = wasP1OnSource ? src.player_1_course_slope : src.player_2_course_slope;

            skipNextCourseTeeResetRef.current = true;
            setPlatform(plat);
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

            setStep(2);
            const myPhotoUrl = wasP1OnSource
              ? src.player_1_settings_photo_url?.trim() || null
              : src.player_2_settings_photo_url?.trim() || null;
            if (myPhotoUrl && /^https?:\/\//i.test(myPhotoUrl)) {
              const lower = myPhotoUrl.toLowerCase();
              const mimeType = lower.includes('.png')
                ? 'image/png'
                : lower.includes('.webp')
                  ? 'image/webp'
                  : 'image/jpeg';
              setSettingsImage({
                uri: myPhotoUrl,
                mimeType,
                width: 0,
                height: 0,
              } as ImagePicker.ImagePickerAsset);
            } else {
              setSettingsImage(null);
            }
            setDevSkipSettingsPhoto(false);
            setRematchAcceptLocked(true);
          }
        }
      }

      if (cancelled) return;
      setMatch(displayMatch);
      if (supabase) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', displayMatch.player_1_id)
          .maybeSingle();
        if (!cancelled && prof && typeof (prof as { display_name?: string }).display_name === 'string') {
          const dn = (prof as { display_name: string }).display_name?.trim();
          if (dn) setChallengerName(dn);
        }
      }
      setLoadingMatch(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabaseOn, user?.id, matchId]);

  useEffect(() => {
    setP1SettingsImageError(false);
  }, [match?.player_1_settings_photo_url]);

  useEffect(() => {
    if (!rematchAcceptLocked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 2) return true;
      if (step === 3) {
        setStep(2);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [rematchAcceptLocked, step]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Accept challenge',
      gestureEnabled: !rematchAcceptLocked,
      headerRight: () => (
        <Pressable
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.headerCancelPress}
          accessibilityRole="button"
          accessibilityLabel="Cancel accept match"
        >
          <Text style={styles.headerCancelTxt}>Cancel</Text>
        </Pressable>
      ),
    });
  }, [navigation, router, rematchAcceptLocked]);

  const openPhotoSettings = useCallback(() => {
    if (Platform.OS === 'web') return;
    void Linking.openSettings();
  }, []);

  const onPickImage = useCallback(async () => {
    const pickerOpts = settingsScreenshotPickerOptions();

    if (Platform.OS === 'web') {
      const result = await ImagePicker.launchImageLibraryAsync(pickerOpts);
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

    const unlockStackGestures = rematchAcceptLocked;
    if (unlockStackGestures) {
      navigation.setOptions({ gestureEnabled: true });
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync(pickerOpts);
      if (!result.canceled && result.assets[0]) {
        setSettingsImage(result.assets[0]);
        setLibraryPermissionBlocked(false);
        setDevSkipSettingsPhoto(false);
      }
    } finally {
      if (unlockStackGestures) {
        navigation.setOptions({ gestureEnabled: !rematchAcceptLocked });
      }
    }
  }, [navigation, rematchAcceptLocked]);

  const teeResolved = useMemo(
    () =>
      resolvePlayer2Tee({
        course,
        platform,
        teePickKey,
        customRating,
        customSlope,
        courseTees,
      }),
    [course, platform, teePickKey, customRating, customSlope, courseTees]
  );

  const canContinue = useMemo(() => {
    if (!match || !user) return false;
    switch (step) {
      case 0:
        return true;
      case 1:
        return teeResolved != null;
      case 2:
        return settingsImage?.uri != null || (ALLOW_SKIP_SETTINGS_SCREENSHOT && devSkipSettingsPhoto);
      case 3:
        return true;
      default:
        return false;
    }
  }, [match, user, step, teeResolved, settingsImage, devSkipSettingsPhoto]);

  const goNext = useCallback(() => {
    if (!canContinue) return;
    if (step < STEPS - 1) setStep((s) => s + 1);
  }, [canContinue, step]);

  const goBackStep = useCallback(() => {
    if (rematchAcceptLocked) {
      if (step === 2) return;
      if (step === 3) {
        setStep(2);
        return;
      }
    }
    if (step > 0) setStep((s) => s - 1);
  }, [step, rematchAcceptLocked]);

  const onConfirmAccept = useCallback(async () => {
    if (!user || !match || !teeResolved || !matchId) return;
    const photoUri = settingsImage?.uri;
    const skipPhotoDev =
      ALLOW_SKIP_SETTINGS_SCREENSHOT && devSkipSettingsPhoto && photoUri == null;
    if (photoUri == null && !skipPhotoDev) return;

    setSubmitBusy(true);
    let photoUrl: string | null = null;
    if (photoUri != null) {
      const up = await uploadMatchSettingsScreenshot({
        matchId,
        userId: user.id,
        localUri: photoUri,
        mimeType: settingsImage?.mimeType ?? undefined,
      });
      if ('error' in up) {
        setSubmitBusy(false);
        showAppAlert('Upload failed', up.error);
        return;
      }
      photoUrl = up.signedUrl;
    }

    const upd = await updateMatchById(matchId, {
      player_2_tee: teeResolved.teeName,
      player_2_course_rating: teeResolved.rating,
      player_2_course_slope: teeResolved.slope,
      player_2_settings_photo_url: photoUrl,
      status: 'active',
    });
    setSubmitBusy(false);
    if (upd.error || !upd.data) {
      showAppAlert('Could not accept match', upd.error ?? 'Unknown error');
      return;
    }
    router.replace('/(tabs)/groups' as never);
  }, [
    user,
    match,
    teeResolved,
    matchId,
    settingsImage,
    devSkipSettingsPhoto,
    router,
  ]);

  const stepTitle = (n: number) => {
    switch (n) {
      case 0:
        return 'Challenge details';
      case 1:
        return 'Your tee';
      case 2:
        return 'Settings screenshot';
      case 3:
        return 'Confirm';
      default:
        return '';
    }
  };

  if (!supabaseOn || !user) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.fallback, { padding: gutter }]}>
          <Text style={styles.fallbackTxt}>Sign in with Supabase configured to accept a match.</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnTxt}>Go back</Text>
          </Pressable>
        </View>
      </ContentWidth>
    );
  }

  if (loadingMatch) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.fallback, { padding: gutter }]}>
          <ActivityIndicator color={colors.header} />
        </View>
      </ContentWidth>
    );
  }

  if (loadErr || !match) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.fallback, { padding: gutter }]}>
          <Text style={styles.fallbackTxt}>{loadErr ?? 'Match not found.'}</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.replace('/(tabs)/groups' as never)}>
            <Text style={styles.secondaryBtnTxt}>Back to Social</Text>
          </Pressable>
        </View>
      </ContentWidth>
    );
  }

  return (
    <ContentWidth bg={colors.surface}>
      <View style={styles.root}>
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
            Step {step + 1} of {STEPS}
          </Text>
          <Text style={styles.stepHead}>{stepTitle(step)}</Text>

          {step === 0 ? (
            <>
              <Text style={styles.body}>
                <Text style={styles.bodyStrong}>{challengerName}</Text> challenged you to stroke play on{' '}
                <Text style={styles.bodyStrong}>{match.course_name}</Text> ({formatHolesLabel(match)}). Conditions are
                locked to what they proposed — you choose your sim platform, tee, and upload your settings screenshot.
              </Text>
              <View style={styles.summaryBlock}>
                <Text style={styles.summaryLine}>
                  <Text style={styles.summaryLbl}>Their tee · </Text>
                  {match.player_1_tee} ({match.player_1_course_rating} / {match.player_1_course_slope})
                </Text>
                <Text style={[styles.summaryLine, styles.summaryLineLast]}>
                  <Text style={styles.summaryLbl}>Conditions · </Text>
                  {conditionsSummary(match)}
                </Text>
              </View>

              <Text style={styles.challengerShotTitle}>Challenger&apos;s sim settings</Text>
              <View style={styles.challengerShotPanel}>
                {match.player_1_settings_photo_url && !p1SettingsImageError ? (
                  <Image
                    source={{ uri: match.player_1_settings_photo_url }}
                    style={styles.challengerShotImage}
                    resizeMode="contain"
                    accessibilityLabel={`${challengerName}'s simulator settings screenshot`}
                    onError={() => setP1SettingsImageError(true)}
                  />
                ) : (
                  <Text style={styles.challengerShotPlaceholder}>
                    {match.player_1_settings_photo_url && p1SettingsImageError
                      ? 'Could not load this image. Ask the challenger to re-post or share their settings another way.'
                      : 'No settings screenshot was uploaded for this challenge.'}
                  </Text>
                )}
              </View>
            </>
          ) : null}

          {step === 1 ? (
            <>
              {!course ? (
                <Text style={styles.body}>
                  This course name isn&apos;t in the SimCap catalog. Enter the course rating and slope for the tee you
                  will play from (same units as a USGA-style card).
                </Text>
              ) : !showTeeSelector ? (
                <Text style={styles.body}>
                  This course uses a single rating/slope for your platform. We&apos;ll use it for your side of the match.
                </Text>
              ) : (
                <>
                  <Text style={styles.sectionLabel}>Sim platform</Text>
                  <Pressable style={[styles.pill, platOpen && styles.pillActive]} onPress={() => setPlatOpen(true)}>
                    <Text style={styles.pillVal}>{platform}</Text>
                    <Text style={styles.chev}>▾</Text>
                  </Pressable>
                  <Text style={styles.sectionLabel}>Your tee</Text>
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
              {!course ? (
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
              ) : !showTeeSelector ? (
                <>
                  <Text style={styles.sectionLabel}>Sim platform</Text>
                  <Pressable style={[styles.pill, platOpen && styles.pillActive]} onPress={() => setPlatOpen(true)}>
                    <Text style={styles.pillVal}>{platform}</Text>
                    <Text style={styles.chev}>▾</Text>
                  </Pressable>
                </>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Text style={styles.body}>
                Upload a screenshot of your sim settings so {challengerName} can confirm your conditions match the
                agreed setup.
              </Text>
              {libraryPermissionBlocked ? (
                <View style={styles.photoPermCallout} accessibilityLiveRegion="polite">
                  <Text style={styles.photoPermCalloutTxt}>
                    Photo library access is off. Open Settings, allow Photos for this app, then tap Choose photo again.
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
              {rematchAcceptLocked ? (
                <View style={styles.rematchNotice} accessibilityRole="text">
                  <Text style={styles.rematchNoticeTxt}>
                    Settings must match the original match. If you&apos;d like to change conditions, create a new
                    challenge instead.
                  </Text>
                </View>
              ) : null}
              <Pressable style={styles.pickPhotoBtn} onPress={() => void onPickImage()}>
                <Text style={styles.pickPhotoBtnTxt}>{settingsImage ? 'Change photo' : 'Choose photo'}</Text>
              </Pressable>
              {ALLOW_SKIP_SETTINGS_SCREENSHOT && !rematchAcceptLocked && !settingsImage?.uri && !devSkipSettingsPhoto ? (
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

          {step === 3 && teeResolved ? (
            <>
              <View style={styles.summaryBlock}>
                <Text style={styles.summaryLine}>
                  <Text style={styles.summaryLbl}>Your tee · </Text>
                  {teeResolved.teeName} ({teeResolved.rating} / {teeResolved.slope})
                </Text>
                <Text style={styles.summaryLine}>
                  <Text style={styles.summaryLbl}>Platform · </Text>
                  {platform}
                </Text>
              </View>
              {settingsImage?.uri ? (
                <Image source={{ uri: settingsImage.uri }} style={styles.previewSmall} resizeMode="cover" />
              ) : ALLOW_SKIP_SETTINGS_SCREENSHOT && devSkipSettingsPhoto ? (
                <Text style={styles.devSkipPhotoNote}>Settings screenshot · Skipped (dev only)</Text>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.sendBtn,
                  pressed && styles.sendBtnPressed,
                  submitBusy && styles.sendBtnDisabled,
                ]}
                onPress={() => void onConfirmAccept()}
                disabled={submitBusy}
              >
                {submitBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.sendBtnTxt}>Accept &amp; start match</Text>
                )}
              </Pressable>
            </>
          ) : null}

          <View style={[styles.navFooter, isWide && styles.navFooterWide]}>
            {step > 0 && !(rematchAcceptLocked && step === 2) ? (
              <Pressable style={styles.secondaryBtnNav} onPress={goBackStep}>
                <Text style={styles.secondaryBtnTxt}>Back</Text>
              </Pressable>
            ) : null}
            {step < STEPS - 1 ? (
              <Pressable
                style={[styles.primaryBtnFull, !canContinue && styles.primaryBtnDisabled]}
                onPress={goNext}
                disabled={!canContinue}
              >
                <Text style={styles.primaryBtnTxt}>Continue</Text>
              </Pressable>
            ) : null}
          </View>
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
      </View>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.surface, width: '100%' },
  scroll: { flex: 1, minHeight: 0, width: '100%' },
  headerCancelPress: { paddingHorizontal: 8, paddingVertical: 4 },
  headerCancelTxt: { color: '#fff', fontSize: 16, fontWeight: '600' },
  stepProg: { fontSize: 11, fontWeight: '600', color: colors.sage, marginBottom: 4 },
  stepHead: { fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 14 },
  body: { fontSize: 14, color: colors.muted, lineHeight: 21, marginBottom: 10 },
  bodyStrong: { fontWeight: '700', color: colors.ink },
  rematchNotice: {
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: colors.accentSoft,
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
  },
  rematchNoticeTxt: { fontSize: 13, color: colors.ink, lineHeight: 20, fontWeight: '500' },
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
  summaryBlock: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  summaryLine: { fontSize: 14, color: colors.ink, marginBottom: 8, lineHeight: 20 },
  summaryLineLast: { marginBottom: 0 },
  summaryLbl: { fontWeight: '700', color: colors.subtle },
  challengerShotTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.subtle,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  challengerShotPanel: {
    width: '100%',
    minHeight: 288,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengerShotImage: {
    width: '100%',
    height: 280,
    backgroundColor: colors.bg,
  },
  challengerShotPlaceholder: {
    fontSize: 14,
    color: colors.muted,
    lineHeight: 21,
    textAlign: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
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
  navFooter: { marginTop: 22, gap: 10, width: '100%', alignSelf: 'stretch' },
  navFooterWide: { maxWidth: 480, alignSelf: 'center' },
  primaryBtnFull: {
    width: '100%',
    backgroundColor: colors.header,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  secondaryBtnNav: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.sage,
    backgroundColor: colors.accentSoft,
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
  modalTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: colors.ink },
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
