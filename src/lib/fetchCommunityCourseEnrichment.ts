import { isCommunityCourseId } from './communityCourseId';

const ENRICHMENT_SELECT = 'enrichment_tier,enrichment_source';

export type CourseEnrichment = {
  enrichmentTier: number | null;
  enrichmentSource: string | null;
};

export type FetchCommunityCourseEnrichmentDeps = {
  fetchFn?: typeof fetch;
  getRestConfig?: () => { supabaseUrl: string; supabaseAnonKey: string };
  querySupabase?: (courseId: string) => Promise<CourseEnrichment | null>;
};

function mapEnrichmentRow(row: {
  enrichment_tier: number | null;
  enrichment_source: string | null;
}): CourseEnrichment {
  return {
    enrichmentTier: row.enrichment_tier ?? null,
    enrichmentSource: row.enrichment_source ?? null,
  };
}

/** Live course enrichment for round detail (Option B: no snapshot columns on rounds). */
export async function fetchCommunityCourseEnrichment(
  courseId: string,
  accessToken?: string,
  deps: FetchCommunityCourseEnrichmentDeps = {}
): Promise<CourseEnrichment | null> {
  if (!isCommunityCourseId(courseId)) return null;

  const fetchFn = deps.fetchFn ?? fetch;

  if (accessToken) {
    const config = deps.getRestConfig?.();
    if (!config?.supabaseUrl || !config.supabaseAnonKey) return null;
    const path = `courses?id=eq.${encodeURIComponent(courseId)}&select=${encodeURIComponent(ENRICHMENT_SELECT)}`;
    const res = await fetchFn(`${config.supabaseUrl}/rest/v1/${path}`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as {
      enrichment_tier: number | null;
      enrichment_source: string | null;
    }[];
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return null;
    return mapEnrichmentRow(row);
  }

  if (deps.querySupabase) {
    return deps.querySupabase(courseId);
  }

  return null;
}
