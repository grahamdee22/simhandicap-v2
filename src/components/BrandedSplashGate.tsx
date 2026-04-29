import { useAuth } from '@/src/auth/AuthContext';
import { SimCapLogoHero, SIM_CAP_LOGO_ASPECT } from '@/src/components/SimCapLogoHero';
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

const SPLASH_BG = '#1a3a2a';
const HOLD_MS = 1250;
const FADE_MS = 450;

type Props = {
  children: React.ReactNode;
};

/**
 * Branded intro: SimCap lockup on forest background, then cross-fade into the app (native-safe `Animated`).
 */
export function BrandedSplashGate({ children }: Props) {
  const { loading } = useAuth();
  const splashOpacity = useRef(new Animated.Value(1)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (loading) return;

    let cancelled = false;
    const holdTimer = setTimeout(() => {
      if (cancelled) return;
      Animated.parallel([
        Animated.timing(splashOpacity, {
          toValue: 0,
          duration: FADE_MS,
          useNativeDriver: true,
        }),
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: FADE_MS,
          useNativeDriver: true,
        }),
      ]).start(({ finished: ok }) => {
        if (!cancelled && ok) setFinished(true);
      });
    }, HOLD_MS);

    return () => {
      cancelled = true;
      clearTimeout(holdTimer);
    };
  }, [loading, splashOpacity, contentOpacity]);

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.flex, { opacity: contentOpacity }]}>{children}</Animated.View>
      {!finished ? (
        <Animated.View
          pointerEvents="auto"
          style={[styles.splash, { opacity: splashOpacity }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={styles.logoSlot}>
            <SimCapLogoHero
              showTagline={false}
              wordmarkSize={36}
              style={[styles.logo, { aspectRatio: SIM_CAP_LOGO_ASPECT }]}
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', minHeight: 0 },
  flex: { flex: 1, width: '100%', minHeight: 0 },
  splash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SPLASH_BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoSlot: {
    width: '100%',
    maxWidth: 300,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  logo: {
    width: '100%',
    maxWidth: 280,
  },
});
