import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';
import { useTranslation } from '../i18n';

type Props = {
  onPress: () => void;
  accessibilityLabel?: string;
};

/** White chevron for tab/stack headers — matches ForestStackHeader back affordance. */
export function HeaderBackButton({ onPress, accessibilityLabel }: Props) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? t('match.create.goBack')}
      hitSlop={10}
      style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
    >
      <Ionicons name="chevron-back" size={28} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 40,
    minHeight: 44,
    marginLeft: 4,
  },
  pressed: { opacity: 0.85 },
});
