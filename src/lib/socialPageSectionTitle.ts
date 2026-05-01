import { StyleSheet } from 'react-native';
import { colors } from './constants';

/**
 * Primary section titles on Social (Match Play, My Groups, Crew Match Calculator) — same look as MatchPlayHub
 * `sectionTitle` / “Recent matches”, scaled up.
 */
export const socialPageSectionTitleStyles = StyleSheet.create({
  text: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
  },
});
