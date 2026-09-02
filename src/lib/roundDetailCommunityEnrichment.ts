import { isCommunityCourseId } from './communityCourseId';
import { communityCourseAttributionLabel } from './communityEnrichment';
import type { CourseEnrichment } from './fetchCommunityCourseEnrichment';

export function shouldFetchCommunityCourseEnrichmentForRound(
  round: { handicapSource?: string; courseId: string } | null | undefined
): boolean {
  if (!round) return false;
  return round.handicapSource === 'unverified' && isCommunityCourseId(round.courseId);
}

/** Round-detail badge label; null when the badge should not render. */
export function roundDetailAttributionLabel(
  handicapSource: string | undefined,
  courseEnrichment: CourseEnrichment | null
): string | null {
  if (handicapSource !== 'unverified') return null;
  return communityCourseAttributionLabel(
    courseEnrichment?.enrichmentTier,
    courseEnrichment?.enrichmentSource
  );
}
