/**
 * Upload GS Pro scorecard screenshots for round-log parsing.
 * Path: `log/{userId}/scorecard.jpg` in bucket `match-scorecards`.
 */

import {
  uploadMatchScorecardScreenshot,
  type ScorecardUploadDiag,
} from './matchScorecardStorage';

export async function uploadLogScorecardForParse(params: {
  userId: string;
  localUri: string;
  accessToken?: string;
}): Promise<
  | { signedUrl: string; path: string; diag?: ScorecardUploadDiag }
  | { error: string; diag?: ScorecardUploadDiag }
> {
  return uploadMatchScorecardScreenshot({
    matchId: 'log',
    userId: params.userId,
    localUri: params.localUri,
    accessToken: params.accessToken,
  });
}
