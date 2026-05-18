import { StyleSheet } from 'react-native';
import { colors } from './constants';

/** Small caps section labels (TOURNAMENTS, MATCH PLAY style). */
export const leagueSectionLabelStyles = StyleSheet.create({
  text: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});
