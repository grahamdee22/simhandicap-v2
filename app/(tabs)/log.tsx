import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, ScrollView as RNScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pressable, ScrollView as GHScrollView } from 'react-native-gesture-handler';

/** RN scroll on web (RNGH scroll + web can swallow taps); RNGH scroll on native (works with GH Pressable under root). */
const LogScrollView = Platform.OS === 'web' ? RNScrollView : GHScrollView;
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentWidth } from '../../src/components/ContentWidth';
import { IconCheckmark } from '../../src/components/SvgUiIcons';
import { DatePlayedField } from '../../src/components/DatePlayedField';
import { PLATFORMS, colors, type PlatformId } from '../../src/lib/constants';
import { useResponsive } from '../../src/lib/responsive';
import {
  adjustedDifferential,
  difficultyProduct,
  grossFromHoles,
  round1,
  type Mulligans,
  type PinDay,
  type PuttingMode,
  type Wind,
} from '../../src/lib/handicap';
import { isoToLocalYmd, localYmdToIso, todayLocalYmd } from '../../src/lib/dates';
import { showAppAlert } from '../../src/lib/alertCompat';
import {
  COURSE_SEEDS,
  courseMatchesSearch,
  CUSTOM_TEE_ID,
  getCourseById,
  getCourseTees,
  middleCourseTee,
  ratingForCourse,
} from '../../src/lib/courses';
import {
  difficultyConditionsLabel,
  expectedDifferentialFromIndex,
  targetGrossToImprove,
} from '../../src/lib/preRoundPrediction';
import { currentIndexFromRounds, useAppStore, type SimRound } from '../../src/store/useAppStore';

type H2hOpponentPick = {
  groupId: string;
  groupName: string;
  memberId: string;
  memberName: string;
};

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

const emptyHoles = (): (number | null)[] => Array(18).fill(null);

/** Set true to log gross resolution in dev tools when saving a round. */
const DEBUG_LOG_GROSS_SAVE = false;

/** Parse digits from score field text (what the user sees). */
function parseGrossFromBuffer(scoreBuffer: string): number | null {
  const digits = scoreBuffer.replace(/\D/g, '').slice(0, 3);
  if (digits === '') return null;
  const n = parseInt(digits, 10);
  if (Number.isNaN(n)) return null;
  return Math.min(125, Math.max(55, n));
}

/** Gross used for preview + save: full hole card wins; else live TextInput buffer while focused; else stepper state. */
function resolveLogGrossScore(
  holeScores: (number | null)[],
  scoreFocused: boolean,
  scoreBuffer: string,
  grossScore: number
): number {
  const fromHoles = grossFromHoles(holeScores);
  if (fromHoles != null) return fromHoles;
  if (scoreFocused) {
    const digits = scoreBuffer.replace(/\D/g, '').slice(0, 3);
    if (digits !== '') {
      const n = parseInt(digits, 10);
      if (!Number.isNaN(n)) return Math.min(125, Math.max(55, n));
    }
  }
  return grossScore;
}

/** Gross for persist: full card wins; else prefer last user edit (typed vs stepper) so save isn’t one frame behind blur/focus. */
function grossToPersistForLog(
  hs: (number | null)[],
  bufferStr: string,
  stepper: number,
  stateGross: number,
  lastSource: 'type' | 'step'
): number {
  const fromCard = grossFromHoles(hs);
  if (fromCard != null) return fromCard;
  const fromBuf = parseGrossFromBuffer(bufferStr);
  if (lastSource === 'step') {
    return stepper ?? fromBuf ?? stateGross;
  }
  return fromBuf ?? stepper ?? stateGross;
}

export default function LogRoundScreen() {
  const { gutter, isWide, isVeryWide } = useResponsive();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ editId?: string }>();
  const editId =
    typeof params.editId === 'string' && params.editId.length > 0 ? params.editId : undefined;

  const addRound = useAppStore((s) => s.addRound);
  const updateRound = useAppStore((s) => s.updateRound);
  const rounds = useAppStore((s) => s.rounds);
  const groups = useAppStore((s) => s.groups);
  const pendingH2hMatchup = useAppStore((s) => s.pendingH2hMatchup);
  const setPendingH2hMatchup = useAppStore((s) => s.setPendingH2hMatchup);
  const preferredLogPlatform = useAppStore((s) => s.preferredLogPlatform);
  const existing = editId ? rounds.find((r) => r.id === editId) : undefined;

  const [platform, setPlatform] = useState<PlatformId>(preferredLogPlatform);
  const [courseId, setCourseId] = useState('pebble');
  const [grossScore, setGrossScore] = useState(72);
  const [holesExpanded, setHolesExpanded] = useState(false);
  const [holeScores, setHoleScores] = useState<(number | null)[]>(emptyHoles);
  const [putting, setPutting] = useState<PuttingMode>('auto_2putt');
  const [pin, setPin] = useState<PinDay>('thu');
  const [wind, setWind] = useState<Wind>('off');
  const [mulligans, setMulligans] = useState<Mulligans>('off');
  const [teePickKey, setTeePickKey] = useState('White');
  const [customRating, setCustomRating] = useState('');
  const [customSlope, setCustomSlope] = useState('');
  const [h2hOpponentPick, setH2hOpponentPick] = useState<H2hOpponentPick | null>(null);
  const [h2hModalOpen, setH2hModalOpen] = useState(false);
  const [platOpen, setPlatOpen] = useState(false);
  const [courseOpen, setCourseOpen] = useState(false);
  const [courseSearchQuery, setCourseSearchQuery] = useState('');
  const [playedDate, setPlayedDate] = useState(todayLocalYmd);
  const [scoreFocused, setScoreFocused] = useState(false);
  const scoreFocusedRef = useRef(false);
  const [scoreEditSession, setScoreEditSession] = useState(0);
  /** Seed for the uncontrolled score field while focused (avoids controlled-input one-keystroke lag). */
  const grossSeedForEditRef = useRef('72');
  const [scoreBuffer, setScoreBuffer] = useState('');
  /** Mirrors scoreBuffer on each keystroke so Save always sees the literal field text (state can lag one frame). */
  const scoreBufferRef = useRef('');
  /** Stepper / committed gross when not using buffer parse. */
  const stepperGrossRef = useRef(72);
  /** Real input node: on web, `.value` backup read at save. */
  const grossScoreInputRef = useRef<TextInput | null>(null);
  /** Last change to manual gross: typing vs +/- (avoids wrong branch if save runs before blur updates focus flags). */
  const lastGrossSourceRef = useRef<'type' | 'step'>('step');
  /** Latest form fields for save (RNGH / deferred save must not read stale render closures). */
  const latestSaveRef = useRef<{
    holeScores: (number | null)[];
    grossScore: number;
    playedDate: string;
    courseId: string;
    platform: PlatformId;
    putting: PuttingMode;
    pin: PinDay;
    wind: Wind;
    mulligans: Mulligans;
    course: ReturnType<typeof getCourseById>;
    existing: SimRound | undefined;
    h2hOpponentPick: H2hOpponentPick | null;
    teePickKey: string;
    customRating: string;
    customSlope: string;
  } | null>(null);

  const resetLogForm = useCallback(() => {
    setPlatform(preferredLogPlatform);
    setCourseId('pebble');
    setGrossScore(72);
    stepperGrossRef.current = 72;
    scoreFocusedRef.current = false;
    setScoreFocused(false);
    setScoreBuffer('');
    scoreBufferRef.current = '';
    setScoreEditSession(0);
    lastGrossSourceRef.current = 'step';
    setHolesExpanded(false);
    setHoleScores(emptyHoles());
    setPutting('auto_2putt');
    setPin('thu');
    setWind('off');
    setMulligans('off');
    setH2hOpponentPick(null);
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
  }, [preferredLogPlatform]);

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
    setMulligans(p.mulligans);
    if (p.h2hGroupId && p.h2hOpponentMemberId) {
      setH2hOpponentPick({
        groupId: p.h2hGroupId,
        groupName: groups.find((g) => g.id === p.h2hGroupId)?.name ?? 'Crew',
        memberId: p.h2hOpponentMemberId,
        memberName: p.h2hOpponentDisplayName ?? 'Friend',
      });
    }
    setPendingH2hMatchup(null);
  }, [editId, pendingH2hMatchup, groups, setPendingH2hMatchup]);

  useEffect(() => {
    if (!existing) return;
    setPlatform(existing.platform);
    setCourseId(existing.courseId);
    setGrossScore(existing.grossScore);
    setPutting(existing.putting);
    setPin(existing.pin);
    setWind(existing.wind);
    setMulligans(existing.mulligans);
    setH2hOpponentPick(
      existing.h2hGroupId && existing.h2hOpponentMemberId
        ? {
            groupId: existing.h2hGroupId,
            groupName:
              groups.find((g) => g.id === existing.h2hGroupId)?.name ?? 'Crew',
            memberId: existing.h2hOpponentMemberId,
            memberName: existing.h2hOpponentDisplayName ?? 'Friend',
          }
        : null
    );
    setPlayedDate(isoToLocalYmd(existing.playedAt));
    const hs = [...existing.holeScores];
    while (hs.length < 18) hs.push(null);
    setHoleScores(hs);
    setHolesExpanded(existing.holeScores.some((h) => h != null));
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
    const cardG = grossFromHoles(hs);
    const g0 = cardG != null ? cardG : existing.grossScore;
    stepperGrossRef.current = g0;
    scoreFocusedRef.current = false;
    setScoreFocused(false);
    lastGrossSourceRef.current = 'step';
    const s0 = String(g0);
    setScoreBuffer(s0);
    scoreBufferRef.current = s0;
  }, [existing, groups]);

  useEffect(() => {
    if (courseOpen) setCourseSearchQuery('');
  }, [courseOpen]);

  /** New round only: keep tee aligned with the selected course / platform. (Edit mode sets tee from the saved round.) */
  useEffect(() => {
    if (editId) return;
    const c = getCourseById(courseId);
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
  }, [courseId, platform, editId]);

  const course = getCourseById(courseId);
  const courseTees = useMemo(() => (course ? getCourseTees(course, platform) : []), [course, platform]);

  const resolvedTeeRating = useMemo(() => {
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
        return { rating: round1(r), slope: Math.round(s), teeLabel: 'Custom' };
      }
      const fb = ratingForCourse(course, platform);
      return { rating: fb.rating, slope: fb.slope, teeLabel: 'Custom' };
    }
    const row = courseTees.find((t) => t.name === teePickKey);
    if (row) return { rating: row.rating, slope: row.slope, teeLabel: row.name };
    const fb = ratingForCourse(course, platform);
    return { rating: fb.rating, slope: fb.slope, teeLabel: course.defaultTee ?? 'Default' };
  }, [course, platform, teePickKey, customRating, customSlope, courseTees]);
  const showTeeSelector = course?.confident !== false;

  const coursesForPicker = useMemo(
    () =>
      COURSE_SEEDS.filter((c) => courseMatchesSearch(c, courseSearchQuery)).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    [courseSearchQuery]
  );
  const { rating, slope } = course
    ? { rating: resolvedTeeRating.rating, slope: resolvedTeeRating.slope }
    : { rating: 72, slope: 130 };

  const effectiveGross = useMemo(
    () => resolveLogGrossScore(holeScores, scoreFocused, scoreBuffer, grossScore),
    [holeScores, scoreFocused, scoreBuffer, grossScore]
  );

  const preview = useMemo(() => {
    return adjustedDifferential(effectiveGross, rating, slope, putting, pin, wind, mulligans);
  }, [effectiveGross, rating, slope, putting, pin, wind, mulligans]);

  const modifier = difficultyProduct(putting, pin, wind, mulligans);
  const modPct = Math.min(100, Math.max(0, ((modifier - 0.5) / 0.5) * 100));

  const simIndexCurrent = useMemo(() => currentIndexFromRounds(rounds), [rounds]);
  const expectedDiffPre = useMemo(() => {
    if (simIndexCurrent == null) return null;
    const e = expectedDifferentialFromIndex(simIndexCurrent, modifier);
    return Number.isFinite(e) ? e : null;
  }, [simIndexCurrent, modifier]);
  const targetGrossPre = useMemo(() => {
    if (simIndexCurrent == null || !course) return null;
    const t = targetGrossToImprove(simIndexCurrent, rating, slope, modifier);
    return Number.isFinite(t) ? t : null;
  }, [simIndexCurrent, course, rating, slope, modifier]);

  const setHole = useCallback((i: number, text: string) => {
    const t = text.replace(/[^0-9]/g, '');
    const v = t === '' ? null : Math.min(15, Math.max(1, parseInt(t, 10)));
    setHoleScores((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
  }, []);

  const front = holeScores.slice(0, 9);
  const back = holeScores.slice(9, 18);
  const sum = (arr: (number | null)[]) => arr.reduce<number>((s, h) => s + (h ?? 0), 0);
  const filledAll = grossFromHoles(holeScores) != null;
  const displayGross = effectiveGross;

  const commitScoreFieldBlur = useCallback((raw: string) => {
    lastGrossSourceRef.current = 'type';
    const digits = String(raw).replace(/\D/g, '').slice(0, 3);
    scoreBufferRef.current = digits;
    setScoreBuffer(digits);
    const n = parseInt(digits, 10);
    if (digits === '' || Number.isNaN(n)) {
      setGrossScore((g) => {
        stepperGrossRef.current = g;
        return g;
      });
    } else {
      const ng = Math.min(125, Math.max(55, n));
      stepperGrossRef.current = ng;
      setGrossScore(ng);
    }
  }, []);

  useEffect(() => {
    if (!scoreFocused) {
      const s = String(effectiveGross);
      setScoreBuffer(s);
      scoreBufferRef.current = s;
    }
  }, [effectiveGross, scoreFocused]);

  latestSaveRef.current = {
    holeScores,
    grossScore,
    playedDate,
    courseId,
    platform,
    putting,
    pin,
    wind,
    mulligans,
    course,
    existing,
    h2hOpponentPick,
    teePickKey,
    customRating,
    customSlope,
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

      if (Platform.OS === 'web') {
        const el = grossScoreInputRef.current as unknown as HTMLInputElement | null;
        if (el != null && typeof el.value === 'string') {
          const digits = el.value.replace(/\D/g, '').slice(0, 3);
          scoreBufferRef.current = digits;
          const n = parseInt(digits, 10);
          if (digits !== '' && !Number.isNaN(n)) {
            stepperGrossRef.current = Math.min(125, Math.max(55, n));
          }
        }
      }

      const hs = [...snap.holeScores];
      while (hs.length < 18) hs.push(null);
      const playedAt = localYmdToIso(snap.playedDate);
      const grossToSave = grossToPersistForLog(
        hs,
        scoreBufferRef.current,
        stepperGrossRef.current,
        snap.grossScore,
        lastGrossSourceRef.current
      );

      let teeNameSave = snap.course.defaultTee ?? 'Default';
      let courseRatingSave: number;
      let slopeSave: number;
      if (snap.course.confident === false) {
        const mid = middleCourseTee(snap.course, snap.platform);
        if (!mid) {
          showAppAlert('Tee', 'This course has no tee data.');
          return;
        }
        courseRatingSave = mid.rating;
        slopeSave = mid.slope;
        teeNameSave = mid.name;
      } else if (snap.teePickKey === CUSTOM_TEE_ID) {
        const r = parseFloat(snap.customRating.replace(/,/g, '.').trim());
        const s = parseFloat(snap.customSlope.replace(/,/g, '.').trim());
        if (!Number.isFinite(r) || !Number.isFinite(s) || s < 55 || s > 155 || r < 60 || r > 85) {
          showAppAlert(
            'Custom tee',
            'Enter a valid course rating and slope (rating about 60–85, slope 55–155).'
          );
          return;
        }
        courseRatingSave = round1(r);
        slopeSave = Math.round(s);
        teeNameSave = 'Custom';
      } else {
        const tees = getCourseTees(snap.course, snap.platform);
        const row = tees.find((t) => t.name === snap.teePickKey);
        if (!row) {
          showAppAlert('Tee', 'Pick a tee from the list, or choose Custom and enter rating and slope.');
          return;
        }
        courseRatingSave = row.rating;
        slopeSave = row.slope;
        teeNameSave = row.name;
      }

      if (__DEV__ && DEBUG_LOG_GROSS_SAVE) {
        // eslint-disable-next-line no-console
        console.log('[simhandicap log save]', {
          platform: Platform.OS,
          scoreFocusedRef: scoreFocusedRef.current,
          lastSource: lastGrossSourceRef.current,
          buffer: scoreBufferRef.current,
          stepper: stepperGrossRef.current,
          stateGross: snap.grossScore,
          fromCard: grossFromHoles(hs),
          grossToSave,
        });
      }
      const base = {
        courseId: snap.courseId,
        courseName: snap.course.name,
        platform: snap.platform,
        grossScore: grossToSave,
        holeScores: hs,
        putting: snap.putting,
        pin: snap.pin,
        wind: snap.wind,
        mulligans: snap.mulligans,
        playedAt,
        teeName: teeNameSave,
        courseRating: courseRatingSave,
        slope: slopeSave,
        ...(snap.h2hOpponentPick
          ? {
              h2hGroupId: snap.h2hOpponentPick.groupId,
              h2hOpponentMemberId: snap.h2hOpponentPick.memberId,
              h2hOpponentDisplayName: snap.h2hOpponentPick.memberName,
            }
          : snap.existing
            ? {
                h2hGroupId: undefined,
                h2hOpponentMemberId: undefined,
                h2hOpponentDisplayName: undefined,
              }
            : {}),
      };
      try {
        if (snap.existing) {
          await updateRound(snap.existing.id, base);
          resetLogForm();
        } else {
          await addRound(base);
          resetLogForm();
        }
        router.replace('/(tabs)/analyze');
      } catch (e) {
        showAppAlert('Could not save', String(e));
      }
    };

    if (scoreFocusedRef.current) {
      grossScoreInputRef.current?.blur();
      setTimeout(() => void finishSave(), 48);
      return;
    }

    void finishSave();
  };

  const pars = course?.pars ?? [];

  return (
    <ContentWidth bg={colors.surface}>
      <>
      <View style={styles.root}>
        <LogScrollView
          style={styles.scroll}
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingTop: Math.max(gutter, 14),
            paddingBottom: insets.bottom + 100,
          }}
          keyboardShouldPersistTaps="always"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
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
                <Text style={styles.pillVal}>{course?.name ?? 'Select'}</Text>
                <Text style={styles.chev}>▾</Text>
              </Pressable>
            </View>
          </View>

          <DatePlayedField value={playedDate} onChange={setPlayedDate} />

          {course && showTeeSelector ? (
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
                  <Text style={[styles.teeChipTxt, teePickKey === CUSTOM_TEE_ID && styles.teeChipTxtOn]}>Custom</Text>
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
          ) : null}

        <Text style={styles.sectionLabel}>Score</Text>
        <View style={styles.scoreBlock}>
          <View style={styles.scoreMain}>
            <Pressable
              style={[styles.scoreBtn, (filledAll || scoreFocused) && styles.scoreBtnDisabled]}
              disabled={filledAll || scoreFocused}
              onPress={() => {
                lastGrossSourceRef.current = 'step';
                setGrossScore((g) => {
                  const ng = Math.max(55, g - 1);
                  stepperGrossRef.current = ng;
                  if (!scoreFocusedRef.current) scoreBufferRef.current = String(ng);
                  return ng;
                });
              }}
            >
              <Text style={styles.scoreBtnTxt}>−</Text>
            </Pressable>
            {filledAll ? (
              <View style={[styles.scoreInput, styles.scoreInputStatic]} accessibilityLabel="Gross score from hole by hole">
                <Text style={styles.scoreInputStaticTxt}>{String(displayGross)}</Text>
              </View>
            ) : !scoreFocused ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit gross score"
                onPress={() => {
                  const seed = String(displayGross);
                  grossSeedForEditRef.current = seed;
                  scoreBufferRef.current = seed;
                  setScoreBuffer(seed);
                  scoreFocusedRef.current = true;
                  setScoreFocused(true);
                  setScoreEditSession((s) => s + 1);
                }}
                style={[styles.scoreInput, styles.scoreInputStatic]}
              >
                <Text style={styles.scoreInputStaticTxt}>{String(displayGross)}</Text>
              </Pressable>
            ) : (
              <TextInput
                key={`gross-e-${scoreEditSession}`}
                ref={grossScoreInputRef}
                style={styles.scoreInput}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={3}
                selectTextOnFocus
                autoFocus
                defaultValue={grossSeedForEditRef.current}
                onEndEditing={(e) => {
                  const raw = e.nativeEvent.text ?? '';
                  commitScoreFieldBlur(raw);
                }}
                onChangeText={(t) => {
                  lastGrossSourceRef.current = 'type';
                  const digits = t.replace(/\D/g, '').slice(0, 3);
                  scoreBufferRef.current = digits;
                  setScoreBuffer(digits);
                  const n = parseInt(digits, 10);
                  if (digits !== '' && !Number.isNaN(n)) {
                    const ng = Math.min(125, Math.max(55, n));
                    stepperGrossRef.current = ng;
                    setGrossScore(ng);
                  }
                }}
                onBlur={(e) => {
                  scoreFocusedRef.current = false;
                  setScoreFocused(false);
                  const ev = e.nativeEvent as { text?: string };
                  const raw = typeof ev.text === 'string' ? ev.text : scoreBufferRef.current;
                  commitScoreFieldBlur(raw);
                }}
              />
            )}
            <Pressable
              style={[styles.scoreBtn, (filledAll || scoreFocused) && styles.scoreBtnDisabled]}
              disabled={filledAll || scoreFocused}
              onPress={() => {
                lastGrossSourceRef.current = 'step';
                setGrossScore((g) => {
                  const ng = Math.min(125, g + 1);
                  stepperGrossRef.current = ng;
                  if (!scoreFocusedRef.current) scoreBufferRef.current = String(ng);
                  return ng;
                });
              }}
            >
              <Text style={styles.scoreBtnTxt}>+</Text>
            </Pressable>
          </View>
          <Pressable style={styles.scoreExpand} onPress={() => setHolesExpanded((e) => !e)}>
            <Text style={styles.scoreExpandLbl}>Add hole-by-hole scores (optional)</Text>
            <Text style={styles.chev}>{holesExpanded ? '▴' : '▾'}</Text>
          </Pressable>
        </View>

        {holesExpanded ? (
          <View style={styles.holesWrap}>
            <Text style={styles.holeHint}>
              All 18 holes filled → that total is what we save as gross (overrides the score above). Partial scores → the
              stepper / score field is used.
            </Text>
            {isWide ? (
              <View style={styles.holeGrid}>
                {holeScores.map((h, i) => {
                  const par = pars[i] ?? 4;
                  return (
                    <View
                      key={i}
                      style={[styles.holeCell, isVeryWide && styles.holeCellLg]}
                    >
                      <Text style={styles.holeNum}>H{i + 1}</Text>
                      <Text style={styles.holePar}>P{par}</Text>
                      <TextInput
                        style={[styles.holeInput, isVeryWide && styles.holeInputLg]}
                        keyboardType="number-pad"
                        maxLength={2}
                        value={h == null ? '' : String(h)}
                        onChangeText={(t) => setHole(i, t)}
                        placeholder="—"
                      />
                    </View>
                  );
                })}
              </View>
            ) : (
              <RNScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.holeScroll}>
                {holeScores.map((h, i) => {
                  const par = pars[i] ?? 4;
                  return (
                    <View key={i} style={styles.holeCell}>
                      <Text style={styles.holeNum}>H{i + 1}</Text>
                      <Text style={styles.holePar}>P{par}</Text>
                      <TextInput
                        style={styles.holeInput}
                        keyboardType="number-pad"
                        maxLength={2}
                        value={h == null ? '' : String(h)}
                        onChangeText={(t) => setHole(i, t)}
                        placeholder="—"
                      />
                    </View>
                  );
                })}
              </RNScrollView>
            )}
            <View style={styles.totals}>
              <Text style={styles.totTxt}>Out {sum(front) || '—'}</Text>
              <Text style={styles.totTxt}>In {sum(back) || '—'}</Text>
              <Text style={styles.totTxtStrong}>Tot {sum(holeScores) || '—'}</Text>
            </View>
          </View>
        ) : null}

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
            <Pressable key={d.key} style={[styles.dayBtn, pin === d.key && styles.dayBtnOn]} onPress={() => setPin(d.key)}>
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

        <Text style={styles.sectionLabel}>Head-to-head (optional)</Text>
        <Text style={styles.h2hHint}>
          Was this round a match against someone in your crew? Pick them to show it under Recent head-to-head on
          Social. Leave as solo if you played alone.
        </Text>
        <Pressable
          style={[styles.pill, h2hModalOpen && styles.pillActive]}
          onPress={() => setH2hModalOpen(true)}
        >
          <Text style={styles.pillVal} numberOfLines={2}>
            {h2hOpponentPick
              ? `vs ${h2hOpponentPick.memberName} · ${h2hOpponentPick.groupName}`
              : 'Solo round — not vs a crewmate'}
          </Text>
          <Text style={styles.chev}>▾</Text>
        </Pressable>
        {groups.every((gr) => gr.members.filter((m) => !m.isYou).length === 0) ? (
          <Text style={styles.h2hHintMuted}>
            Add friends in the Social tab (invite or join a crew) to tag an opponent here.
          </Text>
        ) : null}

        <View style={styles.diffWrap}>
          <View style={styles.diffTop}>
            <Text style={styles.diffLbl}>Difficulty modifier</Text>
            <Text style={styles.diffNum}>{modifier.toFixed(2)}</Text>
          </View>
          <View style={styles.diffTrack}>
            <View style={[styles.diffFill, { width: `${modPct}%` }]} />
          </View>
          <Text style={styles.diffLive}>
            Raw diff {preview.raw.toFixed(1)} × modifier {modifier.toFixed(2)} →{' '}
            <Text style={styles.diffStrong}>{preview.adjusted.toFixed(1)}</Text> adjusted
          </Text>
        </View>

        {course ? (
          <View style={styles.predCard}>
            {expectedDiffPre != null ? (
              <>
                <Text style={styles.predExpectedLine}>
                  <Text style={styles.predExpectedLbl}>Expected differential: </Text>
                  <Text style={styles.predExpectedNum}>{expectedDiffPre.toFixed(1)}</Text>
                </Text>
                {targetGrossPre != null && targetGrossPre >= 55 && targetGrossPre <= 125 ? (
                  <Text style={styles.predTarget}>
                    Shoot {targetGrossPre} or better to improve your index
                  </Text>
                ) : (
                  <Text style={styles.predTargetSoft}>
                    For these conditions, your index benchmark sits outside the usual gross range (55–125). Every stroke
                    still feeds your rolling differentials.
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.predNoIndex}>
                Log at least one round to see your expected differential and a target gross for these conditions.
              </Text>
            )}
            <Text style={styles.predDifficulty}>
              <Text style={styles.predDifficultyLbl}>{difficultyConditionsLabel(modifier)}</Text>
              <Text style={styles.predDifficultySep}> · </Text>
              <Text style={styles.predDifficultyMod}>{modifier.toFixed(2)} modifier</Text>
            </Text>
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
          Saves to this device, opens Round analysis, and updates your sim index, home chart, and profile.
        </Text>
        </LogScrollView>
      </View>

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
        visible={h2hModalOpen}
        animationType={Platform.OS === 'web' ? 'none' : 'fade'}
        transparent
        onRequestClose={() => setH2hModalOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdropPress} onPress={() => setH2hModalOpen(false)} />
          <View style={[styles.modalSheet, styles.modalSheetTall, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.modalTitle}>Head-to-head</Text>
            <RNScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              <Pressable
                style={styles.modalRow}
                onPress={() => {
                  setH2hOpponentPick(null);
                  setH2hModalOpen(false);
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalRowTxt}>Solo round</Text>
                  <Text style={styles.modalRowSub}>Not playing vs a crewmate</Text>
                </View>
                {!h2hOpponentPick ? <IconCheckmark size={18} color={colors.accent} /> : null}
              </Pressable>
              {groups.map((gr) => {
                const others = gr.members.filter((m) => !m.isYou);
                if (others.length === 0) return null;
                return (
                  <View key={gr.id}>
                    <Text style={styles.modalGroupHdr}>{gr.name}</Text>
                    {others.map((m) => {
                      const label = m.displayName.replace(/\s*\(you\)\s*$/i, '').trim();
                      const selected =
                        h2hOpponentPick?.groupId === gr.id && h2hOpponentPick?.memberId === m.id;
                      return (
                        <Pressable
                          key={m.id}
                          style={styles.modalRow}
                          onPress={() => {
                            setH2hOpponentPick({
                              groupId: gr.id,
                              groupName: gr.name,
                              memberId: m.id,
                              memberName: label,
                            });
                            setH2hModalOpen(false);
                          }}
                        >
                          <Text style={styles.modalRowTxt}>{label}</Text>
                          {selected ? <IconCheckmark size={18} color={colors.accent} /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </RNScrollView>
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
              clearButtonMode="while-editing"
            />
            <RNScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
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
            </RNScrollView>
          </View>
        </View>
      </Modal>
    </>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.surface, width: '100%' },
  scroll: { flex: 1, minHeight: 0, width: '100%' },
  pickRow: { flexDirection: 'row', gap: 12, width: '100%' },
  pickCol: { flex: 1, minWidth: 0 },
  holeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    rowGap: 10,
    justifyContent: 'flex-start',
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.subtle,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 5,
    marginTop: 10,
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
  scoreBtnDisabled: { opacity: 0.35 },
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
  scoreExpand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
  },
  scoreExpandLbl: { fontSize: 11, color: colors.accent, fontWeight: '600' },
  holesWrap: { marginTop: 8 },
  holeHint: { fontSize: 10, color: colors.muted, marginBottom: 6 },
  holeScroll: { flexGrow: 0 },
  holeCell: { width: 44, marginRight: 6, alignItems: 'center' },
  holeCellLg: { width: '15.5%', minWidth: 52, maxWidth: 72, marginRight: 0 },
  holeNum: { fontSize: 9, color: colors.subtle },
  holePar: { fontSize: 8, color: colors.subtle, marginBottom: 2 },
  holeInput: {
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 6,
    width: 40,
    height: 32,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  holeInputLg: { width: '100%', minWidth: 40, height: 36, fontSize: 15 },
  totals: { flexDirection: 'row', gap: 12, marginTop: 8 },
  totTxt: { fontSize: 11, color: colors.muted },
  totTxtStrong: { fontSize: 11, fontWeight: '600', color: colors.ink },
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
  diffWrap: { backgroundColor: colors.bg, borderRadius: 9, padding: 10, marginTop: 12 },
  diffTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  diffLbl: { fontSize: 11, color: colors.muted },
  diffNum: { fontSize: 16, fontWeight: '600', color: colors.ink },
  diffTrack: { height: 5, borderRadius: 99, backgroundColor: colors.pillBorder, marginTop: 6, overflow: 'hidden' },
  diffFill: { height: 5, borderRadius: 99, backgroundColor: colors.accent },
  diffLive: { fontSize: 11, color: colors.muted, marginTop: 6, lineHeight: 15 },
  diffStrong: { fontWeight: '700', color: colors.ink },
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
  predExpectedLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' },
  predExpectedLbl: { fontSize: 15, fontWeight: '600', color: '#1a3d2b' },
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
  predDifficulty: { marginTop: 12, fontSize: 13, lineHeight: 20 },
  predDifficultyLbl: { fontWeight: '600', color: '#1a3d2b' },
  predDifficultySep: { color: '#5a6b62' },
  predDifficultyMod: { fontWeight: '700', color: '#52b788' },
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
  modalRowSub: { fontSize: 12, color: colors.subtle, marginTop: 2 },
  modalGroupHdr: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.subtle,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 4,
  },
  h2hHint: { fontSize: 11, color: colors.muted, lineHeight: 15, marginBottom: 6 },
  h2hHintMuted: { fontSize: 10, color: colors.subtle, marginTop: 6, lineHeight: 14 },
});
