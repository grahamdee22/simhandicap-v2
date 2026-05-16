import type { DbMatchRow } from './matchPlay';

export type ScorecardVerificationUiState = 'verified' | 'unverified' | 'failed' | 'pending';

export type ScorecardVerificationResult = {
  verified: boolean;
  extracted_score: number | null;
  extracted_course: string | null;
  confidence: string;
  notes: string;
  logged_gross?: number;
  error?: string;
};

function parseNotesJson(notes: string | null | undefined): {
  status?: string;
  message?: string;
} | null {
  if (!notes?.trim()) return null;
  if (notes.trim() === 'pending') return { status: 'pending' };
  try {
    return JSON.parse(notes) as { status?: string; message?: string };
  } catch {
    return { message: notes };
  }
}

export function playerIsVerified(match: DbMatchRow, isPlayer1: boolean): boolean {
  return isPlayer1 ? !!match.p1_verified : !!match.p2_verified;
}

export function playerScreenshotUrl(match: DbMatchRow, isPlayer1: boolean): string | null {
  const url = isPlayer1 ? match.p1_screenshot_url : match.p2_screenshot_url;
  return url?.trim() ? url.trim() : null;
}

export function playerVerificationUiState(
  match: DbMatchRow,
  isPlayer1: boolean
): ScorecardVerificationUiState {
  if (playerIsVerified(match, isPlayer1)) return 'verified';
  const url = playerScreenshotUrl(match, isPlayer1);
  const notes = isPlayer1 ? match.p1_verification_notes : match.p2_verification_notes;
  const parsed = parseNotesJson(notes);
  if (url && (notes === 'pending' || parsed?.status === 'pending')) return 'pending';
  if (url && parsed?.status === 'failed') return 'failed';
  if (url && !playerIsVerified(match, isPlayer1)) return 'failed';
  if (!match.verification_required) return 'unverified';
  return 'unverified';
}

export function verificationStatusLabel(state: ScorecardVerificationUiState): string {
  switch (state) {
    case 'verified':
      return 'Verified';
    case 'pending':
      return 'Pending review';
    case 'failed':
      return 'Verification failed';
    default:
      return 'Unverified';
  }
}

export function verificationStatusEmoji(state: ScorecardVerificationUiState): string {
  switch (state) {
    case 'verified':
      return '✅';
    case 'pending':
      return '🔄';
    case 'failed':
      return '❌';
    default:
      return '⚠️';
  }
}

export function matchReadyToFinalize(match: DbMatchRow): boolean {
  if (!match.verification_required) return true;
  return !!match.p1_verified && !!match.p2_verified;
}

export function verificationNotesMessage(notes: string | null | undefined): string | null {
  const parsed = parseNotesJson(notes);
  if (parsed?.message) return parsed.message;
  if (notes && notes !== 'pending') return notes;
  return null;
}
