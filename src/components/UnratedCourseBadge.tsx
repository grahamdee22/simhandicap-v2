import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../i18n';
import { colors } from '../lib/constants';

type Props = {
  compact?: boolean;
};

/** Informational only — round still counts toward SimCap index (WHS Par/113 or user-reported). */
export function UnratedCourseBadge({ compact }: Props) {
  const { t } = useTranslation();
  return (
    <View style={[styles.badge, compact && styles.badgeCompact]}>
      <Text style={[styles.badgeTxt, compact && styles.badgeTxtCompact]}>
        {t('course.badge.unrated')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff7ed',
    borderColor: '#fdba74',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 4,
  },
  badgeCompact: {
    marginTop: 0,
    marginLeft: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeTxt: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.warn,
    letterSpacing: 0.2,
  },
  badgeTxtCompact: {
    fontSize: 10,
  },
});
