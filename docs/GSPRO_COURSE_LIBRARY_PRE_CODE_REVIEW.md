# GSPro Course Library — Pre-Code Review

**Date:** August 31, 2026  
**Status:** Research complete — no code written yet  
**Purpose:** Assess schema, rate limits, and terms of use before bulk-importing and enriching the GSPro course library.

---

## Executive Summary

The feature design (offline tiered enrichment, group gating, `handicap_source` on rounds) is sound. The main blockers are:

1. **No `courses` table exists** — courses are static TypeScript seeds today.
2. **Tier 2 scraping of GolfPass / Greenskeeper is not viable at ~2,900-course scale** — violates both sites' terms and GolfPass `robots.txt` on the paths needed.
3. **GSPro difficulty scores are not on the WHS slope scale** — Tier 3 needs a mapping function, not a direct read.
4. **PakGolf Master List (~2,958 courses) is fetchable** for Step 1 with reasonable robots.txt posture; no published ToS found.

**Recommended path:** Proceed with Steps 1 + 3–5 using PakGolf import, Tier 1 borrow, Tier 3 difficulty map, Tier 4 default. Treat Tier 2 as a pluggable adapter with a legal data source (USGA NCRDB, partnership, or manual spot-check pilot) before automating external fetches.

---

## 1. Current State: No `courses` Table

There is no `courses` migration in Supabase. The app uses an in-memory seed file at `src/lib/courses.ts`.

### `CourseSeed` type (in-memory today)

```typescript
export type CourseTee = {
  name: string;
  rating: number;
  slope: number;
  yards?: number;  // optional, from published scorecard when verified
};

export type CourseSeed = {
  id: string;           // slug, e.g. 'pebble'
  name: string;
  location?: string;
  byPlatform: Partial<Record<PlatformId, { rating: number; slope: number }>>;
  pars: number[];
  strokeIndex?: number[];
  defaultTee?: string;
  tees?: CourseTee[];
  confident?: boolean;  // false = hide tee selector, use middle tee
};
```

### Seed counts

| Category | Count |
|---|---|
| Total courses in `COURSE_SEEDS` | ~100 |
| `confident: true` | 48 |
| `confident: false` | 28 |
| Flag omitted (treated as confident) | ~24 |

Note: Feature spec references "~38 curated courses" — may be an older count or a stricter subset. Align before dedupe.

### Name normalization (existing, for dedupe)

```typescript
const normSearch = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
```

---

## 2. Related Database Tables (Today)

### `rounds` — per-round snapshots

From `supabase/migrations/003_rounds.sql`:

| Column | Type | Notes |
|---|---|---|
| `course_id` | `text` | Slug reference |
| `course_name` | `text` | Display name at log time |
| `course_rating` | `double precision` | Snapshot |
| `slope` | `double precision` | Snapshot |
| `tee_name` | `text` | Optional |

**Missing for feature:** `handicap_source` (`'verified'` | `'unverified'`) — must be set at round creation from course's `confident` flag at that moment, not a live join.

### `social_groups` — not `groups`

From `supabase/migrations/002_social_groups.sql`:

| Column | Type |
|---|---|
| `id` | `uuid` |
| `name` | `text` |
| `created_by` | `uuid` |
| `created_at` | `timestamptz` |

**Missing for feature:** `expanded_course_list_enabled` boolean, default `false`.

---

## 3. Proposed Schema (Not Yet Implemented)

### `courses`

| Column | Type | Notes |
|---|---|---|
| `id` | `text` or `uuid` | Primary key (slug recommended for seed migration) |
| `name` | `text` | Display name |
| `name_normalized` | `text` | For dedupe; unique index |
| `location` | `text` | City / region |
| `designer` | `text` | From GSPro list |
| `source` | `text` | `'curated'` \| `'community'` |
| `confident` | `boolean` | Default `false` for imports |
| `gspro_difficulty` | `numeric` | Raw GSPro difficulty score |
| `enrichment_tier` | `smallint` | 1–4 |
| `enrichment_source` | `text` | Which tier/source supplied data |
| `enrichment_at` | `timestamptz` | When enrichment ran |
| `pars` | `int[]` | Default par 72 if unknown |
| `stroke_index` | `int[]` | Optional |

### `course_tees`

| Column | Type | Notes |
|---|---|---|
| `course_id` | FK → `courses` | |
| `name` | `text` | Tee name |
| `rating` | `numeric` | WHS course rating |
| `slope` | `numeric` | WHS slope |
| `yards` | `integer` | Optional; used for nearest-tee matching at runtime |

Tier 1/2: multiple rows per course (full per-tee table).  
Tier 3/4: single synthetic row (mapped or default slope/rating).

### Migrations needed

- `courses` + `course_tees` tables
- `rounds.handicap_source`
- `social_groups.expanded_course_list_enabled`

---

## 4. GSPro Master Course List (Step 1 Source)

**Source:** [PakGolf Studios GSPro Master Course List](https://pakgolfstudios.com/gspro-course-list/)  
**Row count:** ~2,958 courses (live HTML table, full list fetchable)  
**Fields available:** Name, Difficulty, Server, Version, Updated, Location, Designer, Elevation, tags (Coastal, Links, etc.), Country

### Difficulty score distribution

Analysis of non-empty difficulty values (n = 2,646):

| Statistic | Value |
|---|---|
| Minimum | 0 |
| 5th percentile | 24 |
| Median | 38 |
| 95th percentile | 62 |
| Maximum | 644 (outlier) |
| Missing / empty | ~312 rows |

**Conclusion:** The sample range of ~23–63 matches p5–p95. This is **not** on the WHS slope scale — it is a GSPro internal difficulty index.

### Tier 3 mapping recommendation

- Linear map from practical range **p5–p95 (24 → 55, 62 → 155)** onto WHS slope range
- Clamp outliers (e.g. cap at p95 or treat >80 as Tier 4)
- Treat missing/zero difficulty as Tier 4 (default 113 / 72.0)
- Store mapped slope with `rating: 72.0` unless a better default is derived

### PakGolf `robots.txt`

```
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
```

Course list page is **not** disallowed. No published Terms of Service found on the site. A courtesy note to PakGolf before production import is advisable.

### The Course View (alternative)

- Independent directory, ~2,900 courses, weekly sync
- No accessible ToS (behind Cloudflare verification)
- FAQ suggests contact: `contactthecourseview@gmail.com`

---

## 5. Tiered Enrichment Plan (Reference)

| Tier | Source | Data stored |
|---|---|---|
| **1** | Normalized name match to existing `confident: true` course | Borrow full per-tee table |
| **2** | GolfPass or Greenskeeper fetch | Full per-tee slope/rating table |
| **3** | GSPro difficulty score only | Single mapped slope + rating 72.0 |
| **4** | Nothing found | Flat slope 113, rating 72.0 |

**Runtime (Step 3):** Pre-enriched at import. Log a Round asks yardage on `confident: false` courses, matches nearest real tee from stored table (Tier 1/2), or applies single mapped/default number (Tier 3/4). No synchronous lookup.

**Logging:** Record `enrichment_tier` and `enrichment_source` per course. Spot-check Tier 2 sample against source pages before trusting full batch.

---

## 6. Rate Limiting Assessment

**Important:** No empirical rate-limit testing was performed. Estimates below are from `robots.txt`, typical anti-bot behavior, and request math.

### GolfPass

**`robots.txt` (fetched August 31, 2026):**

```
User-agent: *
Crawl-delay: 10
Disallow: /api/
Disallow: /search/
Disallow: /course-directory/
Disallow: /courses/bvr/
Disallow: /courses/badges/
Disallow: /courses/feed/
...
```

Tier 2 likely requires **search + detail ≈ 2 HTTP requests per course**.

For ~2,000 courses missing Tier 1:

| Pace | Theoretical wall time |
|---|---|
| 10 s/request (robots.txt floor) | ~11 hours minimum |
| 5 s/request | ~5.5 hours |
| 3 s/request | ~3.3 hours |

**Practical ceiling is much lower.** GolfPass disallows search and course-directory paths, uses Versant/GolfNow infrastructure, and explicitly prohibits automated extraction in UK/AU ToS. Expect **403s, CAPTCHAs, or IP blocks well before 2,000 successful fetches** — likely in the **50–200 requests/day** range without partnership or API access.

**Conservative operational plan (if scraping were attempted):**

- 1 request every 5–10 seconds
- Batches of 25–50, then 5–15 minute pause
- Single IP, no parallel workers
- Checkpoint/resume on failure
- Budget days to weeks, not hours

### Greenskeeper

**`robots.txt`:**

```
User-agent: *
Disallow: /bmanage/
Disallow: /administrator/
```

Course pages are **not** disallowed. No published crawl-delay or rate-limit headers. Same conservative pacing applies; bulk automated access at library scale is still likely to trigger blocks.

### Bottom line

There is no documented "safe batch size" from either site. Binding constraints are **terms of use** and **anti-bot enforcement**, not a published quota. If Tier 2 scraping is attempted at all, run a **100-course pilot** with spot-checks before committing to the full library.

---

## 7. Terms of Use

### GolfPass — do not scrape at this volume

| Layer | Finding |
|---|---|
| **robots.txt** | `Crawl-delay: 10`; `/search/`, `/api/`, `/course-directory/` all **Disallow** |
| **UK/AU ToS** (AU version, March 2025) | *"You may not use any software robot, spider, crawler, or other data gathering or extraction tool, whether automated or manual, to access, acquire, copy, monitor, scrape or aggregate any content made available on the Websites or via the Services"* |
| **US ToS** (October 2025) | §6.1 references a "list of Prohibited Actions" (list not in static HTML — likely JS-rendered); §6.2 reserves right to block/suspend for violations |
| **License** | Personal entertainment/information only; content is GolfPass IP |

Automated bulk enrichment of ~2,900 courses into SimCap's database is not personal browsing. It violates `robots.txt` on required paths and clearly violates UK/AU ToS.

### Greenskeeper — not viable for bulk library build

**Source:** [greenskeeper.org/siteinfo/termsofservice.cfm](https://www.greenskeeper.org/siteinfo/termsofservice.cfm)

| Section | Restriction |
|---|---|
| **§2.1** | Content for **personal, noncommercial** use only |
| **§2.2** | May not reproduce, distribute, or exploit content |
| **§2.3** | *"Copying or storing of any Content for other than personal use is expressly prohibited without prior written permission"* |
| **§10.1** | May not copy, distribute, modify, or reverse engineer |

`robots.txt` does not block course pages, but ToS prohibits building a product database from their content.

### GolfLink / BlueGolf

Already ruled out — `robots.txt` blocks automated fetches.

### Prior trial (Marcus)

Five real GSPro course names were searched; all five appeared on course-database sites. GolfPass and Greenskeeper returned complete per-tee tables for two tested fetches. This validates **data quality and parseability** for spot-checking — it does not make bulk automated extraction permissible.

---

## 8. Legitimate Tier 2 Alternatives

1. **USGA NCRDB** — Official slope/rating where courses are registered (gaps for sim-only/fictional courses)
2. **Partnership / data license** — GolfPass, Greenskeeper, or a golf data aggregator
3. **Tier 1 + Tier 3/4 only** — Borrow from confident seeds, map GSPro difficulty, default 113/72 — no external scraping
4. **Manual spot-check workflow** — Semi-automated Tier 2 for a pilot batch only, human-verified

---

## 9. Feature Steps (Reference)

### Step 1: Get complete course list
- Walk PakGolf Master List (or The Course View with permission)
- Insert into `courses`: `name`, `source: community`, `confident: false`
- Dedupe against existing curated courses by normalized name

### Step 2: Offline tiered enrichment
- Batch job with real delays between requests
- Log tier per course; spot-check Tier 2 sample

### Step 3: Runtime behavior
- Pre-enriched at import; yardage-based nearest-tee matching for community courses
- No synchronous lookup, no "first user waits"

### Step 4: Group-gated visibility
- `social_groups.expanded_course_list_enabled` default `false`
- Community courses visible in Log a Round only when flag is true
- Flip on for Marcus's group via SQL once column exists

### Step 5: Handicap tagging and tournament exclusion
- `rounds.handicap_source` set at creation from course `confident` at that moment
- Unverified badge in UI; same weight in handicap calc
- Tournament round-posting: `confident: true` only, regardless of group flag

---

## 10. Recommended Next Steps

1. **Decide Tier 2 data path** — scraping vs. licensed data vs. Tier 1/3/4 only
2. **Draft migration** — `courses`, `course_tees`, `handicap_source`, `expanded_course_list_enabled`
3. **Build PakGolf import script** — full list, dedupe, insert as `source: community`
4. **Implement offline enrichment job** — Tier 1 match, Tier 3 map, Tier 4 default; Tier 2 as pluggable adapter
5. **Run 20–50 course pilot** — validate match accuracy before full batch
6. **Contact PakGolf / The Course View** — courtesy / permission for bulk list use

---

## Appendix: Files Referenced

| File | Relevance |
|---|---|
| `src/lib/courses.ts` | Current `CourseSeed` type and `COURSE_SEEDS` array |
| `supabase/migrations/003_rounds.sql` | `rounds` table schema |
| `supabase/migrations/002_social_groups.sql` | `social_groups` table schema |
| `https://pakgolfstudios.com/gspro-course-list/` | GSPro Master Course List |
| `https://www.golfpass.com/robots.txt` | GolfPass crawl restrictions |
| `https://www.greenskeeper.org/robots.txt` | Greenskeeper crawl restrictions |
| `https://www.greenskeeper.org/siteinfo/termsofservice.cfm` | Greenskeeper ToS |
