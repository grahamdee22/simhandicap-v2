import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../../i18n';
import { colors } from '../../lib/constants';
import type { MatchPlayHoleResult } from '../../lib/tournamentTypes';

const OPTION_KEYS: MatchPlayHoleResult[] = ['W', 'L', 'H'];

const RESULT_I18N: Record<MatchPlayHoleResult, string> = {
  W: 'league.match.holeResultW',
  L: 'league.match.holeResultL',
  H: 'league.match.holeResultH',
};

type Props = {
  value: MatchPlayHoleResult | null;
  onChange: (result: MatchPlayHoleResult) => void;
};

export function MatchPlayHoleToggle({ value, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      {OPTION_KEYS.map((key) => {
        const on = value === key;
        const label = t(RESULT_I18N[key]);
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={[
              styles.btn,
              on && key === 'W' && styles.btnWin,
              on && key === 'L' && styles.btnLoss,
              on && key === 'H' && styles.btnHalve,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('tournament.holeToggle.resultA11y', { result: label })}
          >
            <Text style={[styles.btnTxt, on && styles.btnTxtOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4, marginTop: 4 },
  btn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  btnWin: { backgroundColor: colors.header, borderColor: colors.header },
  btnLoss: { backgroundColor: '#c45c5c', borderColor: '#c45c5c' },
  btnHalve: { backgroundColor: colors.muted, borderColor: colors.muted },
  btnTxt: { fontSize: 12, fontWeight: '700', color: colors.ink },
  btnTxtOn: { color: '#fff' },
});
