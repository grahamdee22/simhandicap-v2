import { StyleSheet, View } from 'react-native';
import { colors } from '@/src/lib/constants';
import { SimCapLogoHero, SIM_CAP_LOGO_ASPECT } from '@/src/components/SimCapLogoHero';

/**
 * Forest-green panel so the hero wordmark (light type) matches auth / home branding.
 */
export function AuthBrandBanner() {
  return (
    <View style={styles.panel}>
      <SimCapLogoHero style={styles.logo} wordmarkSize={36} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.header,
    borderRadius: 16,
    minHeight: 200,
    paddingVertical: 22,
    paddingHorizontal: 18,
    marginBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: {
    width: '100%',
    maxWidth: 280,
    aspectRatio: SIM_CAP_LOGO_ASPECT,
  },
});
