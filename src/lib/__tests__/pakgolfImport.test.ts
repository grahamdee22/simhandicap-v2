/**
 * PakGolf HTML table parser for import-gspro-courses.ts
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePakGolfHtml, parsePakGolfMarkdown } from '../../../scripts/import-gspro-courses.ts';

const SAMPLE_HTML = `
<table id="table_1">
<thead><tr><th>Name</th><th>Difficulty</th><th>Server</th><th>Version</th><th>Updated</th><th>Location</th><th>Designer</th></tr></thead>
<tbody>
<tr><td>Brookside at the Rose Bowl &#8211; CW Koiner</td><td>38</td><td>Pakman Tier 1</td><td>Patreon (Gold) v1</td><td>08/30/2026</td><td>Pasadena, CA, USA</td><td>pakman</td></tr>
<tr><td>Ambassador GC</td><td>41</td><td>Pakman Tier 1</td><td>Patreon (Gold) v1</td><td>08/23/2026</td><td>Windsor, Ontario, Canada</td><td>pakman</td></tr>
</tbody>
</table>
`;

describe('parsePakGolfHtml', () => {
  it('parses wpDataTable rows with HTML entities', () => {
    const rows = parsePakGolfHtml(SAMPLE_HTML);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, 'Brookside at the Rose Bowl – CW Koiner');
    assert.equal(rows[0].difficulty, 38);
    assert.equal(rows[0].location, 'Pasadena, CA, USA');
    assert.equal(rows[0].designer, 'pakman');
    assert.equal(rows[1].name, 'Ambassador GC');
  });

  it('does not parse markdown pipe tables', () => {
    const md = '| Brookside | 38 | x | x | x | Pasadena | pakman |';
    assert.equal(parsePakGolfHtml(md).length, 0);
    assert.equal(parsePakGolfMarkdown(md).length, 1);
  });
});
