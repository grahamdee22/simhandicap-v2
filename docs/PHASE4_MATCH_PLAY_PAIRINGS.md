# Phase 4 — Match Play tournament pairings (schema scope)

**Status:** Implemented (migration `045_match_play_pairings.sql`).  
**PRD refs:** §2.2 (pairing method), §2.3 (match detail, standings), §6.1 (18 holes only).

## Problem

Match Play **tournaments** (`leagues.format = 'match_play'`) are not the same as Social **matches** (`matches` / `match_holes`). Today, standings incorrectly infer wins from completed Social matches (`fetchMatchWinsForLeague`). Phase 4 replaces that with tournament-scoped 1v1 pairings and hole-level W/L/H from `tournament_hole_scores`.

Phase 1 stores per-round W/L/H on `tournament_hole_scores` and defers pairing-level aggregation until this schema exists.

## Proposed tables (Phase 4 migration)

### `league_match_pairings`

One row per scheduled 1v1 match in a match-play tournament.

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | |
| `league_id` | uuid FK → leagues | |
| `player_1_entry_id` | uuid FK → league_entries | |
| `player_2_entry_id` | uuid FK → league_entries | |
| `status` | text | `scheduled` \| `in_progress` \| `complete` \| `halved` |
| `winner_entry_id` | uuid nullable FK → league_entries | Set when clinched |
| `holes_won_p1` | int default 0 | Running hole wins (not stroke count) |
| `holes_won_p2` | int default 0 | |
| `holes_halved` | int default 0 | |
| `scheduled_at` | timestamptz nullable | Optional |
| `completed_at` | timestamptz nullable | |
| `created_at` | timestamptz | |

**Constraints**

- `player_1_entry_id <> player_2_entry_id`
- Unique active pairing per unordered pair optional: `unique (league_id, least(entry_ids), greatest(entry_ids))` via expression index
- Both entries must belong to `league_id`

### `league_match_pairing_rounds` (optional)

Links a logged `league_round` (18-hole session) to a pairing when a player submits W/L/H.

| Column | Type | Notes |
|--------|------|--------|
| `id` | uuid PK | |
| `pairing_id` | uuid FK → league_match_pairings | |
| `league_round_id` | uuid FK → league_rounds | Unique |
| `submitted_by_entry_id` | uuid FK → league_entries | |
| `created_at` | timestamptz | |

**Use:** A single pairing may span multiple logged rounds if PRD “best 3 of 5 matches” is modeled as multiple sessions; `leagues.match_play_matches_that_count` (Phase 1 column) caps how many count toward standings.

## `leagues` columns (Phase 1 adds, Phase 4 uses)

- `match_play_pairing_method`: `random` \| `admin`
- `match_play_matches_that_count`: integer 1–10 (e.g. best 3 of 5)

## Standings (Phase 4)

Per `league_entries` for match play:

| Column | Source |
|--------|--------|
| Matches played | Count completed pairings involving entry |
| Wins / Losses / Halved | From pairing results |
| Points | 2 win, 1 halve, 0 loss (PRD §2.3) |

Sort: points DESC, wins DESC.

## Edge function `calculate-match-play-result` (Phase 4 behavior)

**Input:** `league_round_id` (or `pairing_id` once rounds are linked).

1. Load pairing for submitter’s entry + opponent.
2. Read 18 rows from `tournament_hole_scores` (`result` W/L/H).
3. Apply handicap strokes per hole if `leagues.use_handicap` (course hole handicap index, §6.4).
4. Compute hole winners → update `holes_won_*`, detect clinch (“3 UP with 2 to play”).
5. On pairing `complete`, update both `league_entries` points / W-L-H totals.
6. Respect `match_play_matches_that_count` for season standings.

## Admin flows (Phase 4 UI)

- **Random draw:** RPC `generate_match_play_pairings(p_league_id)` — round-robin or random 1v1 among entries.
- **Admin-assigned:** Creator UI to pick player A vs B before tournament starts.

## Out of scope (locked in PRD)

- 9-hole match play tournaments
- 36-hole / multi-segment single matches
- Reuse of Social `matches` table for tournament scoring

## Phase 1 deliverable

- `tournament_hole_scores.result` stores W/L/H per hole.
- `calculate-match-play-result` validates and stores holes; returns round-level W/L/H summary only (no pairing updates).
