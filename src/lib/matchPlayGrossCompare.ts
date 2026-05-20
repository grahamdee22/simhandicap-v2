import type { TournamentHoleInput } from './tournamentHoleScores';
import type { MatchPlayHoleResult } from './tournamentTypes';

export type MatchPlayRoundSummary = {
  wins: number;
  losses: number;
  halved: number;
  net_holes: number;
};

/** Compare gross scores hole-by-hole from player one's perspective. */
export function compareMatchPlayGrossHoles(
  myHoles: TournamentHoleInput[],
  opponentHoles: TournamentHoleInput[]
): { results: (MatchPlayHoleResult | null)[]; summary: MatchPlayRoundSummary } {
  let wins = 0;
  let losses = 0;
  let halved = 0;
  const results: (MatchPlayHoleResult | null)[] = [];

  for (let i = 0; i < 18; i += 1) {
    const g1 = myHoles[i]?.gross_score;
    const g2 = opponentHoles[i]?.gross_score;
    if (g1 == null || g2 == null || !Number.isFinite(g1) || !Number.isFinite(g2)) {
      results.push(null);
      continue;
    }
    if (g1 < g2) {
      results.push('W');
      wins += 1;
    } else if (g2 < g1) {
      results.push('L');
      losses += 1;
    } else {
      results.push('H');
      halved += 1;
    }
  }

  return {
    results,
    summary: { wins, losses, halved, net_holes: wins - losses },
  };
}

export function countComparedMatchPlayHoles(
  myHoles: TournamentHoleInput[],
  opponentHoles: TournamentHoleInput[]
): number {
  let n = 0;
  for (let i = 0; i < 18; i += 1) {
    const g1 = myHoles[i]?.gross_score;
    const g2 = opponentHoles[i]?.gross_score;
    if (g1 != null && g2 != null && Number.isFinite(g1) && Number.isFinite(g2)) n += 1;
  }
  return n;
}

export function formatMatchPlayStatus(summary: MatchPlayRoundSummary, throughHole: number): string {
  const { net_holes: net } = summary;
  const through = Math.min(18, Math.max(0, throughHole));
  if (net === 0) {
    return through > 0 ? `ALL SQUARE through ${through}` : 'ALL SQUARE';
  }
  if (net > 0) return `${net} UP through ${through}`;
  return `${Math.abs(net)} DOWN through ${through}`;
}
