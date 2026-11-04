/**
 * Nassau side game for Match Play — front 9 / back 9 / overall (or single overall on 9-hole).
 * Uses Match Play hole results (W/L/H) already computed via relative stroke gift.
 */

import type { MatchPlayHoleResult } from './tournamentTypes';

export type NassauSegmentKey = 'front' | 'back' | 'overall';

export type NassauSegmentResult = {
  key: NassauSegmentKey;
  /** Holes included (scorecard hole numbers). */
  holes: number[];
  /** True when both sides have a result for every hole in the segment. */
  resolved: boolean;
  /** Wins for player 1 in the segment (null if unresolved). */
  p1Wins: number | null;
  p2Wins: number | null;
  halved: number | null;
  /** 'p1' | 'p2' | 'halved' | null (unresolved). */
  winner: 'p1' | 'p2' | 'halved' | null;
};

export type NassauResult = {
  segments: NassauSegmentResult[];
};

function segmentHoles(holeCount: number): { key: NassauSegmentKey; holes: number[] }[] {
  if (holeCount <= 9) {
    return [
      {
        key: 'overall',
        holes: Array.from({ length: holeCount }, (_, i) => i + 1),
      },
    ];
  }
  return [
    { key: 'front', holes: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { key: 'back', holes: [10, 11, 12, 13, 14, 15, 16, 17, 18] },
    {
      key: 'overall',
      holes: Array.from({ length: holeCount }, (_, i) => i + 1),
    },
  ];
}

/**
 * @param results Per scorecard hole, from player 1's perspective (W = p1 won the hole).
 *                null means that hole is not yet comparable.
 */
export function computeNassau(
  results: (MatchPlayHoleResult | null)[],
  holeCount: number
): NassauResult {
  const segments = segmentHoles(holeCount).map(({ key, holes }) => {
    let p1Wins = 0;
    let p2Wins = 0;
    let halved = 0;
    let resolved = true;

    for (const holeNumber of holes) {
      const r = results[holeNumber - 1];
      if (r == null) {
        resolved = false;
        break;
      }
      if (r === 'W') p1Wins += 1;
      else if (r === 'L') p2Wins += 1;
      else halved += 1;
    }

    if (!resolved) {
      return {
        key,
        holes,
        resolved: false,
        p1Wins: null,
        p2Wins: null,
        halved: null,
        winner: null,
      } satisfies NassauSegmentResult;
    }

    let winner: NassauSegmentResult['winner'] = 'halved';
    if (p1Wins > p2Wins) winner = 'p1';
    else if (p2Wins > p1Wins) winner = 'p2';

    return {
      key,
      holes,
      resolved: true,
      p1Wins,
      p2Wins,
      halved,
      winner,
    } satisfies NassauSegmentResult;
  });

  return { segments };
}
