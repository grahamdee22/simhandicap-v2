/** Bracket halved-match tiebreaker copy (UI). */
export const BRACKET_HALVED_TIEBREAKER_SHORT = 'best handicap tiebreaker';

export const BRACKET_HALVED_TIEBREAKER_BODY =
  'If a match is halved after 18 holes, the player with the best handicap (lowest SimCap index) advances to the next round.';

export function bracketHalvedAdvanceLine(playerName: string): string {
  return `Match halved — ${playerName} advances (${BRACKET_HALVED_TIEBREAKER_SHORT})`;
}

export function bracketHalvedResultLine(playerName: string): string {
  return `Halved — ${playerName} advances (${BRACKET_HALVED_TIEBREAKER_SHORT})`;
}
