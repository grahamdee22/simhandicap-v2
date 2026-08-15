import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/constants';
import { formatDifferentialDisplay } from '../lib/handicap';
import { formatRoundMeta, type SimRound } from '../store/useAppStore';
import { IconGolf, IconShareOutline } from './SvgUiIcons';

type Props = {
  round: SimRound;
  isWide?: boolean;
  onPress: () => void;
  onShare: () => void;
  /** First row usually has no top border. Defaults to true. */
  showTopBorder?: boolean;
  paddingHorizontal?: number;
};

/**
 * Shared round list row used by Home (Recent rounds) and Analyze (Matching rounds).
 * Keep both screens on this component so padding/icon alignment can't drift apart.
 */
export function RoundListRow({
  round,
  isWide = false,
  onPress,
  onShare,
  showTopBorder = true,
  paddingHorizontal,
}: Props) {
  return (
    <View
      style={[
        styles.row,
        showTopBorder && styles.rowBorder,
        paddingHorizontal != null ? { paddingHorizontal } : null,
      ]}
    >
      <Pressable
        style={styles.main}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Open ${round.courseName} round`}
      >
        <View style={styles.icon}>
          <IconGolf size={isWide ? 18 : 16} color={colors.subtle} />
        </View>
        <View style={styles.info}>
          <Text style={[styles.course, isWide && styles.courseLg]} numberOfLines={1}>
            {round.courseName}
          </Text>
          <Text style={[styles.meta, isWide && styles.metaLg]} numberOfLines={2}>
            {formatRoundMeta(round)}
          </Text>
        </View>
        <View style={styles.right}>
          <Text style={[styles.score, isWide && styles.scoreLg]}>{round.grossScore}</Text>
          <Text style={styles.diff}>diff {formatDifferentialDisplay(round.adjustedDiff)}</Text>
        </View>
      </Pressable>
      <Pressable
        style={styles.shareBtn}
        onPress={onShare}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Share ${round.courseName} round`}
      >
        <IconShareOutline size={18} color={colors.sage} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  rowBorder: {
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
  },
  main: {
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  info: { flex: 1, minWidth: 0 },
  course: { fontSize: 12, fontWeight: '700', color: colors.ink },
  courseLg: { fontSize: 14 },
  meta: { fontSize: 10, fontWeight: '600', color: colors.subtle, marginTop: 1 },
  metaLg: { fontSize: 11 },
  right: { alignItems: 'flex-end', flexShrink: 0 },
  score: { fontSize: 14, fontWeight: '700', color: colors.ink },
  scoreLg: { fontSize: 16 },
  diff: { fontSize: 10, fontWeight: '600', color: colors.sage },
  shareBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    flexShrink: 0,
  },
});
