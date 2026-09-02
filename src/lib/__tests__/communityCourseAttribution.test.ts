/**
 * Community course attribution badge labels by enrichment tier.
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { communityCourseAttributionLabel } from '../communityEnrichment';

describe('communityCourseAttributionLabel', () => {
  it('attributes Tier 3 slope to GSPro', () => {
    assert.equal(communityCourseAttributionLabel(3, 'gspro_difficulty'), 'Slope by GSPro');
    assert.equal(communityCourseAttributionLabel(3, null), 'Slope by GSPro');
  });

  it('labels Tier 4 and fallbacks as Estimated', () => {
    assert.equal(communityCourseAttributionLabel(4, 'default'), 'Estimated');
    assert.equal(communityCourseAttributionLabel(1, 'pebble'), 'Estimated');
    assert.equal(communityCourseAttributionLabel(null, null), 'Estimated');
    assert.equal(communityCourseAttributionLabel(undefined, 'default'), 'Estimated');
  });

  it('uses gspro_difficulty source even when tier is missing', () => {
    assert.equal(communityCourseAttributionLabel(null, 'gspro_difficulty'), 'Slope by GSPro');
  });
});
