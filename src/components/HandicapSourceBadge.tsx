import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../i18n';
import { colors } from '../lib/constants';
import type { EffectiveHandicapSource } from '../lib/effectiveHandicap';

const GHIN_BLUE = '#2563eb';

type Props = {
  source: EffectiveHandicapSource | null;
};

export function HandicapSourceBadge({ source }: Props) {
  const { t } = useTranslation();

  if (source === 'simcap') {
    return (
      <View style={[styles.badge, styles.simcap]}>
        <Text style={[styles.txt, styles.simcapTxt]}>{t('handicap.sourceSimcap')}</Text>
      </View>
    );
  }
  if (source === 'ghin') {
    return (
      <View style={[styles.badge, styles.ghin]}>
        <Text style={[styles.txt, styles.ghinTxt]}>{t('handicap.sourceGhin')}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.none]}>
      <Text style={[styles.txt, styles.noneTxt]}>{t('handicap.sourceNone')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 6,
  },
  txt: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
  simcap: { backgroundColor: colors.accentSoft },
  simcapTxt: { color: colors.accent },
  ghin: { backgroundColor: '#dbeafe' },
  ghinTxt: { color: GHIN_BLUE },
  none: { backgroundColor: '#f0f0f0' },
  noneTxt: { color: colors.muted },
});
