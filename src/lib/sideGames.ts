/**
 * Side-game flags and format compatibility for group tournaments.
 * Additive only — never changes core tournament results.
 */

import type { LeagueFormat } from './leagues';

export const SIDE_GAME_KEYS = ['skins', 'nassau', 'stableford'] as const;
export type SideGameKey = (typeof SIDE_GAME_KEYS)[number];

export type LeagueSideGames = {
  skins?: boolean;
  nassau?: boolean;
  stableford?: boolean;
};

export function emptySideGames(): LeagueSideGames {
  return {};
}

export function normalizeSideGames(raw: unknown): LeagueSideGames {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptySideGames();
  const o = raw as Record<string, unknown>;
  const out: LeagueSideGames = {};
  if (o.skins === true) out.skins = true;
  if (o.nassau === true) out.nassau = true;
  if (o.stableford === true) out.stableford = true;
  return out;
}

export function sideGamesPayload(flags: LeagueSideGames): LeagueSideGames {
  const out: LeagueSideGames = {};
  if (flags.skins) out.skins = true;
  if (flags.nassau) out.nassau = true;
  if (flags.stableford) out.stableford = true;
  return out;
}

export function hasAnySideGame(flags: LeagueSideGames | null | undefined): boolean {
  if (!flags) return false;
  return !!(flags.skins || flags.nassau || flags.stableford);
}

/** Side games offered for a format in the create wizard (Stroke Play: none in v1). */
export function availableSideGamesForFormat(format: LeagueFormat): SideGameKey[] {
  switch (format) {
    case 'match_play':
      return ['skins', 'nassau', 'stableford'];
    case 'scramble':
    case 'best_ball':
      return ['skins', 'stableford'];
    case 'stroke':
    default:
      return [];
  }
}

export function filterSideGamesForFormat(
  flags: LeagueSideGames,
  format: LeagueFormat
): LeagueSideGames {
  const allowed = new Set(availableSideGamesForFormat(format));
  const out: LeagueSideGames = {};
  if (flags.skins && allowed.has('skins')) out.skins = true;
  if (flags.nassau && allowed.has('nassau')) out.nassau = true;
  if (flags.stableford && allowed.has('stableford')) out.stableford = true;
  return out;
}
