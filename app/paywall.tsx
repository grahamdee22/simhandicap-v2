import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentWidth } from '../src/components/ContentWidth';
import { colors } from '../src/lib/constants';
import { PAYWALL_ENABLED } from '../src/lib/featureFlags';
import {
  getIsProEntitled,
  getOfferings,
  purchasePackage,
  restorePurchases,
  type PurchasesPackage,
} from '../src/lib/purchases';
import { useResponsive } from '../src/lib/responsive';

type PlanKey = 'monthly' | 'annual';

function packageForPlan(
  packages: PurchasesPackage[],
  plan: PlanKey,
): PurchasesPackage | undefined {
  const want = plan === 'monthly' ? 'MONTHLY' : 'ANNUAL';
  return packages.find((p) => String(p.packageType) === want);
}

export default function PaywallScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();

  const [loading, setLoading] = useState(true);
  const [monthly, setMonthly] = useState<PurchasesPackage | null>(null);
  const [annual, setAnnual] = useState<PurchasesPackage | null>(null);
  const [isPro, setIsPro] = useState(false);
  const [busy, setBusy] = useState<PlanKey | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [offering, entitled] = await Promise.all([getOfferings(), getIsProEntitled()]);
      setIsPro(entitled);
      const pkgs = offering?.availablePackages ?? [];
      setMonthly(packageForPlan(pkgs, 'monthly') ?? null);
      setAnnual(packageForPlan(pkgs, 'annual') ?? null);
      if (!entitled && Platform.OS !== 'web' && pkgs.length === 0) {
        setError('No subscription plans are available right now. Try again later.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!PAYWALL_ENABLED) return;
    void refresh();
  }, [refresh]);

  if (!PAYWALL_ENABLED) {
    return <Redirect href={'/(tabs)/profile' as never} />;
  }

  const onPurchase = async (plan: PlanKey) => {
    const pkg = plan === 'monthly' ? monthly : annual;
    if (!pkg || busy) return;
    setBusy(plan);
    setError(null);
    setStatusMsg(null);
    const result = await purchasePackage(pkg);
    setBusy(null);
    if (result.cancelled) return;
    if (!result.success) {
      setError(result.error ?? 'Purchase failed.');
      return;
    }
    setIsPro(true);
    setStatusMsg('You\'re subscribed to SimCap Pro.');
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/profile' as never);
    }
  };

  const onRestore = async () => {
    if (busy) return;
    setBusy('restore');
    setError(null);
    setStatusMsg(null);
    const result = await restorePurchases();
    if (!result.success) {
      setBusy(null);
      setError(result.error ?? 'Restore failed.');
      return;
    }
    const entitled = await getIsProEntitled();
    setIsPro(entitled);
    setBusy(null);
    if (entitled) {
      setStatusMsg('Purchases restored. You have SimCap Pro.');
    } else {
      setStatusMsg('No active SimCap Pro subscription found for this account.');
    }
  };

  const renderPlanButton = (plan: PlanKey, pkg: PurchasesPackage | null, label: string) => {
    const price = pkg?.product.priceString;
    const inFlight = busy === plan;
    const disabled = !pkg || busy !== null || isPro;
    return (
      <Pressable
        key={plan}
        onPress={() => void onPurchase(plan)}
        disabled={disabled}
        style={({ pressed }) => [
          styles.planBtn,
          disabled && styles.planBtnDisabled,
          pressed && !disabled && styles.planBtnPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${label}${price ? `, ${price}` : ''}`}
      >
        {inFlight ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Text style={styles.planLabel}>{label}</Text>
            <Text style={styles.planPrice}>{price ?? 'Unavailable'}</Text>
          </>
        )}
      </Pressable>
    );
  };

  return (
    <ContentWidth bg={colors.bg}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: Math.max(gutter, 16),
          paddingBottom: insets.bottom + 32,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.kicker}>SimCap Pro</Text>
        <Text style={styles.headline}>Unlock SimCap Pro</Text>
        <Text style={styles.intro}>
          Subscription support for SimCap Pro. Pricing and benefits will finalize when the feature
          goes live.
        </Text>

        {isPro ? (
          <View style={styles.statusCard}>
            <Text style={styles.statusTitle}>You&apos;re on Pro</Text>
            <Text style={styles.statusBody}>Your SimCap Pro subscription is active on this account.</Text>
          </View>
        ) : null}

        {Platform.OS === 'web' ? (
          <View style={styles.card}>
            <Text style={styles.webMsg}>
              Subscriptions aren&apos;t available on web — use the iOS or Android app.
            </Text>
          </View>
        ) : loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingTxt}>Loading plans…</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.lbl}>Choose a plan</Text>
            <View style={styles.planList}>
              {renderPlanButton('monthly', monthly, 'Monthly')}
              {renderPlanButton('annual', annual, 'Yearly')}
            </View>
            <Pressable
              onPress={() => void onRestore()}
              disabled={busy !== null}
              style={({ pressed }) => [
                styles.restoreBtn,
                busy !== null && styles.restoreDisabled,
                pressed && busy === null && styles.restorePressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Restore purchases"
            >
              {busy === 'restore' ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={styles.restoreTxt}>Restore purchases</Text>
              )}
            </Pressable>
          </View>
        )}

        {error ? <Text style={styles.errorTxt}>{error}</Text> : null}
        {statusMsg ? <Text style={styles.statusMsg}>{statusMsg}</Text> : null}
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0, width: '100%' },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  headline: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 8,
  },
  intro: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.muted,
    lineHeight: 22,
    marginTop: 10,
    marginBottom: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 0.5,
    borderColor: colors.border,
  },
  statusCard: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 0.5,
    borderColor: colors.accent,
  },
  statusTitle: { fontSize: 17, fontWeight: '700', color: colors.accentDark },
  statusBody: { fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 18 },
  lbl: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.subtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  planList: { marginTop: 12, gap: 10 },
  planBtn: {
    backgroundColor: colors.header,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
  },
  planBtnPressed: { opacity: 0.92 },
  planBtnDisabled: { opacity: 0.55 },
  planLabel: { color: '#fff', fontWeight: '700', fontSize: 16 },
  planPrice: { color: '#d8f3e8', fontWeight: '600', fontSize: 15 },
  restoreBtn: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  restorePressed: { opacity: 0.75 },
  restoreDisabled: { opacity: 0.55 },
  restoreTxt: { fontSize: 14, fontWeight: '700', color: colors.accent },
  webMsg: { fontSize: 15, fontWeight: '500', color: colors.muted, lineHeight: 22 },
  loadingWrap: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  loadingTxt: { fontSize: 13, color: colors.muted },
  errorTxt: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.danger,
    marginTop: 8,
    lineHeight: 18,
  },
  statusMsg: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accentDark,
    marginTop: 8,
    lineHeight: 18,
  },
});
