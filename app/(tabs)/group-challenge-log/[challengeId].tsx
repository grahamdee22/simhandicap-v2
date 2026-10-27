import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
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
import { HeaderBackButton } from '../../../src/components/HeaderBackButton';
import { useTranslation } from '../../../src/i18n';
import { showAppAlert } from '../../../src/lib/alertCompat';
import {
  fetchCommunityCoursesForPicker,
  resolveLogCourse,
  type CommunityCourseRow,
  type ResolvedLogCourse,
} from '../../../src/lib/communityCourses';
import { colors } from '../../../src/lib/constants';
import { getCourseById, type CourseTee } from '../../../src/lib/courses';
import { fetchCustomCoursesForPicker, type CustomCourseRow } from '../../../src/lib/customCourses';
import { localYmdToIso, todayLocalYmd } from '../../../src/lib/dates';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import {
  canSubmitChallengeRound,
  fetchGroupChallengeBundle,
  netScoreForGroupChallengeRound,
  submitGroupChallengeRound,
  type GroupChallengeBundle,
} from '../../../src/lib/groupChallenges';
import { friendlyChallengeError } from '../../../src/lib/groupChallengeGroupNames';
import { uploadGroupChallengeScorecardScreenshot } from '../../../src/lib/groupChallengeScorecardStorage';
import {
  clampGrossScore,
  grossScoreBounds,
  isNineHolePlayed,
  ratingSlopeForHolesPlayed,
  type HolesPlayed,
} from '../../../src/lib/nineHoleRating';
import { useResponsive } from '../../../src/lib/responsive';
import { courseSnapshot } from '../../../src/lib/rounds';
import { settingsScreenshotPickerOptions } from '../../../src/lib/settingsScreenshotPicker';
import { resolveSocialGroupsAccessToken } from '../../../src/lib/socialGroups';
import { isSupabaseConfigured } from '../../../src/lib/supabase';
import { useAppStore } from '../../../src/store/useAppStore';

export default function GroupChallengeLogScreen() {
  const { t } = useTranslation();
  const { challengeId: rawId } = useLocalSearchParams<{ challengeId: string | string[] }>();
  const challengeId = typeof rawId === 'string' ? rawId : rawId?.[0] ?? '';
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user, session } = useAuth();
  const authUserId = session?.user?.id ?? user?.id ?? null;
  const addRound = useAppStore((s) => s.addRound);
  const platform = useAppStore((s) => s.preferredLogPlatform);

  const [bundle, setBundle] = useState<GroupChallengeBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [communityCourses, setCommunityCourses] = useState<CommunityCourseRow[]>([]);
  const [customCourses, setCustomCourses] = useState<CustomCourseRow[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [nineChoice, setNineChoice] = useState<'front' | 'back'>('front');
  const [teePick, setTeePick] = useState<string | null>(null);
  const [grossText, setGrossText] = useState('');
  const [evidenceUri, setEvidenceUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Reused on retry so a failed challenge insert never creates a duplicate logged round. */
  const savedRoundIdRef = useRef<string | null>(null);
  const submittedRef = useRef(false);

  const goToChallenge = useCallback(() => {
    router.replace(`/(tabs)/group-challenge/${challengeId}` as never);
  }, [router, challengeId]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <HeaderBackButton onPress={goToChallenge} accessibilityLabel={t('match.create.goBack')} />
      ),
    });
  }, [navigation, goToChallenge, t]);

  const load = useCallback(async () => {
    if (!challengeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const token = googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
    const res = await fetchGroupChallengeBundle(challengeId, token);
    setBundle(res.data);
    setLoading(false);
  }, [challengeId]);

  useFocusEffect(
    useCallback(() => {
      if (submittedRef.current) return;
      void load();
    }, [load])
  );

  const challenge = bundle?.challenge ?? null;

  // Community / custom courses are only needed when the course isn't a curated seed.
  const challengeCourseId = challenge?.course_id ?? null;
  useEffect(() => {
    if (!challengeCourseId || getCourseById(challengeCourseId)) return;
    let cancelled = false;
    setCoursesLoading(true);
    void (async () => {
      const token =
        googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
      const [community, custom] = await Promise.all([
        fetchCommunityCoursesForPicker(token),
        fetchCustomCoursesForPicker(token),
      ]);
      if (cancelled) return;
      setCommunityCourses(community);
      setCustomCourses(custom);
      setCoursesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [challengeCourseId]);

  const resolvedCourse: ResolvedLogCourse | null = useMemo(() => {
    if (!challenge) return null;
    return resolveLogCourse(challenge.course_id, platform, communityCourses, customCourses);
  }, [challenge, platform, communityCourses, customCourses]);

  const roster = useMemo(() => {
    if (!bundle || !authUserId) return null;
    return (
      bundle.rosters.find(
        (r) =>
          r.user_id === authUserId && !r.withdrawn_at && r.eligibility_status === 'eligible'
      ) ?? null
    );
  }, [bundle, authUserId]);

  const existingRound = useMemo(
    () => (roster ? bundle?.rounds.find((r) => r.roster_entry_id === roster.id) ?? null : null),
    [bundle?.rounds, roster]
  );

  const submitCheck = useMemo((): { ok: boolean; reason?: string } => {
    if (!challenge) return { ok: false };
    return canSubmitChallengeRound({
      challenge,
      roster,
      existingRound,
      todayYmd: todayLocalYmd(),
    });
  }, [challenge, roster, existingRound]);

  const holesPlayed: HolesPlayed =
    challenge?.holes_per_round === '9' ? nineChoice : '18';

  const lockedTeeName = challenge?.tee_name?.trim() || null;
  const lockedTee: CourseTee | null = useMemo(() => {
    if (!resolvedCourse || !lockedTeeName) return null;
    const needle = lockedTeeName.toLowerCase();
    return resolvedCourse.tees.find((tee) => tee.name.trim().toLowerCase() === needle) ?? null;
  }, [resolvedCourse, lockedTeeName]);

  const activeTee: CourseTee | null = useMemo(() => {
    if (!resolvedCourse) return null;
    if (lockedTeeName) return lockedTee;
    if (teePick) return resolvedCourse.tees.find((tee) => tee.name === teePick) ?? null;
    const def = resolvedCourse.seed?.defaultTee?.trim();
    if (def) {
      const hit = resolvedCourse.tees.find((tee) => tee.name === def);
      if (hit) return hit;
    }
    return resolvedCourse.tees[Math.floor(resolvedCourse.tees.length / 2)] ?? null;
  }, [resolvedCourse, lockedTeeName, lockedTee, teePick]);

  const ratingSlope = useMemo(
    () => (activeTee ? ratingSlopeForHolesPlayed(activeTee, holesPlayed) : null),
    [activeTee, holesPlayed]
  );

  const coursePar = useMemo(() => {
    if (!challenge) return null;
    const snap = courseSnapshot(challenge.course_id, holesPlayed).course_par;
    if (snap != null) return snap;
    if (activeTee?.par != null) {
      return isNineHolePlayed(holesPlayed) ? Math.round(activeTee.par / 2) : activeTee.par;
    }
    return null;
  }, [challenge, holesPlayed, activeTee]);

  const bounds = grossScoreBounds(holesPlayed);
  const grossParsed = parseInt(grossText.trim(), 10);
  const grossValid =
    Number.isFinite(grossParsed) && grossParsed >= bounds.min && grossParsed <= bounds.max;

  const netPreview = useMemo(() => {
    if (!grossValid || !roster || !ratingSlope) return null;
    return netScoreForGroupChallengeRound({
      gross: grossParsed,
      handicapSnapshot: roster.handicap_snapshot,
      courseRating: ratingSlope.rating,
      slope: ratingSlope.slope,
      coursePar,
      holesPlayed,
    });
  }, [grossValid, grossParsed, roster, ratingSlope, coursePar, holesPlayed]);

  const isVerifiedMode = challenge?.verification_mode === 'verified';

  const pickEvidence = async () => {
    let perm = await ImagePicker.getMediaLibraryPermissionsAsync(false);
    if (!perm.granted) perm = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
    if (!perm.granted) {
      showAppAlert(t('log.round.alerts.photosTitle'), t('log.round.alerts.photosBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync(settingsScreenshotPickerOptions());
    if (result.canceled || !result.assets[0]) return;
    setEvidenceUri(result.assets[0].uri);
  };

  const onSubmit = async () => {
    if (!challenge || !roster || !authUserId || submitting) return;
    Keyboard.dismiss();
    if (!submitCheck.ok) {
      showAppAlert(t('groupChallenge.cannotSubmit'), submitCheck.reason);
      return;
    }
    if (!resolvedCourse || !activeTee || !ratingSlope) {
      showAppAlert(t('groupChallenge.log.courseUnavailableTitle'), t('groupChallenge.log.courseUnavailableBody'));
      return;
    }
    if (!grossValid) {
      showAppAlert(
        t('groupChallenge.log.grossInvalidTitle'),
        t('groupChallenge.log.grossInvalidBody', { min: bounds.min, max: bounds.max })
      );
      return;
    }
    if (isVerifiedMode && !evidenceUri) {
      showAppAlert(
        t('groupChallenge.log.evidenceRequiredTitle'),
        t('groupChallenge.log.evidenceRequiredBody')
      );
      return;
    }
    if (!isSupabaseConfigured()) {
      showAppAlert(t('groupChallenge.errorTitle'), t('groupChallenge.log.offline'));
      return;
    }

    setSubmitting(true);
    try {
      const token = googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;

      let evidencePath: string | null = null;
      if (isVerifiedMode && evidenceUri) {
        const up = await uploadGroupChallengeScorecardScreenshot({
          challengeId: challenge.id,
          userId: authUserId,
          localUri: evidenceUri,
          accessToken: token,
        });
        if ('error' in up) {
          showAppAlert(t('groupChallenge.log.uploadFailedTitle'), up.error);
          return;
        }
        evidencePath = up.path;
      }

      const gross = clampGrossScore(grossParsed, holesPlayed);
      let roundId = savedRoundIdRef.current;
      let grossForChallenge = gross;
      if (!roundId) {
        const saved = await addRound({
          courseId: challenge.course_id,
          courseName: resolvedCourse.name,
          platform,
          grossScore: gross,
          holeScores: [],
          putting: 'auto_2putt',
          pin: 'thu',
          wind: 'off',
          // Group challenges prohibit mulligans — locked, not user-editable.
          mulligans: 'none',
          playedAt: localYmdToIso(todayLocalYmd()),
          teeName: activeTee.name,
          courseRating: ratingSlope.rating,
          slope: ratingSlope.slope,
          holesPlayed,
          nineHoleSource: ratingSlope.nineHoleSource ?? undefined,
          handicapSource: resolvedCourse.handicapSource,
          teeRatingSource: activeTee.ratingSource ?? 'curated',
          excludesFromSimcapIndex: false,
        });
        roundId = saved.id;
        grossForChallenge = saved.grossScore;
        savedRoundIdRef.current = saved.id;
      }

      const net = netScoreForGroupChallengeRound({
        gross: grossForChallenge,
        handicapSnapshot: roster.handicap_snapshot,
        courseRating: ratingSlope.rating,
        slope: ratingSlope.slope,
        coursePar,
        holesPlayed,
      });

      const res = await submitGroupChallengeRound({
        challengeId: challenge.id,
        rosterEntryId: roster.id,
        roundId,
        grossScore: grossForChallenge,
        netScore: net,
        courseRating: ratingSlope.rating,
        slope: ratingSlope.slope,
        coursePar,
        teeName: activeTee.name,
        evidencePath,
        verificationMode: challenge.verification_mode,
        accessToken: token,
      });
      if (res.error || !res.data) {
        showAppAlert(
          t('groupChallenge.log.submitFailedTitle'),
          friendlyChallengeError(res.error) || t('groupChallenge.log.submitFailedBody')
        );
        return;
      }

      submittedRef.current = true;
      savedRoundIdRef.current = null;
      showAppAlert(
        t('groupChallenge.log.successTitle'),
        isVerifiedMode
          ? t('groupChallenge.log.successBodyVerified', { net: net.toFixed(1) })
          : t('groupChallenge.log.successBodyCasual', { net: net.toFixed(1) }),
        { onOk: goToChallenge }
      );
    } catch (e) {
      showAppAlert(t('groupChallenge.log.submitFailedTitle'), String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !bundle) {
    return (
      <ContentWidth bg={colors.surface}>
        <ActivityIndicator color={colors.header} style={{ marginTop: 40 }} />
      </ContentWidth>
    );
  }

  if (!bundle || !challenge) {
    return (
      <ContentWidth bg={colors.surface}>
        <Text style={{ padding: gutter, color: colors.ink }}>{t('groupChallenge.notFound')}</Text>
      </ContentWidth>
    );
  }

  if (!submitCheck.ok) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={{ padding: gutter, gap: 12 }}>
          <Text style={styles.title}>{challenge.name}</Text>
          <Text style={styles.muted}>{submitCheck.reason ?? t('groupChallenge.cannotSubmit')}</Text>
          <Pressable style={styles.primaryBtn} onPress={goToChallenge} accessibilityRole="button">
            <Text style={styles.primaryBtnTxt}>{t('groupChallenge.log.backToChallenge')}</Text>
          </Pressable>
        </View>
      </ContentWidth>
    );
  }

  const courseLoadFailed = !coursesLoading && !resolvedCourse;
  const teeMissing = !!lockedTeeName && !!resolvedCourse && !lockedTee;
  const canPressSubmit =
    !submitting && !!resolvedCourse && !!activeTee && grossValid && (!isVerifiedMode || !!evidenceUri);

  return (
    <ContentWidth bg={colors.surface}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: 14,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <Text style={styles.title}>{challenge.name}</Text>
        <Text style={styles.muted}>
          {isVerifiedMode ? t('groupChallenge.mode.verifiedHelp') : t('groupChallenge.mode.casualHelp')}
        </Text>

        <View style={styles.card}>
          <Text style={styles.lockedLabel}>{t('groupChallenge.log.course')}</Text>
          {coursesLoading ? (
            <ActivityIndicator color={colors.header} style={{ alignSelf: 'flex-start' }} />
          ) : (
            <Text style={styles.lockedValue}>
              🔒 {resolvedCourse?.name ?? challenge.course_id}
            </Text>
          )}
          {courseLoadFailed ? (
            <Text style={styles.errorTxt}>{t('groupChallenge.log.courseUnavailableBody')}</Text>
          ) : null}

          <Text style={[styles.lockedLabel, { marginTop: 12 }]}>{t('groupChallenge.log.tee')}</Text>
          {lockedTeeName ? (
            <Text style={styles.lockedValue}>
              🔒 {lockedTeeName}
              {ratingSlope ? ` · ${ratingSlope.rating.toFixed(1)} / ${ratingSlope.slope}` : ''}
            </Text>
          ) : resolvedCourse && resolvedCourse.tees.length > 0 ? (
            <View style={styles.chipRow}>
              {resolvedCourse.tees.map((tee) => {
                const on = activeTee?.name === tee.name;
                return (
                  <Pressable
                    key={tee.name}
                    onPress={() => setTeePick(tee.name)}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{tee.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {teeMissing ? (
            <Text style={styles.errorTxt}>
              {t('groupChallenge.log.teeMissing', { tee: lockedTeeName })}
            </Text>
          ) : null}

          <Text style={[styles.lockedLabel, { marginTop: 12 }]}>{t('groupChallenge.log.holes')}</Text>
          {challenge.holes_per_round === '9' ? (
            <View style={styles.chipRow}>
              {(['front', 'back'] as const).map((h) => {
                const on = nineChoice === h;
                return (
                  <Pressable
                    key={h}
                    onPress={() => setNineChoice(h)}
                    style={[styles.chip, on && styles.chipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>
                      {h === 'front' ? t('groupChallenge.log.front9') : t('groupChallenge.log.back9')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={styles.lockedValue}>🔒 {t('groupChallenge.holes18')}</Text>
          )}

          <Text style={[styles.lockedLabel, { marginTop: 12 }]}>
            {t('groupChallenge.log.mulligans')}
          </Text>
          <Text style={styles.lockedValue}>🔒 {t('groupChallenge.log.mulligansNone')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.lockedLabel}>{t('groupChallenge.log.grossLabel')}</Text>
          <TextInput
            value={grossText}
            onChangeText={(v) => setGrossText(v.replace(/[^0-9]/g, '').slice(0, 3))}
            keyboardType="number-pad"
            placeholder={t('groupChallenge.log.grossPlaceholder', {
              min: bounds.min,
              max: bounds.max,
            })}
            placeholderTextColor={colors.subtle}
            style={styles.grossInput}
            returnKeyType="done"
            onSubmitEditing={() => Keyboard.dismiss()}
            accessibilityLabel={t('groupChallenge.log.grossLabel')}
          />
          {roster ? (
            <Text style={styles.muted}>
              {roster.handicap_snapshot != null
                ? t('groupChallenge.log.snapshotLine', {
                    value: roster.handicap_snapshot.toFixed(1),
                  })
                : t('groupChallenge.handicapPending')}
              {netPreview != null
                ? ` · ${t('groupChallenge.log.netPreview', { net: netPreview.toFixed(1) })}`
                : ''}
            </Text>
          ) : null}
        </View>

        {isVerifiedMode ? (
          <View style={styles.card}>
            <Text style={styles.lockedLabel}>{t('groupChallenge.log.evidenceLabel')}</Text>
            <Text style={styles.muted}>{t('groupChallenge.log.evidenceHelp')}</Text>
            {evidenceUri ? (
              <Image source={{ uri: evidenceUri }} style={styles.evidenceThumb} resizeMode="contain" />
            ) : null}
            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
              onPress={() => void pickEvidence()}
              disabled={submitting}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryBtnTxt}>
                {evidenceUri
                  ? t('groupChallenge.log.replaceEvidence')
                  : t('groupChallenge.log.pickEvidence')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.muted}>{t('groupChallenge.log.casualNoEvidence')}</Text>
        )}

        <Text style={[styles.muted, { marginTop: 8 }]}>{t('groupChallenge.log.oneRoundOnly')}</Text>

        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            (pressed || submitting) && styles.pressed,
            !canPressSubmit && styles.btnDisabled,
          ]}
          disabled={!canPressSubmit}
          onPress={() => void onSubmit()}
          accessibilityRole="button"
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnTxt}>{t('groupChallenge.log.submit')}</Text>
          )}
        </Pressable>
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 4 },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  errorTxt: { fontSize: 13, color: colors.danger, lineHeight: 18, marginTop: 6 },
  card: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 14,
    marginTop: 12,
    gap: 4,
  },
  lockedLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.sage,
    textTransform: 'uppercase',
  },
  lockedValue: { fontSize: 15, fontWeight: '600', color: colors.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipTxt: { fontSize: 13, fontWeight: '600', color: colors.ink },
  chipTxtOn: { color: '#fff' },
  grossInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 10 : 12,
    fontSize: 24,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 4,
    marginBottom: 6,
  },
  evidenceThumb: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    marginTop: 8,
  },
  primaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.header,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
    minHeight: 48,
  },
  primaryBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.sage,
    marginTop: 8,
    minHeight: 44,
  },
  secondaryBtnTxt: { color: colors.accentDark, fontWeight: '700', fontSize: 15 },
  btnDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
});
