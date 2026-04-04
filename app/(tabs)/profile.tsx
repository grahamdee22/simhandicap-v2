import { Link, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthContext';
import { ContentWidth } from '../../src/components/ContentWidth';
import { DualIndexChart } from '../../src/components/DualIndexChart';
import { IconAddCircleOutline, IconCheckmark, IconChevronForward } from '../../src/components/SvgUiIcons';
import { showAppAlert } from '../../src/lib/alertCompat';
import { PLATFORMS, colors, type PlatformId } from '../../src/lib/constants';
import { formatHandicapIndexDisplay } from '../../src/lib/handicap';
import { upsertMyProfile } from '../../src/lib/profiles';
import { isSupabaseConfigured } from '../../src/lib/supabase';
import { useResponsive } from '../../src/lib/responsive';
import {
  buildDualIndexChartPoints,
  computeGapTrend,
  formatSimVsRealGapSentence,
  latestGhinIndex,
} from '../../src/lib/realVsSim';
import { currentIndexFromRounds, formatRoundMeta, useAppStore } from '../../src/store/useAppStore';

/** Demo-only profile fields (replace with real account data when wired). */
const DEMO_PROFILE = {
  firstName: 'Jake',
  lastName: 'Morrison',
  addressLine1: '428 Pinehurst Lane',
  addressLine2: 'Austin, TX 78701',
  email: 'jake.morrison@example.com',
  paymentSummary: 'Visa · ···· 4242',
  paymentSub: 'Expires 09/28 · Billing address on file',
} as const;

export default function ProfileScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { gutter, isWide } = useResponsive();
  const insets = useSafeAreaInsets();
  const displayName = useAppStore((s) => s.displayName);
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

  const simIndex = useMemo(() => currentIndexFromRounds(rounds), [rounds]);
  const ghinLatest = useMemo(() => latestGhinIndex(ghinSnapshots), [ghinSnapshots]);

  useEffect(() => {
    if (ghinLatest != null) setGhinDraft(ghinLatest.toFixed(1));
  }, [ghinLatest]);

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
      showAppAlert('GHIN index', 'Enter a valid handicap index (0 or higher).');
      return;
    }
    recordGhinIndex(v);
    setGhinDraft(v.toFixed(1));
    if (signedIn) {
      setSavingField('ghin');
      const { error } = await upsertMyProfile({ ghin_index: v });
      setSavingField(null);
      if (error) showAppAlert('Profile', error);
    }
  };

  const saveName = async () => {
    const n = draft.trim() || 'Golfer';
    setDisplayName(n);
    setEditing(false);
    if (signedIn) {
      setSavingField('name');
      const { error } = await upsertMyProfile({ display_name: n });
      setSavingField(null);
      if (error) showAppAlert('Profile', error);
    }
  };

  const savePreferredPlatform = async (p: PlatformId) => {
    setPreferredLogPlatform(p);
    if (signedIn) {
      setSavingField('platform');
      const { error } = await upsertMyProfile({ preferred_platform: p });
      setSavingField(null);
      if (error) showAppAlert('Profile', error);
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
          paddingTop: Math.max(gutter, 16),
          paddingBottom: insets.bottom + 32,
        }}
      >
        <Text style={[styles.h1, isWide && styles.h1Lg]}>Profile</Text>
        <Text style={[styles.sub, isWide && styles.subLg]}>
          {signedIn
            ? 'Rounds stay on this device per account; your name, preferred sim, and GHIN sync to your profile.'
            : 'Rounds and display name are stored on this device.'}
        </Text>

        {signedIn ? (
          <View style={styles.card}>
            <Text style={styles.lbl}>Account</Text>
            <Text style={styles.cardLead}>{user?.email ?? ''}</Text>
            <Pressable
              onPress={onSignOut}
              disabled={savingField === 'signout'}
              style={[styles.signOutBtn, savingField === 'signout' && styles.signOutDisabled]}
            >
              {savingField === 'signout' ? (
                <ActivityIndicator color={colors.danger} />
              ) : (
                <Text style={styles.signOutTxt}>Sign out</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.lbl}>Rounds & activity</Text>
          <Text style={styles.statBig}>{rounds.length}</Text>
          <Text style={styles.statLbl}>rounds logged on this device</Text>
          {latest ? (
            <Link href={`/round/${latest.id}`} asChild>
              <Pressable style={styles.lastRound}>
                <View style={styles.lastRoundTxt}>
                  <Text style={styles.lastRoundK}>Most recent</Text>
                  <Text style={styles.lastRoundTitle} numberOfLines={1}>
                    {latest.courseName}
                  </Text>
                  <Text style={styles.lastRoundMeta} numberOfLines={2}>
                    {new Date(latest.playedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}{' '}
                    · {latest.grossScore} gross · diff {latest.adjustedDiff.toFixed(1)}
                  </Text>
                  <Text style={styles.lastRoundSettings} numberOfLines={2}>
                    {formatRoundMeta(latest)}
                  </Text>
                </View>
                <IconChevronForward size={18} color={colors.subtle} />
              </Pressable>
            </Link>
          ) : (
            <Link href="/(tabs)/log" asChild>
              <Pressable style={styles.logCta}>
                <Text style={styles.logCtaTxt}>Log a round — your index and chart start here</Text>
                <IconAddCircleOutline size={20} color={colors.accent} />
              </Pressable>
            </Link>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.lbl}>Real vs Sim</Text>
          <Text style={styles.meta}>
            Compare your official GHIN to the sim handicap we calculate from your logged rounds. Update GHIN whenever
            it changes — we keep a simple history for the chart.
          </Text>

          <Text style={styles.ghinFieldLbl}>Current GHIN index</Text>
          <View style={styles.ghinRow}>
            <TextInput
              style={styles.ghinInput}
              value={ghinDraft}
              onChangeText={setGhinDraft}
              placeholder="e.g. 6.4"
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
                <Text style={styles.ghinSaveTxt}>Save</Text>
              )}
            </Pressable>
          </View>

          {ghinLatest != null ? (
            <>
              <View style={styles.compareCard}>
                <View style={styles.compareRow}>
                  <View style={styles.compareCell}>
                    <Text style={styles.compareK}>Sim index</Text>
                    <Text style={styles.compareV}>{formatHandicapIndexDisplay(simIndex)}</Text>
                  </View>
                  <View style={styles.compareDivider} />
                  <View style={styles.compareCell}>
                    <Text style={styles.compareK}>GHIN (real)</Text>
                    <Text style={styles.compareV}>{formatHandicapIndexDisplay(ghinLatest)}</Text>
                  </View>
                </View>
                {simIndex != null ? (
                  <Text style={styles.gapSentence}>
                    {formatSimVsRealGapSentence(simIndex, ghinLatest)}
                  </Text>
                ) : (
                  <Text style={styles.gapSentenceMuted}>
                    Log sim rounds on the Log tab to calculate your sim index.
                  </Text>
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
                        ? 'Gap closing'
                        : gapTrend === 'widening'
                          ? 'Gap widening'
                          : 'Gap steady'}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.chartTitle}>Index history</Text>
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
                  <Text style={styles.chartEmpty}>
                    Save GHIN updates over time and log sim rounds — both lines appear as you build history.
                  </Text>
                )}
              </View>

              <Text style={styles.explainer}>
                Most golfers play 2–4 strokes better on a sim. If your gap is closing it means your real game is
                catching up — or your sim standards are getting tougher.
              </Text>
            </>
          ) : (
            <Text style={styles.ghinHint}>Save a GHIN index above to see the comparison and chart.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.lbl}>Display name</Text>
          {editing ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder="Your name"
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
                  <Text style={styles.saveMiniTxt}>Save</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => { setDraft(displayName); setEditing(true); }}>
              <Text style={styles.name}>{displayName}</Text>
              <Text style={styles.tap}>Tap to edit</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.lbl}>Preferred sim platform</Text>
          <Text style={styles.meta}>Default when you open the Log tab (saved to your profile when signed in).</Text>
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
          <Text style={styles.lbl}>Personal information</Text>
          <Text style={styles.cardLead}>
            {DEMO_PROFILE.firstName} {DEMO_PROFILE.lastName}
          </Text>
          <Text style={styles.meta}>{DEMO_PROFILE.addressLine1}</Text>
          <Text style={styles.meta}>{DEMO_PROFILE.addressLine2}</Text>
        </View>

        {!signedIn ? (
          <View style={styles.card}>
            <Text style={styles.lbl}>Contact</Text>
            <Text style={styles.cardLead}>{DEMO_PROFILE.email}</Text>
            <Text style={styles.meta}>Demo email — not used for sign-in.</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.lbl}>Payment</Text>
          <Text style={styles.cardLead}>{DEMO_PROFILE.paymentSummary}</Text>
          <Text style={styles.meta}>{DEMO_PROFILE.paymentSub}</Text>
        </View>
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, backgroundColor: colors.bg, width: '100%' },
  h1: { fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  h1Lg: { fontSize: 26 },
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
  statBig: { fontSize: 32, fontWeight: '600', color: colors.ink, marginTop: 4 },
  statLbl: { fontSize: 12, color: colors.muted, marginBottom: 12 },
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
    marginBottom: 6,
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
});
