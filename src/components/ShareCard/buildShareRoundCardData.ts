import { getCourseById } from '../../lib/courses';
import {
  formatDifferentialDisplay,
  formatHandicapIndexDisplay,
  mulliganDisplayLabel,
} from '../../lib/handicap';
import { holesPlayedLabel, isNineHolePlayed } from '../../lib/nineHoleRating';
import { pinDetailLabel } from '../../lib/pinPlacement';
import type { SimRound } from '../../store/useAppStore';
import type { ShareRoundCardData } from './types';

function puttingLabel(p: SimRound['putting']): string {
  if (p === 'auto_2putt') return 'Auto 2-putt';
  if (p === 'gimme_5') return 'Gimme <5ft';
  return 'Putt everything';
}

function windLabel(w: SimRound['wind']): string {
  if (w === 'off') return 'Off';
  if (w === 'light') return 'Light';
  return 'Strong';
}

function top8Ids(all: SimRound[]): Set<string> {
  const chron = [...all].sort((a, b) => {
    const dt = new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime();
    if (dt !== 0) return dt;
    return a.id.localeCompare(b.id);
  });
  const window = chron.slice(-20);
  const ranked = window.map((r) => ({ id: r.id, d: r.adjustedDiff }));
  ranked.sort((a, b) => a.d - b.d);
  return new Set(ranked.slice(0, 8).map((x) => x.id));
}

function scoreToParLabel(scoreToPar: number): string {
  if (scoreToPar === 0) return 'EVEN PAR';
  if (scoreToPar > 0) return 'OVER PAR';
  return 'UNDER PAR';
}

function formatIndexDelta(delta: number | null | undefined): string | undefined {
  if (delta == null || !Number.isFinite(delta)) return undefined;
  const rounded = Math.round(delta * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)} this round`;
}

/** Map a saved SimRound into share-card display props (no hardcoded demo values). */
export function buildShareRoundCardData(
  round: SimRound,
  allRounds: SimRound[],
  playerName?: string
): ShareRoundCardData {
  const course = getCourseById(round.courseId);
  const pars = course?.pars ?? [];
  const holes = round.holesPlayed ?? '18';
  const parSlice =
    holes === 'front'
      ? pars.slice(0, 9)
      : holes === 'back'
        ? pars.slice(9, 18)
        : pars;
  const parTotal = parSlice.reduce((sum, p) => sum + p, 0) || (isNineHolePlayed(holes) ? 36 : 72);
  const scoreToPar = round.grossScore - parTotal;
  const inTop8 = top8Ids(allRounds).has(round.id);
  const indexAfter = round.indexAfter;
  const dateLabel = new Date(round.playedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const holesLbl = holesPlayedLabel(holes);

  return {
    playerName: playerName?.trim() || undefined,
    score: round.grossScore,
    scoreToPar,
    scoreToParLabel: scoreToParLabel(scoreToPar),
    courseName: round.courseName,
    simName: round.platform,
    dateLabel,
    teeLabel: round.teeName?.trim() || undefined,
    holesLabel: holesLbl ?? undefined,
    differential: round.adjustedDiff,
    indexAfter: indexAfter ?? null,
    differentialSubtext: inTop8 ? 'Counts toward index' : 'Outside best 8 / 20',
    indexAfterSubtext: formatIndexDelta(round.indexDelta),
    puttingMode: puttingLabel(round.putting),
    pinPlacement: pinDetailLabel(round.pin, round.platform),
    wind: windLabel(round.wind),
    mulligans: mulliganDisplayLabel(round.mulligans),
  };
}

export function formatShareScoreToPar(scoreToPar: number): string {
  if (scoreToPar === 0) return 'E';
  if (scoreToPar > 0) return `+${scoreToPar}`;
  return `${scoreToPar}`;
}

export function formatShareDifferential(v: number): string {
  return formatDifferentialDisplay(v);
}

export function formatShareIndex(v: number | null | undefined): string {
  return formatHandicapIndexDisplay(v);
}
