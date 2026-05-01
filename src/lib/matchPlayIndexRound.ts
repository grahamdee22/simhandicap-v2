import type { PlatformId } from './constants';
import type { Mulligans, PinDay, PuttingMode, Wind } from './handicap';
import { findCourseSeedIdByCourseName } from './courses';
import type { DbMatchHoleRow, DbMatchRow } from './matchPlay';
import type { NewRoundInput } from '../store/useAppStore';

const PUTTING: readonly PuttingMode[] = ['auto_2putt', 'gimme_5', 'putt_all'];
const PIN: readonly PinDay[] = ['thu', 'fri', 'sat', 'sun'];
const WIND: readonly Wind[] = ['off', 'light', 'strong'];
const MULL: readonly Mulligans[] = ['on', 'off'];

function coercePutting(v: string): PuttingMode {
  return PUTTING.includes(v as PuttingMode) ? (v as PuttingMode) : 'auto_2putt';
}

function coercePin(v: string): PinDay {
  return PIN.includes(v as PinDay) ? (v as PinDay) : 'thu';
}

function coerceWind(v: string): Wind {
  return WIND.includes(v as Wind) ? (v as Wind) : 'off';
}

function coerceMull(v: string): Mulligans {
  return MULL.includes(v as Mulligans) ? (v as Mulligans) : 'off';
}

export function matchIndexRoundStorageKey(matchId: string, userId: string): string {
  return `@simcap/match_index_round/${matchId}/${userId}`;
}

export function buildNewRoundInputFromCompletedMatch(args: {
  match: DbMatchRow;
  holesRows: DbMatchHoleRow[];
  playerId: string;
  playedAtIso: string;
  platform: PlatformId;
}): { ok: true; input: NewRoundInput } | { ok: false; error: string } {
  const { match, holesRows, playerId, playedAtIso, platform } = args;
  if (match.status !== 'complete') return { ok: false, error: 'Match is not complete.' };
  if (!match.player_2_id) return { ok: false, error: 'Match has no opponent.' };
  if (playerId !== match.player_1_id && playerId !== match.player_2_id) {
    return { ok: false, error: 'You are not a player in this match.' };
  }

  const isP1 = playerId === match.player_1_id;
  const rating = isP1 ? match.player_1_course_rating : match.player_2_course_rating;
  const slope = isP1 ? match.player_1_course_slope : match.player_2_course_slope;
  const teeName = isP1 ? match.player_1_tee : match.player_2_tee;
  if (rating == null || slope == null || !teeName?.trim()) {
    return { ok: false, error: 'Missing tee or rating data for your side of this match.' };
  }

  const courseId = findCourseSeedIdByCourseName(match.course_name);
  if (!courseId) {
    return {
      ok: false,
      error: `No SimCap catalog course matches “${match.course_name}”. Log this round manually on the Log tab.`,
    };
  }

  const gross = holesRows
    .filter((r) => r.player_id === playerId)
    .reduce((s, r) => s + r.gross_score, 0);
  if (!Number.isFinite(gross) || gross <= 0 || gross > 200) {
    return { ok: false, error: 'Could not read a valid gross total for you from this match.' };
  }

  const input: NewRoundInput = {
    courseId,
    courseName: match.course_name,
    platform,
    grossScore: Math.round(gross),
    holeScores: [],
    putting: coercePutting(match.putting_mode),
    pin: coercePin(match.pin_placement),
    wind: coerceWind(match.wind),
    mulligans: coerceMull(match.mulligans),
    playedAt: playedAtIso,
    courseRating: Number(rating),
    slope: Math.round(Number(slope)),
    teeName: teeName.trim(),
  };

  return { ok: true, input };
}
