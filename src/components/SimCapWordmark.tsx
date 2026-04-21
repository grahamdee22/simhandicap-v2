import { isLoaded } from 'expo-font';
import { Platform, StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

const CAP_GREEN = '#52b788';

/** Bold system serif while Playfair is not yet registered (e.g. before root `useFonts` completes). */
const SERIF_FALLBACK = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});

const PLAYFAIR = 'PlayfairDisplay_900Black';

type Props = {
  /** Logotype size (landing-style ~32–36). */
  fontSize?: number;
  style?: StyleProp<TextStyle>;
  /** When false, hides this text from the accessibility tree (e.g. inside a parent `image` label). */
  accessible?: boolean;
};

/**
 * Inline “SimCap” logotype: Sim (white) + Cap (green), Playfair Display Black when loaded.
 */
export function SimCapWordmark({ fontSize = 34, style, accessible = true }: Props) {
  const playfairReady = isLoaded(PLAYFAIR);
  const fontFamily = playfairReady ? PLAYFAIR : SERIF_FALLBACK;

  return (
    <Text
      accessible={accessible}
      accessibilityRole={accessible ? 'header' : undefined}
      accessibilityLabel={accessible ? 'SimCap' : undefined}
      style={[
        {
          fontSize,
          fontFamily,
          letterSpacing: -0.5,
          ...(playfairReady ? {} : { fontWeight: '700' as const }),
        },
        style,
      ]}
    >
      <Text style={styles.sim}>Sim</Text>
      <Text style={styles.cap}>Cap</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  sim: { color: '#ffffff' },
  cap: { color: CAP_GREEN },
});
