/**
 * Team count selection for Scramble / Best Ball tournament create flow.
 */

import type { ScrambleTeamDraft } from './scrambleTournament';

export const PRESET_TEAM_COUNT_OPTIONS = [2, 3, 4] as const;
export type PresetTeamCount = (typeof PRESET_TEAM_COUNT_OPTIONS)[number];

/** @deprecated Use PresetTeamCount — preset cards only. */
export type TeamCount = PresetTeamCount;

/** @deprecated Use PRESET_TEAM_COUNT_OPTIONS */
export const TEAM_COUNT_OPTIONS: PresetTeamCount[] = [...PRESET_TEAM_COUNT_OPTIONS];

export type TeamFormat = 'scramble' | 'best_ball';

export const CUSTOM_TEAM_COUNT_MIN = 5;
export const CUSTOM_TEAM_COUNT_MAX = 25;

/** Show the Custom card when group size exceeds comfortable 2–4 team splits. */
export const CUSTOM_TEAM_OPTION_PLAYER_THRESHOLD = 12;

export function isValidTeamSplit(
  playerCount: number,
  teamCount: number,
  format: TeamFormat
): boolean {
  if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > CUSTOM_TEAM_COUNT_MAX) {
    return false;
  }
  if (playerCount < teamCount * 2) return false;
  if (playerCount % teamCount !== 0) return false;
  const perTeam = playerCount / teamCount;
  if (perTeam < 2) return false;
  if (format === 'scramble' && perTeam % 2 !== 0) return false;
  return true;
}

export function allValidTeamCounts(playerCount: number, format: TeamFormat): number[] {
  const out: number[] = [];
  for (let k = 2; k <= CUSTOM_TEAM_COUNT_MAX; k++) {
    if (isValidTeamSplit(playerCount, k, format)) out.push(k);
  }
  return out;
}

export function validPresetTeamCounts(playerCount: number, format: TeamFormat): PresetTeamCount[] {
  return PRESET_TEAM_COUNT_OPTIONS.filter((k) => isValidTeamSplit(playerCount, k, format));
}

/** @deprecated Prefer validPresetTeamCounts */
export function validTeamCounts(playerCount: number, format: TeamFormat): PresetTeamCount[] {
  return validPresetTeamCounts(playerCount, format);
}

export function validCustomTeamCounts(playerCount: number, format: TeamFormat): number[] {
  return allValidTeamCounts(playerCount, format).filter((k) => k >= CUSTOM_TEAM_COUNT_MIN);
}

function pickMostEvenTeamCount(playerCount: number, candidates: number[]): number {
  if (candidates.length === 0) return 2;
  const idealPerTeam = 4;
  let best = candidates[0];
  let bestScore = Math.abs(playerCount / best - idealPerTeam);
  for (const k of candidates.slice(1)) {
    const score = Math.abs(playerCount / k - idealPerTeam);
    if (score < bestScore) {
      bestScore = score;
      best = k;
    } else if (score === bestScore) {
      if (k <= 4 && best > 4) best = k;
      else if (k <= 4 && best <= 4 && k < best) best = k;
      else if (k > 4 && best > 4 && k > best) best = k;
    }
  }
  return best;
}

export type TeamCountSuggestion = {
  suggested: number;
  validPreset: PresetTeamCount[];
  validCustom: number[];
  showsCustom: boolean;
  suggestedCustomDefault: number;
  alternateHint?: string;
};

export function suggestTeamCount(playerCount: number, format: TeamFormat): TeamCountSuggestion {
  const allValid = allValidTeamCounts(playerCount, format);
  const validPreset = validPresetTeamCounts(playerCount, format);
  const validCustom = validCustomTeamCounts(playerCount, format);

  const showsCustom =
    validCustom.length > 0 &&
    (validPreset.length === 0 || playerCount > CUSTOM_TEAM_OPTION_PLAYER_THRESHOLD);

  let suggested: number;
  if (validPreset.length > 0) {
    suggested = pickMostEvenTeamCount(playerCount, [...validPreset]);
    if (validPreset.includes(2)) suggested = 2;
    if (playerCount === 9 && validPreset.includes(3)) suggested = 3;
    if (playerCount === 8 && validPreset.includes(2)) suggested = 2;
    if (playerCount === 10 && validPreset.includes(2)) suggested = 2;
  } else if (validCustom.length > 0) {
    suggested = pickMostEvenTeamCount(playerCount, validCustom);
  } else {
    suggested = 2;
  }

  const suggestedCustomDefault =
    validCustom.length > 0
      ? validCustom.includes(suggested)
        ? suggested
        : pickMostEvenTeamCount(playerCount, validCustom)
      : CUSTOM_TEAM_COUNT_MIN;

  let alternateHint: string | undefined;
  if (playerCount === 8 && validPreset.includes(4)) {
    alternateHint = '4 teams of 2 also works well for this group.';
  }
  if (playerCount === 10 && validPreset.includes(2) && format === 'best_ball') {
    alternateHint = '2 teams of 5 is the most even split for 10 players.';
  }
  if (showsCustom && suggested >= CUSTOM_TEAM_COUNT_MIN) {
    const perTeam = playerCount / suggested;
    alternateHint = `Suggested: ${suggested} teams · ${perTeam} players per team.`;
  }

  return {
    suggested,
    validPreset,
    validCustom,
    showsCustom,
    suggestedCustomDefault,
    alternateHint,
  };
}

export function parseCustomTeamCountInput(raw: string): number | null {
  const t = raw.trim();
  if (!t || !/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

function invalidSplitMessage(
  playerCount: number,
  teamCount: number,
  format: TeamFormat
): string {
  if (teamCount > CUSTOM_TEAM_COUNT_MAX) {
    return `Maximum is ${CUSTOM_TEAM_COUNT_MAX} teams.`;
  }
  if (teamCount < CUSTOM_TEAM_COUNT_MIN) {
    return `Minimum is ${CUSTOM_TEAM_COUNT_MIN} teams.`;
  }
  if (playerCount % teamCount !== 0) {
    return `Doesn't divide evenly with ${playerCount} players.`;
  }
  const perTeam = Math.floor(playerCount / teamCount);
  if (format === 'scramble' && perTeam % 2 !== 0) {
    return `Scramble needs even-sized teams (${perTeam} per team won't work).`;
  }
  return 'Need at least 2 players on every team.';
}

export function validateCustomTeamCountInput(
  raw: string,
  playerCount: number,
  format: TeamFormat
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'Enter the number of teams.';
  const n = parseCustomTeamCountInput(raw);
  if (n === null) return 'Enter a whole number of teams.';
  if (n > CUSTOM_TEAM_COUNT_MAX) return `Maximum is ${CUSTOM_TEAM_COUNT_MAX} teams.`;
  if (n < CUSTOM_TEAM_COUNT_MIN) return `Minimum is ${CUSTOM_TEAM_COUNT_MIN} teams.`;
  if (!isValidTeamSplit(playerCount, n, format)) {
    return invalidSplitMessage(playerCount, n, format);
  }
  return null;
}

export function describeTeamCountOption(
  playerCount: number,
  teamCount: number,
  format: TeamFormat
): { title: string; sub: string; disabled: boolean } {
  if (!isValidTeamSplit(playerCount, teamCount, format)) {
    if (teamCount > 4 && teamCount > CUSTOM_TEAM_COUNT_MAX) {
      return {
        title: `${teamCount} teams`,
        sub: `Maximum is ${CUSTOM_TEAM_COUNT_MAX} teams.`,
        disabled: true,
      };
    }
    return {
      title: `${teamCount} teams`,
      sub: invalidSplitMessage(playerCount, teamCount, format),
      disabled: true,
    };
  }
  const perTeam = playerCount / teamCount;
  return {
    title: `${teamCount} teams`,
    sub: `${perTeam} players per team`,
    disabled: false,
  };
}

export function createEmptyTeams(count: number): ScrambleTeamDraft[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
    memberIds: [] as string[],
    designatedScorerUserId: null as string | null,
  }));
}

/** Randomly distribute players evenly across the selected number of teams. */
export function autoAssignMembersToTeams(
  memberUserIds: string[],
  teamCount: number,
  scramble: boolean
): ScrambleTeamDraft[] {
  const shuffled = [...memberUserIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const teams = createEmptyTeams(teamCount);
  shuffled.forEach((userId, i) => {
    teams[i % teamCount].memberIds.push(userId);
  });
  if (scramble) {
    for (const t of teams) {
      t.designatedScorerUserId = t.memberIds[0] ?? null;
    }
  }
  return teams;
}
