import { Ionicons } from '@expo/vector-icons';
import { getHeaderTitle } from '@react-navigation/elements';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/constants';
import { HeaderInstagramAndSimCap } from './HeaderInstagramSimCap';

type Props = NativeStackHeaderProps & {
  /** Nested stack roots have no `back`; set this to return to the parent screen. */
  forceBack?: boolean;
  onBackPress?: () => void;
};

/**
 * Dark-green stack header that matches tab-screen chrome: white title, Instagram + SimCap
 * mark with no native liquid-glass / pill wrapper around headerRight.
 */
export function ForestStackHeader({
  navigation,
  route,
  options,
  back,
  forceBack = false,
  onBackPress,
}: Props) {
  const insets = useSafeAreaInsets();
  const title = getHeaderTitle(options, route.name);
  const showBack = Boolean(back) || forceBack;

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        {showBack ? (
          <Pressable
            onPress={() => {
              if (onBackPress) {
                onBackPress();
                return;
              }
              if (navigation.canGoBack()) navigation.goBack();
            }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={10}
            style={({ pressed }) => [styles.backHit, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </Pressable>
        ) : null}
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <HeaderInstagramAndSimCap />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.header,
  },
  bar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 2,
  },
  backHit: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 40,
    minHeight: 44,
    marginRight: 2,
  },
  pressed: { opacity: 0.85 },
  title: {
    flex: 1,
    minWidth: 0,
    color: '#fff',
    fontWeight: '700',
    fontSize: 22,
    marginRight: 8,
  },
});
