# Build prompt: 9-hole round support for SimCap index

## Context

SimCap's handicap index currently only handles 18-hole logged rounds. We're
adding support for logging a 9-hole round (Front 9 or Back 9) so it can
contribute to a player's SimCap index, in line with the 2024 USGA World
Handicap System change that lets a single 9-hole score count on its own
(rather than requiring it to sit and wait to be paired with a second 9-hole
score).

Four scope decisions are locked for this build. Do not re-litigate them
mid-implementation — if one turns out to be unworkable, stop and flag it
rather than silently choosing a different approach.

## Decision 1: One 9 = one full counting differential

A single logged 9-hole round produces one full adjusted differential and
counting round on its own. We are NOT implementing WHS-style pairing of two
9-hole scores into a synthetic 18-hole differential.

**Data prerequisite — resolved:** confirmed the catalog has no Front 9 /
Back 9 course rating or slope anywhere today (not on curated `courses.ts`
tees, not on `course_tees` for community courses). Real per-nine data isn't
realistically sourceable at this stage — the same ToS/availability wall
that ruled out bulk-sourcing accurate 18-hole community data applies here,
worse, since 9-hole splits are published even less often than full 18-hole
ratings.

Decided policy: ship with a **derived approximation**, not real per-nine
data, built so it can be swapped for real data later without a rewrite.

- Formula: 9-hole course rating = 18-hole course rating ÷ 2 (rounded to one
  decimal). Slope stays the same as the 18-hole slope for that tee (no
  split — slope doesn't average as cleanly as rating, and there's no basis
  to derive a different number without real data).
- Apply this identically to curated tees and community tees. Don't special-
  case one catalog over the other.
- **Build it swappable, not hardcoded inline.** Put this behind a single
  resolver (e.g. `getNineHoleRatingSlope(tee, half)`) that every caller
  goes through — differential math, log-a-round preview, round save. Don't
  inline `rating / 2` at multiple call sites.
- Add a source flag alongside whatever 9-hole numbers get computed/stored
  per tee — something like `nine_hole_source: 'derived' | 'real'` — mirroring
  the existing `handicap_source` pattern used for community courses. When
  `'derived'`, the resolver computes from the 18-hole numbers at read time
  (don't persist synthetic numbers as if they were sourced data). If real
  Front/Back 9 data is added for a tee later, that tee's rows carry real
  numbers with `nine_hole_source: 'real'` and the resolver returns those
  directly — no differential-math changes needed elsewhere when that
  happens.
- This is SimCap's own approximation, not WHS-official 9-hole scoring.
  Treat it the same way existing docs already frame the whole index ("not
  a full copy of every current WHS rule") — no new player-facing disclosure
  UI needed for this specifically, but don't describe 9-hole ratings as
  "official" anywhere in copy.

Implementation notes:
- Raw differential formula for a 9-hole round uses the 9-hole gross score
  against the (derived, or real once available) 9-hole course rating and
  slope for the tee/holes played — never the full 18-hole rating/slope for
  a 9-hole score.
- The difficulty modifier pipeline (putting/pin/wind/mulligans × 0.88 sim
  baseline) is unchanged and applies the same way to a 9-hole round.
- The resulting adjusted differential slots into the existing "best 8 of
  last 20" index calculation exactly like any other counting round. No new
  averaging tier, no separate 9-hole bucket.

## UI guidance: Holes selector on Log a Round

The Log a Round screen today has no holes field at all — it's a single
gross score stepper (55–120) that assumes 18 holes. Don't bolt 9-hole
support onto that stepper implicitly; add an explicit **Holes** selector.

- Add a **Holes** control with three options: **18 holes**, **Front 9**,
  **Back 9**. Mirror the existing pattern from Social Match Play's "Holes"
  step (same three options, same labels) rather than inventing new copy or
  a different interaction style.
- Placement: put it with Course/Tee, before the score entry — holes played
  determines which rating/slope applies and what the valid score range is,
  so it should be set before the player enters a score, not after.
- Score range: 55–120 only makes sense for a full 18. A 9-hole gross score
  needs its own bounds on the stepper (roughly half the 18-hole range, but
  confirm actual min/max with Cursor rather than assuming — don't just
  reuse 55–120 for a 9-hole entry).
- Tee chips: when Front 9 or Back 9 is selected, the tee chips shown should
  reflect that 9's rating/slope, not the combined 18-hole numbers — same
  chip UI, different data source. Custom tee entry should also make clear
  which 9 the rating/slope being entered applies to when a 9-hole round is
  selected.
- Default: leave the selector defaulting to **18 holes** (matches current
  behavior and Match Play's own default), so nothing changes for the
  common case unless someone actively selects a 9.
- Post-save indicator: a saved 9-hole round should be visually
  distinguishable from an 18-hole round afterward — on the round card, in
  Home's recent-rounds list, on Analyze, and on the round detail/analysis
  screen. A small "Front 9" / "Back 9" label or badge next to the score is
  enough; don't leave 9-hole rounds indistinguishable from full rounds once
  logged.
- Gating (see Decision 2 below): until the null-index gate is satisfied,
  the Holes selector should show only **18 holes** — either hide Front
  9/Back 9 as options entirely, or show them disabled with a short inline
  explanation (something like "Log a full 18 first to unlock 9-hole
  rounds"). Don't let someone pick a 9-hole option and only find out it's
  blocked after they try to save.

## Decision 2: Null-index gate

A player cannot log a 9-hole round until they have at least one existing
counting round (i.e., until Home would already show them a non-null SimCap
index). This reuses the existing "1 counting round" threshold Home already
uses to display an index — do not introduce a new/different threshold.

- Before this, a brand-new player's very first logged round must be 18
  holes. The 9-hole option on the log form should be disabled/hidden until
  that first counting round exists.
- Surface this clearly in the log-a-round UI (not just a silent validation
  error): explain that the first logged round needs to be a full 18 to
  establish an index, and 9-hole rounds can be logged after that.

## Decision 3: 9-hole rounds are blocked from all tournament formats

A 9-hole round cannot be applied to any active tournament — Stroke Play,
Scramble, or Best Ball. (Match Play tournament brackets are a separate
gross hole-by-hole feature and aren't in scope here either way.)

- On the log-a-round form, if the round being logged is 9 holes, do not show
  the "Apply this round to [tournament name]?" prompt at all, for any
  eligible active tournament, regardless of format.
- This isn't a UI-only guard — add a server-side check that rejects a
  9-hole round from being associated with a tournament, in case the client
  check is bypassed.
- Rationale to preserve in code comments / PR description: Stroke Play nets
  a rounded course handicap off gross score and averages against players who
  played 18, so a 9-hole gross would distort standings (e.g. a 40 gross on 9
  holes reading as a rout against full-round scores). Scramble and Best Ball
  hole cards are hardcoded to 18-hole entry with no shorter path, so there's
  no tournament flow a 9-hole round could complete anyway.

## Decision 4: Close the Social Match Play "Save to index" side door

Separate from the log-a-round changes above: `matchPlayIndexRound.ts`
(the bridge that lets a finished Social Match Play match save itself as a
counting round via "Save to index") currently uses full 18-hole tee
rating/slope regardless of whether the match's **Holes** setting was 18,
Front 9, or Back 9. Once 9-hole differentials are handled correctly
elsewhere, this path becomes a way to sneak a mis-scored 9-hole differential
into a player's index.

Scope for this build: disable "Save to index" specifically when the
match's Holes setting is Front 9 or Back 9. Full 18-hole matches are
unaffected. Do not attempt to make this path support correct 9-hole
differentials in this build — that's a follow-up, tracked separately (see
below).

- Update the post-match results screen: when Holes was Front 9 or Back 9,
  don't show "Save to index" (Skip-only, or an explanatory disabled state —
  match existing UI patterns for similar disabled actions).
- Server-side: reject a save-to-index call for a Front 9 / Back 9 match even
  if the client-side control is somehow bypassed.

## Explicitly out of scope for this build

- WHS-style pairing of two 9-hole rounds into one synthetic 18.
- Making the Match Play "Save to index" bridge correctly produce 9-hole
  differentials for Front 9 / Back 9 matches. That's a follow-up once this
  build's 9-hole differential math is in and proven out — file it as its own
  ticket, don't fold it in here.
- Any change to Match Play (Tournament bracket) gross hole-scoring.
- Any change to the "Scramble rounds don't count toward index" behavior or
  its sync-path reliability (called out as uncertain in existing docs; not
  what this build touches).

## Suggested build order

1. Data layer: add the `nine_hole_source` flag and the swappable resolver
   (`getNineHoleRatingSlope` or equivalent) that returns derived numbers
   (rating ÷ 2, same slope) by default and real numbers when present, per
   Decision 1's resolved data-prerequisite section above. No backfill
   needed for this build — derived is the default for every existing tee.
2. Differential math: 9-hole raw/adjusted differential calculation, calling
   the resolver from step 1 rather than reading rating/slope directly, and
   reusing the existing difficulty-modifier pipeline unchanged.
3. Log-a-round UI: add the Holes selector (18 / Front 9 / Back 9) per the
   "UI guidance" section above, including the adjusted score range, tee
   chip behavior, post-save indicator, and gating behind the null-index
   check (Decision 2).
4. Log-a-round UI + server: suppress and reject tournament application for
   9-hole rounds (Decision 3).
5. Index calculation: confirm 9-hole adjusted differentials flow into the
   existing best-8-of-20 average with no special-casing needed beyond step 2.
6. Match Play bridge: gate "Save to index" off for Front 9 / Back 9 matches
   (Decision 4).
7. Tests: null-index gate (first round must be 18), tournament-apply
   suppression across all three formats, Match Play save-to-index gating,
   and an index-math regression test confirming a 9-hole round contributes
   one full differential correctly weighted against existing 18-hole rounds
   in the best-8-of-20 average.

## Resolved: 9-hole rating/slope data prerequisite

Cursor checked before starting implementation, per the instruction above,
and confirmed the catalog has only combined 18-hole rating/slope — no
Front 9 / Back 9 data anywhere, curated or community. Rather than block on
sourcing real per-nine data (not realistically available at this stage —
see Decision 1), the decision is to ship a derived approximation (18-hole
rating ÷ 2, same slope) behind a swappable resolver, so real data can
replace it per-tee later with no changes to differential math. Full
details are in Decision 1 above; this is not a separate open item anymore.
