import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../../i18n';
import { colors } from '../../lib/constants';
import type { GrossReconciliation } from '../../lib/tournamentHoleScores';

type Props = {
  reconciliation: GrossReconciliation;
};

export function ScoreReconciliationBanner({ reconciliation }: Props) {
  const { t } = useTranslation();
  if (reconciliation.matches || reconciliation.holeTotal == null) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.txt}>
        {t('tournament.reconciliation.mismatch', {
          holeTotal: reconciliation.holeTotal,
          loggedGross: reconciliation.loggedGross,
        })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#fff8e6',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e6c84a',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  txt: {
    fontSize: 13,
    color: colors.ink,
    lineHeight: 18,
  },
});
