import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/constants';
import { communityCourseAttributionLabel } from '../lib/communityEnrichment';

type Props = {
  compact?: boolean;
  enrichmentTier?: number | null;
  enrichmentSource?: string | null;
};

export function UnverifiedCourseBadge({ compact, enrichmentTier, enrichmentSource }: Props) {
  const label = communityCourseAttributionLabel(enrichmentTier, enrichmentSource);

  return (
    <View style={[styles.badge, compact && styles.badgeCompact]}>
      <Text style={[styles.badgeTxt, compact && styles.badgeTxtCompact]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentSoft,
    borderColor: colors.border,
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
    color: colors.muted,
    letterSpacing: 0.2,
  },
  badgeTxtCompact: {
    fontSize: 10,
  },
});
