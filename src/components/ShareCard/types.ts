export type ShareRoundCardData = {
  playerName?: string;
  score: number;
  scoreToPar: number;
  scoreToParLabel?: string; // "OVER PAR" | "EVEN PAR" | "UNDER PAR"
  courseName: string;
  simName: string;
  dateLabel: string;
  teeLabel?: string;
  differential: number;
  indexAfter: number | null;
  differentialSubtext?: string;
  indexAfterSubtext?: string;
  puttingMode?: string;
  pinPlacement?: string;
  wind?: string;
  mulligans?: string;
};

export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT = 1920;
