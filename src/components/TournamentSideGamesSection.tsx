/**
 * Side Games board on tournament detail — Skins / Stableford leaderboards.
 * Nassau is shown on the match detail screen.
 */

import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from '../i18n';
import { colors } from '../lib/constants';
import type { SideGamesBoard } from '../lib/sideGameCompute';
import { hasAnySideGame, type LeagueSideGames } from '../lib/sideGames';

type Props = {
  flags: LeagueSideGames;
  board: SideGamesBoard | null;
  /** Optional Nassau summary lines (Match Play tournament-level blurb). */
  nassauHint?: string | null;
};

export function TournamentSideGamesSection({ flags, board, nassauHint }: Props) {
  const { t } = useTranslation();
  if (!hasAnySideGame(flags)) return null;

  const skinsBoard = board?.skinsBoard;
  const stablefordBoard = board?.stablefordBoard;
  const pot = board?.skins?.potRemaining ?? 0;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('league.detail.sideGames.title')}</Text>
      <Text style={styles.sub}>{t('league.detail.sideGames.sub')}</Text>

      {flags.skins ? (
        <View style={styles.block}>
          <Text style={styles.gameTitle}>{t('league.detail.sideGames.skins')}</Text>
          {!skinsBoard || skinsBoard.every((r) => r.skins === 0) ? (
            <Text style={styles.empty}>{t('league.detail.sideGames.skinsEmpty')}</Text>
          ) : (
            skinsBoard.map((row) => (
              <View key={row.id} style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>
                  {row.name}
                </Text>
                <Text style={styles.value}>
                  {t('league.detail.sideGames.skinsCount', { count: row.skins })}
                </Text>
              </View>
            ))
          )}
          {pot > 0 ? (
            <Text style={styles.pot}>
              {t('league.detail.sideGames.skinsPot', { count: pot })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {flags.stableford ? (
        <View style={styles.block}>
          <Text style={styles.gameTitle}>{t('league.detail.sideGames.stableford')}</Text>
          {!stablefordBoard || stablefordBoard.every((r) => r.points === 0) ? (
            <Text style={styles.empty}>{t('league.detail.sideGames.stablefordEmpty')}</Text>
          ) : (
            stablefordBoard.map((row) => (
              <View key={row.id} style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>
                  {row.name}
                </Text>
                <Text style={styles.value}>
                  {t('league.detail.sideGames.stablefordPoints', { count: row.points })}
                </Text>
              </View>
            ))
          )}
        </View>
      ) : null}

      {flags.nassau ? (
        <View style={styles.block}>
          <Text style={styles.gameTitle}>{t('league.detail.sideGames.nassau')}</Text>
          <Text style={styles.empty}>
            {nassauHint ?? t('league.detail.sideGames.nassauHint')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  sub: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
    marginBottom: 8,
  },
  block: {
    marginTop: 12,
  },
  gameTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    gap: 12,
  },
  name: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  empty: {
    fontSize: 13,
    color: colors.muted,
  },
  pot: {
    marginTop: 4,
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
  },
});
