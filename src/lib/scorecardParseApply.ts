/**
 * Map parse-scorecard API values to log form state.
 */

import type { Mulligans, PinDay, PuttingMode, Wind } from './handicap';
import type { ParseScorecardData, ParseScorecardResult } from './parseScorecard';

export type ScanBannerKind = 'high' | 'medium' | 'low' | 'failed' | null;

export function scanBannerMessage(kind: ScanBannerKind): string | null {
  switch (kind) {
    case 'high':
    case 'medium':
      return 'Scorecard scanned — please review before logging.';
    case 'low':
      return "We weren't sure about some fields — please review carefully before logging.";
    case 'failed':
      return "Couldn't read this scorecard — please enter your round manually.";
    default:
      return null;
  }
}

export function applyParseScorecardToLogForm(
  result: ParseScorecardResult,
  courseTeeNames: string[]
): {
  grossScore?: number;
  putting?: PuttingMode;
  pin?: PinDay;
  wind?: Wind;
  mulligans?: Mulligans;
  teePickKey?: string;
  banner: ScanBannerKind;
} {
  if (!result.success) {
    return { banner: 'failed' };
  }

  const d = result.data;
  const out: ReturnType<typeof applyParseScorecardToLogForm> = {
    banner: result.confidence === 'low' ? 'low' : result.confidence,
  };

  if (typeof d.total_score === 'number' && Number.isFinite(d.total_score)) {
    out.grossScore = Math.min(120, Math.max(55, Math.round(d.total_score)));
  }

  if (d.mulligans === true) out.mulligans = 'on';
  else if (d.mulligans === false) out.mulligans = 'off';

  if (d.wind === 'Off') out.wind = 'off';
  else if (d.wind === 'Light') out.wind = 'light';
  else if (d.wind === 'Strong') out.wind = 'strong';

  if (d.pin_placement === 'Thu') out.pin = 'thu';
  else if (d.pin_placement === 'Fri') out.pin = 'fri';
  else if (d.pin_placement === 'Sat') out.pin = 'sat';
  else if (d.pin_placement === 'Sun') out.pin = 'sun';

  if (d.putting_mode === 'Auto') out.putting = 'auto_2putt';
  else if (d.putting_mode === 'Gimme') out.putting = 'gimme_5';
  else if (d.putting_mode === 'Putt') out.putting = 'putt_all';

  if (d.tees?.trim()) {
    const tee = d.tees.trim();
    const hit = courseTeeNames.find((n) => n.toLowerCase() === tee.toLowerCase());
    if (hit && hit.toLowerCase() !== 'custom') {
      out.teePickKey = hit;
    }
  }

  return out;
}
