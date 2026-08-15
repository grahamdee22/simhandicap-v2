import { Redirect, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { IconAnalyticsBars, IconChevronForward, IconGolf } from '../../../src/components/SvgUiIcons';
import { colors } from '../../../src/lib/constants';
import { PRACTICE_ANALYZER_ENABLED } from '../../../src/lib/featureFlags';
import { useResponsive } from '../../../src/lib/responsive';

/**
 * Center-tab gate: Log a Round vs Analyze Practice (when enabled).
 * When Practice Analyzer is disabled, skip straight to Log a Round.
 */
export default function LogChoiceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();

  if (!PRACTICE_ANALYZER_ENABLED) {
    return <Redirect href={'/(tabs)/log/round' as never} />;
  }

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
        <Text style={styles.intro}>
          Choose what you want to do. Logging a round updates your SimCap index. Practice Analyzer is coaching
          only — it never touches your handicap.
        </Text>

        <Pressable
          onPress={() => router.push('/(tabs)/log/round' as never)}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel="Log a round"
        >
          <View style={styles.iconWrap}>
            <IconGolf size={22} color={colors.sage} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Log a Round</Text>
            <Text style={styles.cardSub}>
              Score + sim settings → updates your SimCap index, Trends, and profile.
            </Text>
          </View>
          <IconChevronForward size={20} color={colors.subtle} />
        </Pressable>

        <Pressable
          onPress={() => router.push('/(tabs)/log/practice' as never)}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel="Analyze practice"
        >
          <View style={styles.iconWrap}>
            <IconAnalyticsBars size={22} color={colors.sage} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Analyze Practice</Text>
            <Text style={styles.cardSub}>
              Photo your range/stats screen for takeaways and tips. Does not affect your index.
            </Text>
          </View>
          <IconChevronForward size={20} color={colors.subtle} />
        </Pressable>
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0, width: '100%' },
  intro: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.muted,
    lineHeight: 22,
    marginBottom: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    marginBottom: 10,
    backgroundColor: colors.surface,
    gap: 12,
  },
  cardPressed: { opacity: 0.92, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  cardSub: { fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 17 },
});
