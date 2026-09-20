/**
 * Map parse-scorecard API values to log form state.
 */

import type { Mulligans, PinDay, PuttingMode, Wind } from './handicap';
import type { ParseScorecardData, ParseScorecardResult } from './parseScorecard';
import type { ScannedCourseMatch } from './scorecardCourseMatch';

export type ScanBannerKind = 'high' | 'medium' | 'low' | 'failed' | null;

export function scanBannerMessage(
  kind: ScanBannerKind,
  detail?: {
    detectedCourseName?: string | null;
    matchedCourseName?: string | null;
    courseMatchConfidence?: 'exact' | 'fuzzy' | null;
  }
): string | null {
  if (kind == null) return null;
  if (kind === 'failed') {
    return "Couldn't read this scorecard — please enter your round manually.";
  }

  const detected = detail?.detectedCourseName?.trim();
  const matched = detail?.matchedCourseName?.trim();
  const courseBit = (() => {
    if (matched && detected) {
      if (detail?.courseMatchConfidence === 'fuzzy') {
        return ` Course looks like ${matched} (from “${detected}”) — confirm before logging.`;
      }
      return ` Course set to ${matched} — confirm before logging.`;
    }
    if (detected && !matched) {
      return ` Detected “${detected}” but no catalog match — pick the correct course before logging.`;
    }
    if (matched) {
      return ` Course set to ${matched} — confirm before logging.`;
    }
    return '';
  })();

  if (kind === 'low') {
    return `We weren't sure about some fields — please review carefully before logging.${courseBit}`;
  }
  return `Scorecard scanned — please review before logging.${courseBit}`;
}

export function applyParseScorecardToLogForm(
  result: ParseScorecardResult,
  courseTeeNames: string[],
  courseMatch?: ScannedCourseMatch | null
): {
  grossScore?: number;
  putting?: PuttingMode;
  pin?: PinDay;
  wind?: Wind;
  mulligans?: Mulligans;
  teePickKey?: string;
  courseId?: string;
  detectedCourseName?: string | null;
  courseMatchConfidence?: 'exact' | 'fuzzy' | null;
  matchedCourseName?: string | null;
  banner: ScanBannerKind;
} {
  if (!result.success) {
    return { banner: 'failed' };
  }

  const d = result.data;
  const detectedCourseName = result.raw_course_name?.trim() || null;
  const out: ReturnType<typeof applyParseScorecardToLogForm> = {
    banner: result.confidence === 'low' ? 'low' : result.confidence,
    detectedCourseName,
    matchedCourseName: courseMatch?.courseName ?? null,
    courseMatchConfidence: courseMatch?.confidence ?? null,
  };

  if (courseMatch) {
    out.courseId = courseMatch.courseId;
  }

  if (typeof d.total_score === 'number' && Number.isFinite(d.total_score)) {
    out.grossScore = Math.min(120, Math.max(55, Math.round(d.total_score)));
  }

  if (d.mulligans === true) out.mulligans = 'one';
  else if (d.mulligans === false) out.mulligans = 'none';

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

  // Ambiguous / unmatched course → nudge user to review carefully
  if (detectedCourseName && (!courseMatch || courseMatch.confidence === 'fuzzy')) {
    if (out.banner === 'high' || out.banner === 'medium') out.banner = 'low';
  }

  return out;
}
