import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentWidth } from '../../src/components/ContentWidth';
import { IconChevronForward } from '../../src/components/SvgUiIcons';
import { colors } from '../../src/lib/constants';
import { SIMCAP_INSTAGRAM_URL } from '../../src/lib/socialLinks';
import { useResponsive } from '../../src/lib/responsive';

const ADMIN_EMAIL = 'simcapadmin@gmail.com';
const INSTAGRAM_HANDLE = '@s1mcap';

function mailtoUrl() {
  return `mailto:${ADMIN_EMAIL}`;
}

export default function ContactScreen() {
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();

  const onEmail = () => void Linking.openURL(mailtoUrl());
  const onInstagram = () => void Linking.openURL(SIMCAP_INSTAGRAM_URL);

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
          SimCap is in beta and we want to hear from you — whether it&apos;s a bug, a feature idea, or just feedback
          on how the handicap math feels.
        </Text>

        <Pressable
          onPress={onEmail}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel="Email SimCap"
        >
          <View style={styles.cardTop}>
            <Text style={styles.cardK}>Email</Text>
            <IconChevronForward size={18} color={colors.sage} />
          </View>
          <Text style={styles.cardVal}>{ADMIN_EMAIL}</Text>
          <Text style={styles.cardHint}>Opens your email app</Text>
        </Pressable>

        <Pressable
          onPress={onInstagram}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel="Open SimCap Instagram"
        >
          <View style={styles.cardTop}>
            <Text style={styles.cardK}>Instagram</Text>
            <IconChevronForward size={18} color={colors.sage} />
          </View>
          <Text style={styles.cardVal}>{INSTAGRAM_HANDLE}</Text>
          <Text style={styles.cardHint}>Opens Instagram</Text>
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
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardPressed: { opacity: 0.92 },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardK: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.subtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardVal: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  cardHint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 6,
  },
});
