import { useFocusEffect } from '@react-navigation/native';
import { Link, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthContext';
import { ContentWidth } from '../../src/components/ContentWidth';
import { PendingTournamentHolesBanner } from '../../src/components/PendingTournamentHolesBanner';
import { DualIndexChart } from '../../src/components/DualIndexChart';
import { IconAddCircleOutline, IconCheckmark, IconChevronForward } from '../../src/components/SvgUiIcons';
import {
  SUPPORTED_LANGUAGES,
  getLanguageOverride,
  setLanguageOverride,
  useTranslation,
  type AppLanguageCode,
} from '../../src/i18n';
import { showAppAlert } from '../../src/lib/alertCompat';
import { PLATFORMS, colors, type PlatformId } from '../../src/lib/constants';
import { PAYWALL_ENABLED } from '../../src/lib/featureFlags';
import { formatDifferentialDisplay, formatHandicapIndexDisplay } from '../../src/lib/handicap';
import { applyProfileRowToStore, fetchMyProfile, upsertMyProfile } from '../../src/lib/profiles';
import { googleOAuthAccessToken } from '../../src/lib/googleOAuthAccessToken';
import { getIsProEntitled } from '../../src/lib/purchases';
import { isSupabaseConfigured } from '../../src/lib/supabase';
import { useResponsive } from '../../src/lib/responsive';
import {
  buildDualIndexChartPoints,
  computeGapTrend,
  formatSimVsRealGapSentence,
  latestGhinIndex,
} from '../../src/lib/realVsSim';
import { currentIndexFromRounds, formatRoundMeta, useAppStore } from '../../src/store/useAppStore';

/** Guest-only demo row on the Contact card (not sign-in email). */
const DEMO_CONTACT_EMAIL = 'jake.morrison@example.com';

const PRIVACY_POLICY_URL = 'https://sim-cap.com/privacy.html';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { gutter, isWide } = useResponsive();
  const insets = useSafeAreaInsets();
  const displayName = useAppStore((s) => s.displayName);
  /** null = follow device locale; otherwise a manual override stored in AsyncStorage. */
  const [languageOverride, setLanguageOverrideState] = useState<AppLanguageCode | null>(null);
  const setDisplayName = useAppStore((s) => s.setDisplayName);
  const preferredLogPlatform = useAppStore((s) => s.preferredLogPlatform);
  const setPreferredLogPlatform = useAppStore((s) => s.setPreferredLogPlatform);
  const rounds = useAppStore((s) => s.rounds);
  const ghinSnapshots = useAppStore((s) => s.ghinSnapshots);
  const recordGhinIndex = useAppStore((s) => s.recordGhinIndex);
  const supabaseOn = isSupabaseConfigured();
  const signedIn = supabaseOn && !!user;
  const latest = rounds[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const [ghinDraft, setGhinDraft] = useState('');
  const [chartW, setChartW] = useState(0);
  const [savingField, setSavingField] = useState<'name' | 'ghin' | 'platform' | 'signout' | null>(null);
  const [simcapId, setSimcapId] = useState<string | null>(null);
  const [matchPlayRecord, setMatchPlayRecord] = useState<{
    wins: number;
    losses: number;
    draws: number;
    forfeits: number;
  } | null>(null);
  const [isProEntitled, setIsProEntitled] = useState(false);

  const simIndex = useMemo(() => currentIndexFromRounds(rounds), [rounds]);
  const ghinLatest = useMemo(() => latestGhinIndex(ghinSnapshots), [ghinSnapshots]);

  /** Local-only: keep draft aligned with snapshots. When signed in, focus fetch sets the field from Supabase. */
  useEffect(() => {
    if (signedIn) return;
    if (ghinLatest != null) setGhinDraft(ghinLatest.toFixed(1));
  }, [ghinLatest, signedIn]);

  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return;
      let cancelled = false;
      void (async () => {
        const p = await fetchMyProfile(user?.id, googleOAuthAccessToken ?? undefined);
        if (cancelled) return;
        if (p) {
          const { setDisplayName, setPreferredLogPlatform, syncGhinFromProfileIfChanged: syncGhin } =
            useAppStore.getState();
          applyProfileRowToStore(p, {
            setDisplayName,
            setPreferredLogPlatform,
            syncGhinFromProfileIfChanged: syncGhin,
          });
          setMatchPlayRecord({
            wins: p.match_wins,
            losses: p.match_losses,
            draws: p.match_draws,
            forfeits: p.match_forfeits,
          });
          setSimcapId(p.simcap_id);
        } else {
          setMatchPlayRecord(null);
          setSimcapId(null);
        }
        const snaps = useAppStore.getState().ghinSnapshots;
        const fromServer =
          p?.ghin_index != null && Number.isFinite(Number(p.ghin_index)) ? Number(p.ghin_index) : null;
        const fallback = latestGhinIndex(snaps);
        const display = fromServer ?? fallback;
        if (!cancelled) {
          setGhinDraft(display != null ? display.toFixed(1) : '');
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [signedIn, user?.id, googleOAuthAccessToken])
  );

  useEffect(() => {
    if (!signedIn) setSimcapId(null);
  }, [signedIn]);

  useEffect(() => {
    let cancelled = false;
    void getLanguageOverride().then((code) => {
      if (!cancelled) setLanguageOverrideState(code);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSelectLanguage = async (code: AppLanguageCode | null) => {
    await setLanguageOverride(code);
    setLanguageOverrideState(code);
  };

  useFocusEffect(
    useCallback(() => {
      if (!PAYWALL_ENABLED) return;
      let cancelled = false;
      void (async () => {
        const entitled = await getIsProEntitled();
        if (!cancelled) setIsProEntitled(entitled);
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  const chartGeom = useMemo(
    () => buildDualIndexChartPoints(rounds, ghinSnapshots),
    [rounds, ghinSnapshots]
  );

  const gapTrend = useMemo(
    () => computeGapTrend(rounds, ghinSnapshots),
    [rounds, ghinSnapshots]
  );

  const saveGhin = async () => {
    const v = parseFloat(ghinDraft.replace(/,/g, '.').trim());
    if (Number.isNaN(v) || v < 0) {
      showAppAlert(t('profile.alertGhinTitle'), t('profile.alertGhinBody'));
      return;
    }
    const rounded = Math.round(v * 10) / 10;
    recordGhinIndex(rounded);
    setGhinDraft(rounded.toFixed(1));
    if (signedIn) {
      setSavingField('ghin');
      const { error } = await upsertMyProfile(
        { ghin_index: rounded },
        user?.id,
        googleOAuthAccessToken ?? undefined
      );
      setSavingField(null);
      if (error) showAppAlert(t('profile.alertProfileTitle'), error);
    }
  };

  const onGhinBlur = () => {
    const trimmed = ghinDraft.replace(/,/g, '.').trim();
    if (trimmed === '') return;
    const v = parseFloat(trimmed);
    if (Number.isNaN(v) || v < 0) {
      showAppAlert(t('profile.alertGhinTitle'), t('profile.alertGhinBody'));
      setGhinDraft(ghinLatest != null ? ghinLatest.toFixed(1) : '');
      return;
    }
    const rounded = Math.round(v * 10) / 10;
    if (ghinLatest != null && Math.abs(rounded - ghinLatest) < 0.05) return;
    void saveGhin();
  };

  const saveName = async () => {
    const n = draft.trim() || t('profile.defaultDisplayName');
    setDisplayName(n);
    setEditing(false);
    if (signedIn) {
      setSavingField('name');
      const { error } = await upsertMyProfile(
        { display_name: n },
        user?.id,
        googleOAuthAccessToken ?? undefined
      );
      setSavingField(null);
      if (error) showAppAlert(t('profile.alertProfileTitle'), error);
    }
  };

  const savePreferredPlatform = async (p: PlatformId) => {
    setPreferredLogPlatform(p);
    if (signedIn) {
      setSavingField('platform');
      const { error } = await upsertMyProfile(
        { preferred_platform: p },
        user?.id,
        googleOAuthAccessToken ?? undefined
      );
      setSavingField(null);
      if (error) showAppAlert(t('profile.alertProfileTitle'), error);
    }
  };

  const onSignOut = async () => {
    if (!supabaseOn) return;
    setSavingField('signout');
    await signOut();
    setSavingField(null);
    router.replace('/(auth)/sign-in');
  };

  return (
    <ContentWidth>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: Math.max(gutter, 10),
          paddingBottom: insets.bottom + 32,
        }}
      >
        <PendingTournamentHolesBanner gutter={0} />
        <Text style={[styles.sub, isWide && styles.subLg]}>
          {signedIn ? t('profile.syncCloud') : t('profile.syncLocal')}
        </Text>

        {signedIn ? (
          <View style={[styles.card, styles.simcapHeroCard]}>
            <Text style={styles.simcapHeroLabel}>{t('profile.simcapId')}</Text>
            <Text selectable={!!simcapId} style={styles.simcapHeroValue}>
              {simcapId ?? t('profile.loading')}
            </Text>
            <Text style={styles.simcapHeroHint}>{t('profile.simcapIdHint')}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Pressable
            onPress={() => router.push('/(tabs)/contact')}
            style={({ pressed }) => [
              styles.lastRound,
              styles.contactFeedbackRow,
              pressed && styles.contactFeedbackRowPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('profile.contactA11y')}
          >
            <View style={styles.lastRoundTxt}>
              <Text style={styles.lastRoundK}>{t('profile.contactTitle')}</Text>
              <Text style={styles.lastRoundTitle} numberOfLines={2}>
                {t('profile.contactSub')}
              </Text>
            </View>
            <View style={styles.contactFeedbackChevron}>
              <IconChevronForward size={18} color={colors.subtle} />
            </View>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.lbl}>{t('profile.displayName')}</Text>
          {editing ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder={t('profile.namePlaceholder')}
                placeholderTextColor={colors.subtle}
              />
              <Pressable
                onPress={() => void saveName()}
                disabled={savingField === 'name'}
                style={styles.saveMini}
              >
                {savingField === 'name' ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveMiniTxt}>{t('profile.save')}</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => { setDraft(displayName); setEditing(true); }}>
              <Text style={styles.name}>{displayName}</Text>
              <Text style={styles.tap}>{t('profile.tapToEdit')}</Text>
            </Pressable>
          )}
        </View>

        {signedIn ? (
          <View style={styles.card}>
            <Text style={styles.lbl}>{t('profile.account')}</Text>
            <Text style={styles.cardLead}>{user?.email ?? ''}</Text>
            <Pressable
              onPress={onSignOut}
              disabled={savingField === 'signout'}
              style={[styles.signOutBtn, savingField === 'signout' && styles.signOutDisabled]}
            >
              {savingField === 'signout' ? (
                <ActivityIndicator color={colors.danger} />
              ) : (
                <Text style={styles.signOutTxt}>{t('profile.signOut')}</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {PAYWALL_ENABLED ? (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.matchRecordCardPressed]}
            onPress={() => router.push('/paywall' as never)}
            accessibilityRole="button"
            accessibilityLabel={t('profile.proA11y')}
          >
            <Text style={styles.lbl}>{t('profile.simcapPro')}</Text>
            <View style={styles.matchRecordRow}>
              <View style={styles.matchRecordTextCol}>
                <Text style={styles.cardLead}>
                  {isProEntitled ? t('profile.planPro') : t('profile.planFree')}
                </Text>
                <Text style={styles.meta}>
                  {isProEntitled ? t('profile.proActive') : t('profile.proManage')}
                </Text>
              </View>
              <View style={styles.matchRecordChevron}>
                <IconChevronForward size={20} color={colors.subtle} />
              </View>
            </View>
          </Pressable>
        ) : null}

        {signedIn && matchPlayRecord ? (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.matchRecordCardPressed]}
            onPress={() => router.push('/(tabs)/match-history' as never)}
            accessibilityRole="button"
            accessibilityLabel={t('profile.matchHistoryA11y')}
          >
            <Text style={styles.lbl}>{t('profile.matchPlayRecord')}</Text>
            <View style={styles.matchRecordRow}>
              <View style={styles.matchRecordTextCol}>
                <Text style={styles.statBig}>
                  {matchPlayRecord.wins}–{matchPlayRecord.losses}–{matchPlayRecord.draws}
                </Text>
                <Text style={styles.statLbl}>{t('profile.matchRecordLbl')}</Text>
                <Text style={styles.matchForfeitMeta}>
                  {t('profile.forfeits', { count: matchPlayRecord.forfeits })}
                </Text>
              </View>
              <View style={styles.matchRecordChevron}>
                <IconChevronForward size={20} color={colors.subtle} />
              </View>
            </View>
          </Pressable>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.lbl}>{t('profile.roundsActivity')}</Text>
          <Text style={styles.statBig}>{rounds.length}</Text>
          <Text style={styles.statLbl}>{t('profile.roundsLogged')}</Text>
          {latest ? (
            <Link href={`/round/${latest.id}`} asChild>
              <Pressable style={styles.lastRound}>
                <View style={styles.lastRoundTxt}>
                  <Text style={styles.lastRoundK}>{t('profile.mostRecent')}</Text>
                  <Text style={styles.lastRoundTitle} numberOfLines={1}>
                    {latest.courseName}
                  </Text>
                  <Text style={styles.lastRoundMeta} numberOfLines={2}>
                    {t('profile.lastRoundMeta', {
                      date: new Date(latest.playedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      }),
                      score: latest.grossScore,
                      holes:
                        latest.holesPlayed === 'front'
                          ? t('profile.holesFront')
                          : latest.holesPlayed === 'back'
                            ? t('profile.holesBack')
                            : '',
                      diff: formatDifferentialDisplay(latest.adjustedDiff),
                    })}
                  </Text>
                  <Text style={styles.lastRoundSettings} numberOfLines={2}>
                    {formatRoundMeta(latest)}
                  </Text>
                </View>
                <IconChevronForward size={18} color={colors.subtle} />
              </Pressable>
            </Link>
          ) : (
            <Link href={'/(tabs)/log/round' as Href} asChild>
              <Pressable style={styles.logCta}>
                <Text style={styles.logCtaTxt}>{t('profile.logCta')}</Text>
                <IconAddCircleOutline size={20} color={colors.accent} />
              </Pressable>
            </Link>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.lbl}>{t('profile.realVsSim')}</Text>
          <Text style={styles.meta}>{t('profile.realVsSimMeta')}</Text>

          <Text style={styles.ghinFieldLbl}>{t('profile.currentGhin')}</Text>
          <Text style={styles.ghinFieldHint}>{t('profile.ghinTournamentHint')}</Text>
          <View style={styles.ghinRow}>
            <TextInput
              style={styles.ghinInput}
              value={ghinDraft}
              onChangeText={setGhinDraft}
              onBlur={() => onGhinBlur()}
              placeholder={t('profile.ghinPlaceholder')}
              placeholderTextColor={colors.subtle}
              keyboardType="decimal-pad"
            />
            <Pressable
              onPress={() => void saveGhin()}
              disabled={savingField === 'ghin'}
              style={styles.ghinSave}
            >
              {savingField === 'ghin' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ghinSaveTxt}>
                  {ghinLatest != null ? t('profile.update') : t('profile.save')}
                </Text>
              )}
            </Pressable>
          </View>

          {ghinLatest != null ? (
            <>
              <View style={styles.compareCard}>
                <View style={styles.compareRow}>
                  <View style={styles.compareCell}>
                    <Text style={styles.compareK}>{t('profile.simIndex')}</Text>
                    <Text style={styles.compareV}>{formatHandicapIndexDisplay(simIndex)}</Text>
                  </View>
                  <View style={styles.compareDivider} />
                  <View style={styles.compareCell}>
                    <Text style={styles.compareK}>{t('profile.ghinReal')}</Text>
                    <Text style={styles.compareV}>{formatHandicapIndexDisplay(ghinLatest)}</Text>
                  </View>
                </View>
                {simIndex != null ? (
                  <Text style={styles.gapSentence}>
                    {formatSimVsRealGapSentence(simIndex, ghinLatest)}
                  </Text>
                ) : (
                  <Text style={styles.gapSentenceMuted}>{t('profile.logSimRounds')}</Text>
                )}
                {simIndex != null ? (
                  <View
                    style={[
                      styles.gapTrendPill,
                      gapTrend === 'closing' && styles.gapTrendClosing,
                      gapTrend === 'widening' && styles.gapTrendWidening,
                      gapTrend === 'steady' && styles.gapTrendSteady,
                    ]}
                  >
                    <Text
                      style={[
                        styles.gapTrendTxt,
                        gapTrend === 'closing' && styles.gapTrendTxtClosing,
                        gapTrend === 'widening' && styles.gapTrendTxtWidening,
                      ]}
                    >
                      {gapTrend === 'closing'
                        ? t('profile.gapClosing')
                        : gapTrend === 'widening'
                          ? t('profile.gapWidening')
                          : t('profile.gapSteady')}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.chartTitle}>{t('profile.indexHistory')}</Text>
              <View
                style={styles.chartBox}
                onLayout={(e) => setChartW(e.nativeEvent.layout.width)}
              >
                {chartW > 0 && chartGeom ? (
                  <DualIndexChart
                    width={chartW}
                    height={200}
                    simPts={chartGeom.simPts}
                    realPts={chartGeom.realPts}
                    yMin={chartGeom.yMin}
                    yMax={chartGeom.yMax}
                    tMin={chartGeom.tMin}
                    tMax={chartGeom.tMax}
                  />
                ) : (
                  <Text style={styles.chartEmpty}>{t('profile.chartEmpty')}</Text>
                )}
              </View>

              <Text style={styles.explainer}>{t('profile.explainer')}</Text>
            </>
          ) : (
            <Text style={styles.ghinHint}>{t('profile.ghinHintEmpty')}</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.lbl}>{t('profile.preferredPlatform')}</Text>
          <Text style={styles.meta}>{t('profile.preferredPlatformMeta')}</Text>
          <View style={styles.platformList}>
            {PLATFORMS.map((p) => {
              const on = p === preferredLogPlatform;
              return (
                <Pressable
                  key={p}
                  onPress={() => void savePreferredPlatform(p)}
                  disabled={savingField === 'platform'}
                  style={[styles.platformRow, on && styles.platformRowOn]}
                >
                  <Text style={[styles.platformRowTxt, on && styles.platformRowTxtOn]}>{p}</Text>
                  {on ? <IconCheckmark size={18} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.lbl}>{t('settings.language')}</Text>
          <Text style={styles.meta}>{t('settings.languageHint')}</Text>
          <View style={styles.platformList}>
            <Pressable
              onPress={() => void onSelectLanguage(null)}
              style={[styles.platformRow, languageOverride == null && styles.platformRowOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: languageOverride == null }}
            >
              <Text
                style={[styles.platformRowTxt, languageOverride == null && styles.platformRowTxtOn]}
              >
                {t('settings.languageDeviceDefault')}
              </Text>
              {languageOverride == null ? <IconCheckmark size={18} color={colors.accent} /> : null}
            </Pressable>
            {SUPPORTED_LANGUAGES.map((lang) => {
              const on = languageOverride === lang.code;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => void onSelectLanguage(lang.code)}
                  style={[styles.platformRow, on && styles.platformRowOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.platformRowTxt, on && styles.platformRowTxtOn]}>
                    {lang.label}
                  </Text>
                  {on ? <IconCheckmark size={18} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        {!signedIn ? (
          <View style={styles.card}>
            <Text style={styles.lbl}>{t('profile.contact')}</Text>
            <Text style={styles.cardLead}>{DEMO_CONTACT_EMAIL}</Text>
            <Text style={styles.meta}>{t('profile.demoEmailMeta')}</Text>
          </View>
        ) : null}

        <Pressable
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
          style={({ pressed }) => [styles.privacyLinkWrap, pressed && styles.privacyLinkPressed]}
          accessibilityRole="link"
          accessibilityLabel={t('profile.privacyA11y')}
        >
          <Text style={styles.privacyLink}>{t('profile.privacyPolicy')}</Text>
        </Pressable>
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, backgroundColor: colors.bg, width: '100%' },
  sub: { fontSize: 13, color: colors.muted, marginBottom: 20, lineHeight: 18 },
  subLg: { fontSize: 14, lineHeight: 20, maxWidth: 720 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  simcapHeroCard: {
    backgroundColor: colors.forestDeep,
    borderColor: colors.sage,
    paddingVertical: 18,
  },
  simcapHeroLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  simcapHeroValue: {
    fontSize: 30,
    fontWeight: '700',
    color: '#fff',
    marginTop: 10,
    letterSpacing: 2.5,
    fontVariant: ['tabular-nums'],
  },
  simcapHeroHint: {
    fontSize: 13,
    color: '#d8f3e8',
    marginTop: 10,
    lineHeight: 18,
  },
  lbl: { fontSize: 10, fontWeight: '600', color: colors.subtle, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardLead: { fontSize: 17, fontWeight: '600', color: colors.ink, marginTop: 8 },
  name: { fontSize: 20, fontWeight: '600', color: colors.ink, marginTop: 8 },
  tap: { fontSize: 12, fontWeight: '600', color: colors.sage, marginTop: 4 },
  meta: { fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 18 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  input: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    color: colors.ink,
  },
  saveMini: { backgroundColor: colors.header, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, minWidth: 72, alignItems: 'center', justifyContent: 'center' },
  saveMiniTxt: { color: '#fff', fontWeight: '700' },
  signOutBtn: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
  },
  signOutDisabled: { opacity: 0.6 },
  signOutTxt: { color: colors.danger, fontWeight: '700', fontSize: 15 },
  platformList: { marginTop: 12, gap: 8 },
  platformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
  },
  platformRowOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  platformRowTxt: { fontSize: 15, fontWeight: '600', color: colors.ink },
  platformRowTxtOn: { color: colors.accentDark },
  /** Same row pattern as "Most recent"; no top rule — nothing above inside this card. */
  contactFeedbackRow: {
    marginTop: 0,
    paddingTop: 0,
    borderTopWidth: 0,
    width: '100%',
    alignSelf: 'stretch',
  },
  contactFeedbackRowPressed: { opacity: 0.92 },
  contactFeedbackChevron: { flexShrink: 0 },
  statBig: { fontSize: 32, fontWeight: '600', color: colors.ink, marginTop: 4 },
  statLbl: { fontSize: 12, color: colors.muted, marginBottom: 0 },
  matchRecordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  matchRecordTextCol: { flex: 1, minWidth: 0 },
  matchRecordChevron: { flexShrink: 0 },
  matchRecordCardPressed: { opacity: 0.92 },
  matchForfeitMeta: { fontSize: 13, color: colors.muted, marginTop: 8 },
  lastRound: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
  },
  lastRoundTxt: { flex: 1, minWidth: 0 },
  lastRoundK: { fontSize: 10, fontWeight: '600', color: colors.accent, textTransform: 'uppercase' },
  lastRoundTitle: { fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 4 },
  lastRoundMeta: { fontSize: 12, color: colors.muted, marginTop: 4 },
  lastRoundSettings: { fontSize: 11, color: colors.subtle, marginTop: 4 },
  logCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
    padding: 12,
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    borderWidth: 0.5,
    borderColor: colors.accent,
  },
  logCtaTxt: { flex: 1, fontSize: 13, color: colors.accentDark, fontWeight: '600', lineHeight: 18 },
  ghinFieldLbl: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    marginTop: 14,
    marginBottom: 4,
  },
  ghinFieldHint: {
    fontSize: 11,
    color: colors.subtle,
    marginBottom: 8,
    lineHeight: 16,
  },
  ghinRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ghinInput: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: colors.pillBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  ghinSave: {
    backgroundColor: colors.header,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
  },
  ghinSaveTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  ghinHint: { fontSize: 12, color: colors.muted, marginTop: 10, lineHeight: 17 },
  compareCard: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.pillBorder,
  },
  compareRow: { flexDirection: 'row', alignItems: 'stretch' },
  compareCell: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  compareDivider: { width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 },
  compareK: { fontSize: 10, fontWeight: '700', color: colors.subtle, textTransform: 'uppercase', letterSpacing: 0.4 },
  compareV: { fontSize: 22, fontWeight: '700', color: colors.accentDark, marginTop: 6 },
  gapSentence: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
    marginTop: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  gapSentenceMuted: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 14,
    lineHeight: 19,
    textAlign: 'center',
  },
  gapTrendPill: {
    alignSelf: 'center',
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.border,
  },
  gapTrendClosing: { backgroundColor: '#d8f3e8' },
  gapTrendWidening: { backgroundColor: '#fef3c7' },
  gapTrendSteady: { backgroundColor: colors.border },
  gapTrendTxt: { fontSize: 12, fontWeight: '700', color: colors.muted },
  gapTrendTxtClosing: { color: colors.accentDark },
  gapTrendTxtWidening: { color: '#92400e' },
  chartTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.subtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 8,
  },
  chartBox: { minHeight: 200, justifyContent: 'center' },
  chartEmpty: { fontSize: 12, color: colors.muted, lineHeight: 17, textAlign: 'center', paddingVertical: 24 },
  explainer: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
    marginTop: 12,
    fontStyle: 'italic',
  },
  privacyLinkWrap: { alignSelf: 'center', marginTop: 8, paddingVertical: 10, paddingHorizontal: 8 },
  privacyLinkPressed: { opacity: 0.75 },
  privacyLink: { fontSize: 12, fontWeight: '600', color: colors.sage },
});
