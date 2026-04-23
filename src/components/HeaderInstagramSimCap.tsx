import { Ionicons } from '@expo/vector-icons';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { SIMCAP_INSTAGRAM_URL } from '../lib/socialLinks';
import { SimCapMark } from './SimCapMark';

const HEADER_ICON_COLOR = '#fff';
/** Sits beside 42pt SimCap mark; matches typical nav icon scale. */
const HEADER_INSTAGRAM_SIZE = 26;

export function openSimCapInstagram() {
  void Linking.openURL(SIMCAP_INSTAGRAM_URL);
}

/** Home hero (forest header): Instagram only, top-right alignment via parent row. */
export function HomeHeroInstagramButton() {
  return (
    <Pressable
      onPress={openSimCapInstagram}
      style={({ pressed }) => [styles.homeInstaHit, pressed && styles.pressed]}
      accessibilityRole="link"
      accessibilityLabel="SimCap on Instagram"
    >
      <Ionicons name="logo-instagram" size={28} color={HEADER_ICON_COLOR} />
    </Pressable>
  );
}

/** Tab stack headers: Instagram left of SimCap mark (same tint as header). */
export function HeaderInstagramAndSimCap() {
  return (
    <View style={styles.headerRightRow}>
      <Pressable
        onPress={openSimCapInstagram}
        style={({ pressed }) => [styles.headerInstaHit, pressed && styles.pressed]}
        accessibilityRole="link"
        accessibilityLabel="SimCap on Instagram"
      >
        <Ionicons name="logo-instagram" size={HEADER_INSTAGRAM_SIZE} color={HEADER_ICON_COLOR} />
      </Pressable>
      <View style={styles.headerMarkWrap}>
        <SimCapMark size={32} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.85 },
  homeInstaHit: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 44,
    minHeight: 44,
    marginTop: -2,
  },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
  },
  headerInstaHit: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 44,
    minHeight: 48,
    marginRight: 2,
  },
  headerMarkWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingLeft: 4,
  },
});
