import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentWidth } from '../../src/components/ContentWidth';
import { IconChevronForward } from '../../src/components/SvgUiIcons';
import { useAuth } from '../../src/auth/AuthContext';
import { useTranslation } from '../../src/i18n';
import { colors } from '../../src/lib/constants';
import { SIMCAP_INSTAGRAM_URL } from '../../src/lib/socialLinks';
import { useResponsive } from '../../src/lib/responsive';

const ADMIN_EMAIL = 'simcapadmin@gmail.com';
const INSTAGRAM_HANDLE = '@s1mcap';

function mailtoUrl() {
  return `mailto:${ADMIN_EMAIL}`;
}

export default function ContactScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = (user?.email ?? '').trim().toLowerCase() === ADMIN_EMAIL;

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
        <Text style={styles.intro}>{t('contact.intro')}</Text>

        <Pressable
          onPress={onEmail}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel={t('contact.emailA11y')}
        >
          <View style={styles.cardTop}>
            <Text style={styles.cardK}>{t('contact.email')}</Text>
            <IconChevronForward size={18} color={colors.sage} />
          </View>
          <Text style={styles.cardVal}>{ADMIN_EMAIL}</Text>
          <Text style={styles.cardHint}>{t('contact.emailHint')}</Text>
        </Pressable>

        <Pressable
          onPress={onInstagram}
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityLabel={t('contact.instagramA11y')}
        >
          <View style={styles.cardTop}>
            <Text style={styles.cardK}>{t('contact.instagram')}</Text>
            <IconChevronForward size={18} color={colors.sage} />
          </View>
          <Text style={styles.cardVal}>{INSTAGRAM_HANDLE}</Text>
          <Text style={styles.cardHint}>{t('contact.instagramHint')}</Text>
        </Pressable>

        {isAdmin ? (
          <Pressable
            onPress={() => router.push('/admin-custom-courses' as Href)}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            accessibilityRole="button"
            accessibilityLabel={t('adminCustom.open')}
          >
            <View style={styles.cardTop}>
              <Text style={styles.cardK}>{t('adminCustom.open')}</Text>
              <IconChevronForward size={18} color={colors.sage} />
            </View>
            <Text style={styles.cardHint}>{t('adminCustom.openHint')}</Text>
          </Pressable>
        ) : null}
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
