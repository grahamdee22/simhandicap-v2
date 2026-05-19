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

/** Section header row + ℹ️ button (My Groups, Tournaments, Crew Match Calculator). */
export const socialSectionHeaderStyles = StyleSheet.create({
  headerWrap: {
    paddingTop: 4,
    paddingBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoBtn: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#7aa390',
    backgroundColor: '#e8f2ed',
  },
  infoBtnTxt: { fontSize: 11, fontWeight: '700', color: '#1a3d2b', lineHeight: 12 },
});
