/**
 * Forest Green theme — Augusta pines (deep / mid / sage on white).
 * Deep #1a3d2b: headers & primary actions · Mid #2d6a4f: accents & active states · Sage #52b788: highlights & links
 */
export const colors = {
  /** App chrome & body (mockup: white) */
  bg: '#ffffff',
  surface: '#ffffff',
  /** Primary body text */
  ink: '#1a1a1a',
  /** Headers, hero bands, primary solid buttons */
  header: '#1a3d2b',
  muted: '#5a6b62',
  subtle: '#6f7f76',
  border: '#e3ebe6',
  pillBorder: '#c5ddd2',
  /** Mid forest — tabs, chips-on, primary actions text on sage panels */
  accent: '#2d6a4f',
  /** Deep forest — extra emphasis */
  accentDark: '#1a3d2b',
  /** Light sage-tint panels */
  accentSoft: '#ecf6f1',
  /** Sage — badges, trends, secondary links, diff callouts */
  accentMuted: '#52b788',
  sage: '#52b788',
  forestMid: '#2d6a4f',
  forestDeep: '#1a3d2b',
  danger: '#c53030',
  warn: '#d97706',
  gold: '#ba7517',
  silver: '#6f7f76',
  bronze: '#993c1d',
} as const;

export const PLATFORMS = [
  'Trackman',
  'Foresight',
  'Full Swing',
  'E6',
  'GSPro',
] as const;

export type PlatformId = (typeof PLATFORMS)[number];
