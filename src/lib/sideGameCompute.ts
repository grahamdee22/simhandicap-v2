/**
 * Build side-game inputs from tournament hole rows and run skins / Stableford / Nassau.
 * Derives live on read (no persisted side-game results) so score edits recompute cleanly.
 */

import {
  DEFAULT_STROKE_INDEX_BY_HOLE,
  holeNet,
  indexForCourseHandicap,
  strokeIndexForCourse,
  whsCourseHandicapFromIndex,
} from './netHandicap';
import type { CourseSeed } from './courses';
import { compareMatchPlayGrossHoles, type MatchPlayCompareHandicap } from './matchPlayGrossCompare';
import { computeNassau, type NassauResult } from './nassau';
import { computeSkins, skinsLeaderboard, type SkinsResult } from './skins';
import {
  computeStableford,
  stablefordLeaderboard,
  type StablefordResult,
} from './stableford';
import type { LeagueSideGames } from './sideGames';
import type {
  DbTournamentHoleScoreRow,
  DbTournamentTeamHoleScoreRow,
  HolesPerRound,
} from './tournamentTypes';
import type { TournamentHoleInput } from './tournamentHoleScores';

export type SideGameCompetitor = {
  id: string;
  displayName: string;
};

export type MatchPlaySideGameCard = {
  userId: string;
  displayName: string;
  holes: TournamentHoleInput[];
  /** Course handicap for full-CH net (Skins/Stableford). Ignored when useHandicap is false. */
  courseHandicap: number;
};

export type TeamSideGameCard = {
  teamId: string;
  displayName: string;
  /** Net per hole (scorecard 1..N). null when missing or partial. */
  nets: (number | null)[];
};

/** Full-CH nets for one Match Play (or individual) scorecard. */
export function netsFromGrossCard(opts: {
  holes: TournamentHoleInput[];
  holeCount: number;
  useHandicap: boolean;
  courseHandicap: number;
  strokeIndexByHole: number[];
  nine: 'front' | 'back' | null;
}): (number | null)[] {
  const { holes, holeCount, useHandicap, courseHandicap, strokeIndexByHole, nine } = opts;
  const nets: (number | null)[] = Array.from({ length: holeCount }, () => null);
  for (const h of holes) {
    if (h.gross_score == null || !Number.isFinite(h.gross_score)) continue;
    const idx = h.hole_number - 1;
    if (idx < 0 || idx >= holeCount) continue;
    if (!useHandicap) {
      nets[idx] = h.gross_score;
      continue;
    }
    const courseHole =
      holeCount === 9 && nine === 'back' ? h.hole_number + 9 : h.hole_number;
    nets[idx] = holeNet(h.gross_score, courseHole, courseHandicap, strokeIndexByHole);
  }
  return nets;
}

/**
 * Team nets from `tournament_team_hole_scores`.
 * Picks the latest round_date per team that has the most non-partial holes.
 * Honors is_partial: partial holes are null (not comparable).
 */
export function teamCardsFromTeamHoleScores(
  rows: DbTournamentTeamHoleScoreRow[],
  teams: SideGameCompetitor[],
  holeCount: number,
  useHandicap: boolean
): TeamSideGameCard[] {
  const byTeam = new Map<string, DbTournamentTeamHoleScoreRow[]>();
  for (const r of rows) {
    const list = byTeam.get(r.league_team_id) ?? [];
    list.push(r);
    byTeam.set(r.league_team_id, list);
  }

  return teams.map((team) => {
    const teamRows = byTeam.get(team.id) ?? [];
    const byDate = new Map<string, DbTournamentTeamHoleScoreRow[]>();
    for (const r of teamRows) {
      const list = byDate.get(r.round_date) ?? [];
      list.push(r);
      byDate.set(r.round_date, list);
    }
    let bestDate: string | null = null;
    let bestFilled = -1;
    for (const [date, list] of byDate) {
      const filled = list.filter((h) => !h.is_partial).length;
      if (filled > bestFilled || (filled === bestFilled && (bestDate == null || date > bestDate))) {
        bestFilled = filled;
        bestDate = date;
      }
    }
    const nets: (number | null)[] = Array.from({ length: holeCount }, () => null);
    if (bestDate) {
      for (const r of byDate.get(bestDate) ?? []) {
        const idx = r.hole_number - 1;
        if (idx < 0 || idx >= holeCount) continue;
        if (r.is_partial) continue;
        const net = useHandicap
          ? r.team_net_score != null && Number.isFinite(Number(r.team_net_score))
            ? Number(r.team_net_score)
            : Number(r.team_score)
          : Number(r.team_score);
        nets[idx] = net;
      }
    }
    return { teamId: team.id, displayName: team.displayName, nets };
  });
}

export function courseHandicapForSideGame(opts: {
  index: number | null;
  useHandicap: boolean;
  course: CourseSeed | null;
  holesPlayed: '18' | 'front' | 'back';
  platform?: keyof CourseSeed['byPlatform'];
}): number {
  if (!opts.useHandicap || opts.index == null || !Number.isFinite(opts.index)) return 0;
  const course = opts.course;
  if (!course) return Math.round(indexForCourseHandicap(opts.index, opts.holesPlayed));
  const tee =
    course.tees?.find((t) => t.name === course.defaultTee) ??
    course.tees?.[Math.floor((course.tees.length - 1) / 2)] ??
    course.tees?.[0];
  const platformKey = opts.platform ?? 'gspro';
  const plat = course.byPlatform?.[platformKey] ?? Object.values(course.byPlatform ?? {})[0];
  const rating = tee?.rating ?? plat?.rating;
  const slope = tee?.slope ?? plat?.slope;
  const par = (tee?.par != null ? tee.par : null) ?? course.pars.reduce((s, p) => s + p, 0);
  if (
    rating == null ||
    !Number.isFinite(rating) ||
    slope == null ||
    !Number.isFinite(slope) ||
    slope === 0
  ) {
    return Math.round(indexForCourseHandicap(opts.index, opts.holesPlayed));
  }
  return whsCourseHandicapFromIndex(
    indexForCourseHandicap(opts.index, opts.holesPlayed),
    rating,
    slope,
    par
  );
}

export function strokeIndexForSideGame(course: CourseSeed | null): number[] {
  if (!course) return [...DEFAULT_STROKE_INDEX_BY_HOLE];
  return strokeIndexForCourse(course);
}

export function parsForSideGame(
  course: CourseSeed | null,
  holeCount: number,
  nine: 'front' | 'back' | null
): number[] {
  const fallback = Array.from({ length: holeCount }, () => 4);
  if (!course?.pars?.length) return fallback;
  if (holeCount === 9) {
    const slice = nine === 'back' ? course.pars.slice(9, 18) : course.pars.slice(0, 9);
    if (slice.length >= 9) return slice.slice(0, 9);
  }
  if (course.pars.length >= holeCount) return course.pars.slice(0, holeCount);
  return fallback;
}

export type SideGamesBoard = {
  skins: SkinsResult | null;
  skinsBoard: { id: string; name: string; skins: number }[] | null;
  stableford: StablefordResult | null;
  stablefordBoard: { id: string; name: string; points: number }[] | null;
};

export function computeTeamSideGamesBoard(opts: {
  flags: LeagueSideGames;
  cards: TeamSideGameCard[];
  holeCount: number;
  pars: number[];
}): SideGamesBoard {
  const { flags, cards, holeCount, pars } = opts;
  const participants = cards.map((c) => ({ id: c.teamId, nets: c.nets }));
  const nameOf = (id: string) => cards.find((c) => c.teamId === id)?.displayName ?? id;

  let skins: SkinsResult | null = null;
  let skinsBoard: SideGamesBoard['skinsBoard'] = null;
  if (flags.skins && cards.length >= 2) {
    skins = computeSkins(participants, holeCount);
    skinsBoard = skinsLeaderboard(skins, nameOf);
  }

  let stableford: StablefordResult | null = null;
  let stablefordBoard: SideGamesBoard['stablefordBoard'] = null;
  if (flags.stableford && cards.length >= 1) {
    stableford = computeStableford(participants, pars, holeCount);
    stablefordBoard = stablefordLeaderboard(stableford, nameOf);
  }

  return { skins, skinsBoard, stableford, stablefordBoard };
}

export function computeIndividualSideGamesBoard(opts: {
  flags: LeagueSideGames;
  cards: MatchPlaySideGameCard[];
  holeCount: number;
  useHandicap: boolean;
  strokeIndexByHole: number[];
  nine: 'front' | 'back' | null;
  pars: number[];
}): SideGamesBoard {
  const { flags, cards, holeCount, useHandicap, strokeIndexByHole, nine, pars } = opts;
  const participants = cards.map((c) => ({
    id: c.userId,
    nets: netsFromGrossCard({
      holes: c.holes,
      holeCount,
      useHandicap,
      courseHandicap: c.courseHandicap,
      strokeIndexByHole,
      nine,
    }),
  }));
  const nameOf = (id: string) => cards.find((c) => c.userId === id)?.displayName ?? id;

  let skins: SkinsResult | null = null;
  let skinsBoard: SideGamesBoard['skinsBoard'] = null;
  if (flags.skins && cards.length >= 2) {
    skins = computeSkins(participants, holeCount);
    skinsBoard = skinsLeaderboard(skins, nameOf);
  }

  let stableford: StablefordResult | null = null;
  let stablefordBoard: SideGamesBoard['stablefordBoard'] = null;
  if (flags.stableford && cards.length >= 1) {
    stableford = computeStableford(participants, pars, holeCount);
    stablefordBoard = stablefordLeaderboard(stableford, nameOf);
  }

  return { skins, skinsBoard, stableford, stablefordBoard };
}

export function computeNassauForPairing(opts: {
  p1Holes: TournamentHoleInput[];
  p2Holes: TournamentHoleInput[];
  holeCount: number;
  handicap?: MatchPlayCompareHandicap | null;
}): NassauResult {
  const compared = compareMatchPlayGrossHoles(
    opts.p1Holes,
    opts.p2Holes,
    opts.holeCount,
    opts.handicap
  );
  return computeNassau(compared.results, opts.holeCount);
}

/** Latest complete-ish scorecard per user from hole rows + league rounds. */
export function pickLatestHoleCardsByUser(
  holeRows: DbTournamentHoleScoreRow[],
  holeCount: number
): Map<string, TournamentHoleInput[]> {
  const byRound = new Map<string, { userId: string; holes: TournamentHoleInput[] }>();
  for (const r of holeRows) {
    let entry = byRound.get(r.league_round_id);
    if (!entry) {
      entry = {
        userId: r.user_id,
        holes: Array.from({ length: holeCount }, (_, i) => ({
          hole_number: i + 1,
          gross_score: null,
        })),
      };
      byRound.set(r.league_round_id, entry);
    }
    const idx = r.hole_number - 1;
    if (idx >= 0 && idx < holeCount) {
      entry.holes[idx] = {
        hole_number: r.hole_number,
        gross_score: r.gross_score,
        result: r.result,
        is_team_score: r.is_team_score,
      };
    }
  }

  const filledCount = (holes: TournamentHoleInput[]) =>
    holes.filter((h) => h.gross_score != null && Number.isFinite(h.gross_score)).length;

  const best = new Map<string, TournamentHoleInput[]>();
  for (const entry of byRound.values()) {
    const prev = best.get(entry.userId);
    if (!prev || filledCount(entry.holes) >= filledCount(prev)) {
      best.set(entry.userId, entry.holes);
    }
  }
  return best;
}

export function expectedSideGameHoleCount(holesPerRound: HolesPerRound | string | null | undefined): number {
  return holesPerRound === '9' ? 9 : 18;
}

// silence unused in case tree-shaking; courseHoleToScorecardIndex kept for callers
void courseHoleToScorecardIndex;
