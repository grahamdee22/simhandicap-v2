/**
 * Scramble tournament helpers (PRD §3, §6.2, §6.6).
 */

import type { DbLeagueTeamRow } from './leagues';

export type ScrambleTeamDraft = {
  id: string;
  name: string;
  memberIds: string[];
  designatedScorerUserId: string | null;
};

/** PRD §6.6 — scramble teams must have an even number of players (min 2). */
export function validateScrambleTeamSizes(
  teams: { name: string; memberIds: string[] }[]
): string | null {
  for (const t of teams) {
    const n = t.memberIds.length;
    if (n < 2) {
      return `${t.name} needs at least 2 players for Scramble.`;
    }
    if (n % 2 !== 0) {
      return `${t.name} must have an even number of players (Scramble requires pairs).`;
    }
  }
  return null;
}

export function validateScrambleDesignatedScorers(teams: ScrambleTeamDraft[]): string | null {
  for (const t of teams) {
    if (!t.designatedScorerUserId) {
      return `Choose a designated scorer for ${t.name}.`;
    }
    if (!t.memberIds.includes(t.designatedScorerUserId)) {
      return `Designated scorer for ${t.name} must be on that team.`;
    }
  }
  return null;
}

/** PRD §3.3 — 15% lowest + 85% highest index (display / future net). */
export function computeScrambleTeamIndex(memberIndexes: number[]): number | null {
  const sorted = memberIndexes.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  return Math.round((low * 0.15 + high * 0.85) * 10) / 10;
}

export function isUserDesignatedScorerForTeam(
  team: Pick<DbLeagueTeamRow, 'designated_scorer_id'> | null | undefined,
  userId: string
): boolean {
  if (!team) return false;
  if (!team.designated_scorer_id) return true;
  return team.designated_scorer_id === userId;
}

export function designatedScorerLabel(
  team: Pick<DbLeagueTeamRow, 'designated_scorer_id'> | null | undefined,
  displayNames: Record<string, string>
): string | null {
  if (!team?.designated_scorer_id) return null;
  return displayNames[team.designated_scorer_id] ?? 'Designated scorer';
}
