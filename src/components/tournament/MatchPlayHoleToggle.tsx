import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../lib/constants';
import type { MatchPlayHoleResult } from '../../lib/tournamentTypes';

const OPTIONS: { key: MatchPlayHoleResult; label: string }[] = [
  { key: 'W', label: 'W' },
  { key: 'L', label: 'L' },
  { key: 'H', label: 'H' },
];

type Props = {
  value: MatchPlayHoleResult | null;
  onChange: (result: MatchPlayHoleResult) => void;
};

export function MatchPlayHoleToggle({ value, onChange }: Props) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((opt) => {
        const on = value === opt.key;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={[
              styles.btn,
              on && opt.key === 'W' && styles.btnWin,
              on && opt.key === 'L' && styles.btnLoss,
              on && opt.key === 'H' && styles.btnHalve,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Hole result ${opt.label}`}
          >
            <Text style={[styles.btnTxt, on && styles.btnTxtOn]}>{opt.label}</Text>
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
