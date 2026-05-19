/**
 * Tournament format picker copy (SimCap Formats PRD v1 §1.3).
 */

import type { LeagueFormat } from './leagues';

export type TournamentFormatCopy = {
  key: LeagueFormat;
  title: string;
  sub: string;
};

/** Full descriptions shown on tournament create — format step. */
export const TOURNAMENT_FORMAT_COPY: TournamentFormatCopy[] = [
  {
    key: 'stroke',
    title: 'Stroke Play',
    sub: 'Total strokes win. Log your rounds, and the lowest average net score over the tournament wins. The standard format — same as how your SimCap handicap is calculated.',
  },
  {
    key: 'match_play',
    title: 'Match Play',
    sub: 'Win holes, not strokes. Each hole is played independently — win, lose, or halve. The player who wins the most holes wins the match. Used in the Ryder Cup.',
  },
  {
    key: 'scramble',
    title: 'Scramble',
    sub: 'Everyone hits, the team picks the best shot, and you all play from there. One team score per hole. The most popular format for group events — every player contributes no matter their handicap.',
  },
  {
    key: 'best_ball',
    title: 'Best Ball',
    sub: 'Everyone plays their own ball the whole round. The lowest score on each hole counts for the team. Log your round independently — SimCap calculates your team score automatically.',
  },
];

export function tournamentFormatCopyFor(key: LeagueFormat): TournamentFormatCopy {
  return TOURNAMENT_FORMAT_COPY.find((f) => f.key === key) ?? TOURNAMENT_FORMAT_COPY[0];
}
