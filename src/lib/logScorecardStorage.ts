/**
 * Upload GS Pro scorecard screenshots for round-log parsing.
 * Path: `{userId}/log/scorecard.jpg` in bucket `match-scorecards`.
 */

import { uploadMatchScorecardScreenshot } from './matchScorecardStorage';

export async function uploadLogScorecardForParse(params: {
  userId: string;
  localUri: string;
  accessToken?: string;
}): Promise<{ signedUrl: string; path: string } | { error: string }> {
  return uploadMatchScorecardScreenshot({
    matchId: 'log',
    userId: params.userId,
    localUri: params.localUri,
    accessToken: params.accessToken,
  });
}
