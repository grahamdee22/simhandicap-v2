/**
 * fetchCommunityCourseEnrichment REST path and round-detail enrichment gate/label.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCommunityCourseEnrichment } from '../fetchCommunityCourseEnrichment';
import {
  roundDetailAttributionLabel,
  shouldFetchCommunityCourseEnrichmentForRound,
} from '../roundDetailCommunityEnrichment';

const COMMUNITY_COURSE_ID = 'df62b019-925b-46bf-98f5-16b2fcb1eaa8';
const REST_CONFIG = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key',
};

describe('fetchCommunityCourseEnrichment', () => {
  it('skips fetch for non-community course ids', async () => {
    let fetchCalled = false;
    const result = await fetchCommunityCourseEnrichment('pebble', 'token', {
      fetchFn: async () => {
        fetchCalled = true;
        return new Response('[]');
      },
      getRestConfig: () => REST_CONFIG,
    });

    assert.equal(result, null);
    assert.equal(fetchCalled, false);
  });

  it('returns enrichment data for a community course id', async () => {
    const result = await fetchCommunityCourseEnrichment(COMMUNITY_COURSE_ID, 'token', {
      fetchFn: async (url, init) => {
        assert.match(url, new RegExp(`/courses\\?id=eq.${COMMUNITY_COURSE_ID}`));
        assert.equal(init?.headers?.Authorization, 'Bearer token');
        return Response.json([
          { enrichment_tier: 3, enrichment_source: 'gspro_difficulty' },
        ]);
      },
      getRestConfig: () => REST_CONFIG,
    });

    assert.deepEqual(result, {
      enrichmentTier: 3,
      enrichmentSource: 'gspro_difficulty',
    });
  });

  it('returns null when the REST response has no matching row', async () => {
    const result = await fetchCommunityCourseEnrichment(COMMUNITY_COURSE_ID, 'token', {
      fetchFn: async () => Response.json([]),
      getRestConfig: () => REST_CONFIG,
    });

    assert.equal(result, null);
  });

  it('returns null enrichment fields when the row exists but enrichment is missing', async () => {
    const result = await fetchCommunityCourseEnrichment(COMMUNITY_COURSE_ID, 'token', {
      fetchFn: async () =>
        Response.json([{ enrichment_tier: null, enrichment_source: null }]),
      getRestConfig: () => REST_CONFIG,
    });

    assert.deepEqual(result, {
      enrichmentTier: null,
      enrichmentSource: null,
    });
  });
});

describe('round detail community enrichment', () => {
  const communityRound = {
    handicapSource: 'unverified' as const,
    courseId: COMMUNITY_COURSE_ID,
  };

  it('skips fetch for verified rounds and curated course ids', () => {
    assert.equal(shouldFetchCommunityCourseEnrichmentForRound(communityRound), true);
    assert.equal(
      shouldFetchCommunityCourseEnrichmentForRound({
        handicapSource: 'unverified',
        courseId: 'pebble',
      }),
      false
    );
    assert.equal(
      shouldFetchCommunityCourseEnrichmentForRound({
        handicapSource: 'verified',
        courseId: COMMUNITY_COURSE_ID,
      }),
      false
    );
  });

  it('shows Estimated while enrichment is still loading', () => {
    assert.equal(roundDetailAttributionLabel('unverified', null), 'Estimated');
  });

  it('shows tier-specific copy after enrichment resolves', () => {
    assert.equal(
      roundDetailAttributionLabel('unverified', {
        enrichmentTier: 3,
        enrichmentSource: 'gspro_difficulty',
      }),
      'Slope by GSPro'
    );
    assert.equal(
      roundDetailAttributionLabel('unverified', {
        enrichmentTier: null,
        enrichmentSource: null,
      }),
      'Estimated'
    );
  });

  it('does not render attribution copy for verified rounds', () => {
    assert.equal(
      roundDetailAttributionLabel('verified', {
        enrichmentTier: 3,
        enrichmentSource: 'gspro_difficulty',
      }),
      null
    );
  });
});
