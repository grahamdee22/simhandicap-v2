import { todayLocalYmd } from './dates';
import type { DbLeagueRow, LeagueFormat } from './leagues';

export type { LeagueStandingRow } from './computeLeagueStandings';
export {
  computeLeagueStandings,
  leagueRoundsForStandings,
} from './computeLeagueStandings';

export function isTeamLeagueFormat(format: LeagueFormat): boolean {
  return format === 'scramble' || format === 'best_ball';
}

export { formatTeamMemberSummary } from './teamRosterDisplay';

export function formatLeagueFormatLabel(format: LeagueFormat): string {
  switch (format) {
    case 'stroke':
      return 'Stroke Play';
    case 'match_play':
      return 'Match Play';
    case 'scramble':
      return 'Scramble';
    case 'best_ball':
      return 'Best Ball';
    default:
      return format;
  }
}

export function leagueDaysRemaining(league: DbLeagueRow): number {
  const end = new Date(`${league.end_date}T23:59:59`);
  const now = Date.now();
  const ms = end.getTime() - now;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export function isLeagueActive(league: DbLeagueRow): boolean {
  if (league.status !== 'active') return false;
  const today = todayLocalYmd();
  return today >= league.start_date && today <= league.end_date;
}

/** e.g. May 18 – Jun 15, 2026 */
export function formatLeagueDateRange(startYmd: string, endYmd: string): string {
  const start = new Date(`${startYmd}T12:00:00`);
  const end = new Date(`${endYmd}T12:00:00`);
  const monthDay: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startPart = start.toLocaleDateString('en-US', monthDay);
  const endPart = end.toLocaleDateString('en-US', monthDay);
  const year = end.getFullYear();
  if (start.getFullYear() === year) {
    return `${startPart} – ${endPart}, ${year}`;
  }
  return `${start.toLocaleDateString('en-US', { ...monthDay, year: 'numeric' })} – ${end.toLocaleDateString('en-US', { ...monthDay, year: 'numeric' })}`;
}
