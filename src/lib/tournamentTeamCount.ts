/**
 * Team size selection for Scramble / Best Ball tournament create flow.
 * User picks players per team; SimCap derives team count.
 */

import type { ScrambleTeamDraft } from './scrambleTournament';

export const PRESET_PLAYERS_PER_TEAM_OPTIONS = [2, 3, 4, 5] as const;
export type PresetPlayersPerTeam = (typeof PRESET_PLAYERS_PER_TEAM_OPTIONS)[number];

export const CUSTOM_PLAYERS_PER_TEAM_MIN = 6;
export const MAX_TEAM_COUNT = 25;
export const MIN_PLAYERS_PER_TEAM = 2;

export type TeamFormat = 'scramble' | 'best_ball';

/** @deprecated Use players-per-team selection */
export const PRESET_TEAM_COUNT_OPTIONS = [2, 3, 4] as const;
export type TeamCount = (typeof PRESET_TEAM_COUNT_OPTIONS)[number];
export const TEAM_COUNT_OPTIONS: TeamCount[] = [...PRESET_TEAM_COUNT_OPTIONS];
export const CUSTOM_TEAM_COUNT_MIN = CUSTOM_PLAYERS_PER_TEAM_MIN;
export const CUSTOM_TEAM_COUNT_MAX = MAX_TEAM_COUNT;

export function teamCountFromPlayersPerTeam(
  playerCount: number,
  playersPerTeam: number
): number {
  if (playersPerTeam < 1) return 0;
  return playerCount / playersPerTeam;
}

export function isValidPlayersPerTeam(
  playerCount: number,
  playersPerTeam: number,
  format: TeamFormat
): boolean {
  if (!Number.isInteger(playersPerTeam) || playersPerTeam < MIN_PLAYERS_PER_TEAM) {
    return false;
  }
  if (playerCount % playersPerTeam !== 0) return false;
  const teamCount = playerCount / playersPerTeam;
  if (teamCount < 2 || teamCount > MAX_TEAM_COUNT) return false;
  return true;
}

export function maxPlayersPerTeam(playerCount: number): number {
  if (playerCount < MIN_PLAYERS_PER_TEAM * 2) return MIN_PLAYERS_PER_TEAM;
  return Math.floor(playerCount / 2);
}

export function minPlayersPerTeamForMaxTeams(playerCount: number): number {
  return Math.max(MIN_PLAYERS_PER_TEAM, Math.ceil(playerCount / MAX_TEAM_COUNT));
}

export function validPresetPlayersPerTeam(
  playerCount: number,
  format: TeamFormat
): PresetPlayersPerTeam[] {
  return PRESET_PLAYERS_PER_TEAM_OPTIONS.filter((pp) =>
    isValidPlayersPerTeam(playerCount, pp, format)
  );
}

export function unevenSplitMessage(playerCount: number, playersPerTeam: number): string {
  return `${playerCount} players can't be divided evenly into groups of ${playersPerTeam}`;
}

export function describePlayersPerTeamOption(
  playerCount: number,
  playersPerTeam: number,
  format: TeamFormat
): { title: string; sub: string; disabled: boolean } {
  const title =
    playersPerTeam === 1
      ? '1 player per team'
      : `${playersPerTeam} players per team`;

  if (playerCount % playersPerTeam !== 0) {
    return {
      title,
      sub: unevenSplitMessage(playerCount, playersPerTeam),
      disabled: true,
    };
  }

  if (!isValidPlayersPerTeam(playerCount, playersPerTeam, format)) {
    const teamCount = playerCount / playersPerTeam;
    if (teamCount < 2) {
      return {
        title,
        sub: 'Need at least 2 teams.',
        disabled: true,
      };
    }
    if (teamCount > MAX_TEAM_COUNT) {
      return {
        title,
        sub: `Maximum is ${MAX_TEAM_COUNT} teams (${playersPerTeam} per team is too few teams).`,
        disabled: true,
      };
    }
    return { title, sub: 'This split is not available.', disabled: true };
  }

  const teamCount = playerCount / playersPerTeam;
  return {
    title,
    sub: `${teamCount} team${teamCount === 1 ? '' : 's'}`,
    disabled: false,
  };
}

export function formatTeamCountResult(playerCount: number, playersPerTeam: number): string {
  const teamCount = teamCountFromPlayersPerTeam(playerCount, playersPerTeam);
  return `${teamCount} team${teamCount === 1 ? '' : 's'} of ${playersPerTeam} player${
    playersPerTeam === 1 ? '' : 's'
  } each`;
}

function pickSuggestedPlayersPerTeam(playerCount: number, format: TeamFormat): number {
  const validPresets = validPresetPlayersPerTeam(playerCount, format);
  const allValid: number[] = [];
  for (let pp = MIN_PLAYERS_PER_TEAM; pp <= maxPlayersPerTeam(playerCount); pp++) {
    if (isValidPlayersPerTeam(playerCount, pp, format)) allValid.push(pp);
  }
  const valid = validPresets.length > 0 ? validPresets : allValid;
  if (valid.length === 0) return MIN_PLAYERS_PER_TEAM;

  if (playerCount === 10 && valid.includes(2)) return 2;
  if (playerCount === 9 && valid.includes(3)) return 3;

  if (valid.includes(2)) return 2;
  return valid[0];
}

function pickCustomDefaultPlayersPerTeam(playerCount: number, format: TeamFormat): number {
  const minPp = Math.max(CUSTOM_PLAYERS_PER_TEAM_MIN, minPlayersPerTeamForMaxTeams(playerCount));
  const maxPp = maxPlayersPerTeam(playerCount);
  const candidates: number[] = [];
  for (let pp = minPp; pp <= maxPp; pp++) {
    if (isValidPlayersPerTeam(playerCount, pp, format)) candidates.push(pp);
  }
  if (candidates.length === 0) return CUSTOM_PLAYERS_PER_TEAM_MIN;
  let best = candidates[0];
  let bestScore = Math.abs(best - 4);
  for (const pp of candidates.slice(1)) {
    const score = Math.abs(pp - 4);
    if (score < bestScore) {
      bestScore = score;
      best = pp;
    }
  }
  return best;
}

export type PlayersPerTeamSuggestion = {
  suggestedPlayersPerTeam: number;
  suggestedTeamCount: number;
  validPreset: PresetPlayersPerTeam[];
  showsCustom: boolean;
  suggestedCustomDefault: number;
  hasAnyValid: boolean;
};

export function suggestPlayersPerTeam(
  playerCount: number,
  format: TeamFormat
): PlayersPerTeamSuggestion {
  const validPreset = validPresetPlayersPerTeam(playerCount, format);
  const suggestedPlayersPerTeam = pickSuggestedPlayersPerTeam(playerCount, format);
  const suggestedTeamCount = isValidPlayersPerTeam(playerCount, suggestedPlayersPerTeam, format)
    ? playerCount / suggestedPlayersPerTeam
    : 2;

  const suggestedCustomDefault = pickCustomDefaultPlayersPerTeam(playerCount, format);
  const hasCustomValid = isValidPlayersPerTeam(playerCount, suggestedCustomDefault, format);

  const hasAnyValid =
    validPreset.length > 0 ||
    hasCustomValid ||
    isValidPlayersPerTeam(playerCount, suggestedPlayersPerTeam, format);

  const showsCustom =
    playerCount >= CUSTOM_PLAYERS_PER_TEAM_MIN * 2 &&
    (() => {
      for (let pp = CUSTOM_PLAYERS_PER_TEAM_MIN; pp <= maxPlayersPerTeam(playerCount); pp++) {
        if (isValidPlayersPerTeam(playerCount, pp, format)) return true;
      }
      return false;
    })();

  return {
    suggestedPlayersPerTeam,
    suggestedTeamCount,
    validPreset,
    showsCustom,
    suggestedCustomDefault,
    hasAnyValid,
  };
}

export function parseCustomPlayersPerTeamInput(raw: string): number | null {
  const t = raw.trim();
  if (!t || !/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : null;
}

export function validateCustomPlayersPerTeamInput(
  raw: string,
  playerCount: number,
  format: TeamFormat
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'Enter players per team.';
  const pp = parseCustomPlayersPerTeamInput(raw);
  if (pp === null) return 'Enter a whole number.';
  if (pp < CUSTOM_PLAYERS_PER_TEAM_MIN) {
    return `Minimum is ${CUSTOM_PLAYERS_PER_TEAM_MIN} players per team.`;
  }
  if (pp > maxPlayersPerTeam(playerCount)) {
    return `Maximum is ${maxPlayersPerTeam(playerCount)} players per team for this group.`;
  }
  if (playerCount % pp !== 0) {
    return unevenSplitMessage(playerCount, pp);
  }
  if (!isValidPlayersPerTeam(playerCount, pp, format)) {
    const teamCount = playerCount / pp;
    if (teamCount < 2) return 'Need at least 2 teams.';
    if (teamCount > MAX_TEAM_COUNT) return `Maximum is ${MAX_TEAM_COUNT} teams.`;
  }
  return null;
}

/** @deprecated Use isValidPlayersPerTeam via team count */
export function isValidTeamSplit(
  playerCount: number,
  teamCount: number,
  format: TeamFormat
): boolean {
  if (!Number.isInteger(teamCount) || teamCount < 2) return false;
  if (playerCount % teamCount !== 0) return false;
  const playersPerTeam = playerCount / teamCount;
  return isValidPlayersPerTeam(playerCount, playersPerTeam, format);
}

export function createEmptyTeams(count: number): ScrambleTeamDraft[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
    memberIds: [] as string[],
    designatedScorerUserId: null as string | null,
  }));
}

/** Randomly distribute players evenly across teams. */
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
