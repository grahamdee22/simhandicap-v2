import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/src/lib/constants';
import { SimCapLogoHero, SIM_CAP_LOGO_ASPECT } from '@/src/components/SimCapLogoHero';

type Props = {
  variant: 'signIn' | 'signUp';
};

/**
 * Forest-green panel so the hero wordmark (light type) matches auth / home branding.
 */
export function AuthBrandBanner({ variant }: Props) {
  return (
    <View style={styles.panel}>
      <SimCapLogoHero style={styles.logo} />
      {variant === 'signIn' ? (
        <Text style={styles.tagline}>The sim golf handicap app</Text>
      ) : (
        <Text style={styles.welcome}>Welcome to SimCap — beta</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.header,
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 18,
    marginBottom: 4,
    alignItems: 'center',
    overflow: 'hidden',
  },
  logo: {
    width: '100%',
    maxWidth: 280,
    aspectRatio: SIM_CAP_LOGO_ASPECT,
  },
  tagline: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 21,
    color: 'rgba(255,255,255,0.92)',
    fontWeight: '500',
    textAlign: 'center',
  },
  welcome: {
    marginTop: 12,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '600',
    color: '#fff',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
});
