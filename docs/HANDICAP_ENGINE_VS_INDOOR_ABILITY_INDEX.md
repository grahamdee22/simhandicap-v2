# Audit: SimCap handicap engine vs Indoor Ability Index (v0.6)

**Date:** 2026-10-31  
**Scope:** Research / comparison only — not an implementation brief.  
**Sources:** SimCap codebase (`src/lib/handicap.ts` et al.), live Supabase counts, [indoorgolfhandicap.org](https://indoorgolfhandicap.org/) draft v0.6 public copy.

---

## 1. Current-engine audit (SimCap today)

### 1.1 Per-round differential → player index

**Raw differential (WHS-shaped):**

```
raw = (adjusted_gross_score − course_rating) × 113 / slope
```

Implemented in `rawDifferential` / `adjustedDifferentialForVersion` in [`src/lib/handicap.ts`](../src/lib/handicap.ts).

**Sim condition modifier** (assigned multipliers, not learned):

| Input | Multipliers (higher → harder credit / higher adj. diff for same gross) |
| --- | --- |
| Putting | `putt_all` 1.0 · `gimme_5` 1.05 · `auto_2putt` 1.15 |
| Pin day | Thu 1.12 → Sun 1.0 |
| Wind | off 1.1 · light 1.05 · strong 1.0 |
| Mulligans | none 1.0 · one 1.15 · two 1.3 · three_plus 1.5 |
| Then | × `SIM_BASELINE` **0.88** (flat “sim is easier” discount), floor **0.5** |

`adjusted = round1(raw × modifier)` via `difficultyProduct` + `adjustedDifferentialForVersion` (version marker `CURRENT_DIFFERENTIAL_VERSION = 1`).

**Index from differentials** — `handicapIndexFromDifferentials`:

- Window: last **up to 20** counting differentials (chronological).
- Take the **best (lowest) 8** (or fewer if &lt; 8 rounds).
- Average × **0.96**, round to 1 decimal.

Home / live index: `currentIndexFromRounds` in [`src/store/useAppStore.ts`](../src/store/useAppStore.ts) — filters `!excludesFromSimcapIndex`, sorts by `playedAt`, then the formula above. **One round is enough** to show a non-null index (no confidence band).

**Tournament “established” gate** (separate from home display): [`src/lib/effectiveHandicap.ts`](../src/lib/effectiveHandicap.ts)

- `SIMCAP_INDEX_MIN_ROUNDS = 3` → use SimCap index.
- Else fall back to profile **GHIN** if present.
- Else `null` (no tournament handicap).

Logging path: `addRound` computes math once at save (`computeRoundMathFromRatingSlope`), stores `differential`, `raw_differential`, `difficulty_modifier`, `differential_version`, CR/slope, settings on the round row ([`src/lib/rounds.ts`](../src/lib/rounds.ts), Supabase `rounds`).

### 1.2 Course / tee difficulty representation

**Assigned ratings**, not pooled learning. Provenance via `rating_source` ([`src/lib/ratingSource.ts`](../src/lib/ratingSource.ts)):

| Source | Meaning |
| --- | --- |
| `curated` | Built-in / catalog tees with known CR/Slope |
| `community` | Community course tees (e.g. enriched GSPro difficulty) |
| `user_reported` | Player-entered official CR/Slope |
| `default_unrated` | Fallback: rating ≈ par, slope **113** |

`isUnratedTee` treats `user_reported` / `default_unrated` as informational badges — **math still uses whatever CR/Slope is stored**. This is the opposite of IAI’s “difficulty learned from scores”: SimCap needs an assigned (or defaulted) rating *before* a differential can be computed.

### 1.3 Nine-hole rounds

- CR/Slope for Front/Back 9: [`src/lib/nineHoleRating.ts`](../src/lib/nineHoleRating.ts) — prefer real per-nine fields; else **derive** `rating = 18-hole CR ÷ 2` (1 decimal), slope unchanged. Marked `nineHoleSource: 'derived' | 'real'`. Explicitly **not** WHS-official 9-hole scoring.
- 9-hole logging unlocks once the player already has a non-null SimCap index (`nineHoleLoggingUnlocked`).
- For **course handicap / net strokes** on 9-hole tournament cards: `indexForCourseHandicap` halves the index (WHS-style step) in [`src/lib/netHandicap.ts`](../src/lib/netHandicap.ts).
- 9-hole differentials still enter the same best-8-of-20 pool as 18-hole rounds (no separate 9-hole combining rule like outdoor WHS 9+9).

### 1.4 Outliers / anomalous rounds

**No ESC / per-hole soft cap / net double bogey** in the index path. Gross is used as logged (with UI bounds ~55–120 for 18, ~27–65 for 9). One blow-up hole fully hits the differential.

Players can mark rounds `excludes_from_simcap_index` (practice / opt-out) so they don’t enter the index window — voluntary exclusion, not automatic outlier detection.

### 1.5 Anti-manipulation / anti-sandbagging (beyond Group Challenge modes)

| Mechanism | Where | What it does |
| --- | --- | --- |
| Condition multipliers | `handicap.ts` | Penalize easy settings (auto-2-putt, no wind, mulligans) |
| Sim baseline 0.88 | `handicap.ts` | Global ease-of-sim discount |
| Exclude-from-index flag | rounds / log UI | Opt out practice rounds |
| Tournament established ≥3 rounds | `effectiveHandicap.ts` | Prefer SimCap only after a short history; else GHIN |
| Group Challenge ≥5 qualifying rounds | `groupChallengeHelpers.ts` | Roster eligibility guard |
| Group Challenge Verified | rounds + admin approve | Evidence + **own-group** admin approval |
| One player / one side | DB unique on challenge roster | Can’t play both crews |

**Missing vs IAI-style anti-sandbag:** no sanctioned-only scoring network, no per-hole caps, no “index falls fast / rises slow,” no exceptional-score automatic cut, no competition-result auditing.

### 1.6 Snapshot immutability — still true

**Round differentials / CR / slope / settings**

- Written at log time onto `rounds` (`differential`, `course_rating`, `slope`, `tee_rating_source`, condition fields, `differential_version`).
- Live index always re-averages those **stored** differentials — it does **not** re-pull catalog CR/Slope when a course row is later edited.
- Editing a round (`updateRound`) recomputes math from the **round’s own** stored CR/slope/settings (and current formula version rules), not from a freshly looked-up catalog.

**Tournament / challenge nets**

- League rounds store `net_score` (and related) at opt-in / score time; group challenges store `handicap_snapshot` at **activate** (`buildHandicapSnapshot` / `activate_group_challenge`) and net from that snapshot (`netScoreForGroupChallengeRound` — comment: “never live index”).
- `simcap_index_at_time` on rounds records index-before-save for history/UI.

So: **yes — differentials and competition nets are snapshotted; they are not retroactively rewritten when course data or global settings change later.** Formula version is stamped so a future `CURRENT_DIFFERENTIAL_VERSION` bump can leave old rounds alone (only new/edited rounds use the new case).

---

## 2. Side-by-side comparison

| Dimension | SimCap (today) | Indoor Ability Index (v0.6 public description) |
| --- | --- | --- |
| **Difficulty / conditions** | Assigned CR/Slope (+ provenance label). Conditions = fixed multiplier tables × sim baseline. | Difficulty **learned** from pooled scores per setup. Conditions (wind, green speed, firmness, gimme) **fit from data**. |
| **What the number means** | Best-8-of-20 × 0.96 average of adjusted diffs (WHS-shaped “recent form”). | “Expected good day” (~1 round in 5), not average; personal variability in the model. |
| **Confidence / provisional** | No ± band. Home index from 1+ rounds. Tournament “SimCap source” needs **3+** counting rounds (else GHIN). No provisional label on UI. | Usable after **1** sanctioned round with **± confidence**; flips provisional → established when band tightens (they cite ~5–6 rounds). |
| **Anti-sandbagging** | Settings multipliers; optional exclude; GC eligibility + Verified; little else. | Sanctioned-only, hole caps, asymmetric index movement, exceptional cuts, competition audit. |
| **Data needed to be trustworthy** | Useful per-player with a handful of rounds **if** CR/Slope are honest. Network-wide learning not required. | Phased gates: ~**2,500** rated rounds for measured conditions; ~**300** dual players / ~40 setups for full fidelity (their published targets). |
| **Portability story** | Same player identity + assigned ratings across platforms; modifiers normalize settings. | Same, but portability comes from **adjusting for learned setup/conditions** before the score hits the index. |
| **Openness** | Proprietary product formula (documented in-app/help). | Open, versioned standard; nightly refit narrative. |
| **Retroactive model changes** | Version stamp; old diffs stay unless round edited. | Spec says capability/version updates are labeled, not silent. |

---

## 3. Data maturity (live counts, non-test)

Pulled 2026-10-31 against production (`profiles.is_test = false`, `rounds.is_active = true`):

| Metric | Count |
| --- | --- |
| Non-test profiles | **111** |
| Active rounds owned by those profiles | **101** |
| Of which counting (`excludes_from_simcap_index = false`) | **101** |
| Golfers with ≥1 active round | **36** |
| Golfers with ≥5 active rounds | **6** |
| Golfers with ≥8 | **2** |
| Golfers with ≥20 | **1** |

**Vs IAI Phase 1 (~2,500 rated rounds):** SimCap is ~**4%** of that volume.  
**Vs Phase 2 (~300 dual/experienced golfers):** only **36** golfers have any counting history; **6** have ≥5 rounds — not in the same ballpark.

### Cheap to adopt at low volume (idea-level only)

- **Provisional + confidence UI** without Bayesian learning: e.g. label indexes “provisional” until N rounds, show a simple ± from sample variance of recent diffs. Needs design + careful copy; does **not** need 2,500 rounds.
- Stronger **hole soft-cap / ESC-like** rule on differentials (local, per-round).
- Clearer **unrated course** down-weighting or separate “estimated difficulty” badge in competition (partially exists as `rating_source`).
- **Asymmetric index movement** or hold-large-increases-for-review (policy + product).

### Genuinely needs network scale

- Learning setup difficulty from pooled residuals.
- Fitting condition effects (wind / green speed / firmness / gimme) from data instead of hand tables.
- Cross-facility / cross-sim brand difficulty graphs and dual indoor–outdoor bridging as IAI describes.
- Competition-result auditing at population scale.

**Bottom line:** SimCap’s assigned-rating + modifier model is the right shape for **today’s** volume. A pooled/learned-difficulty engine would be underdetermined and unstable on ~100 rounds / ~36 active golfers.

---

## 4. Validation / backtesting framework

**What exists today**

- Unit tests for pure math: `src/lib/__tests__/handicapSource.test.ts`, `nineHoleRating.test.ts`, `nineHoleCourseHandicap.test.ts`, `effectiveHandicap.test.ts`, etc.
- Lifecycle smoke/verify scripts under `scripts/verify/` for tournaments/matches — **not** handicap-model A/B against historical indexes.
- `differential_version` on each round is the hook for “old formula stays put.”

**What does not exist**

- No harness that loads historical `rounds`, recomputes differentials under a candidate formula, rebuilds indexes, and diffs vs production indexes / competition outcomes.

**Minimal backtest (rough build sketch)**

1. Export active non-test rounds: `gross`, stored CR/slope, putting/pin/wind/mulligans, `differential` (baseline), `differential_version`, `played_at`, `user_id`, `excludes_from_simcap_index`.
2. For candidate formula F: recompute `adjustedDiff'` per round (respecting whether F is version-gated).
3. Per user, chronological `handicapIndexFromDifferentials` (or candidate index rule) → series of indexes.
4. Report: Δindex distribution, % of players moving &gt;X strokes, impact on stored league/challenge nets **if** those were recomputed (usually they shouldn’t be — snapshot policy).
5. Optional: holdout by date; compare predictive power (next-round residual) — only meaningful once volume grows.

Effort: small Node/tsx script + fixtures; days, not weeks — **if** scope stays “replay differentials → indexes,” not full product migration.

---

## 5. Licensing / trademark flag (not a legal conclusion)

Worth a **real legal look** (flag only):

- Public and in-product use of **“Course Rating,” “Slope” / “Slope Rating,”** and the constant **113** in the differential and course-handicap formulas.
- Index construction that closely parallels **WHS** (best of last 20 × 0.96-style reduction; 9-hole index halving for course handicap).
- Marketing language that can be read as “WHS-style” / outdoor-handicap-equivalent (site already disclaims GHIN affiliation on `/simulator-golf-handicap/` — keep that sharp).
- IAI’s public FAQ stresses outdoor ratings are proprietary and not licensed for indoor use — that’s the same hazard zone SimCap sits in by **using** CR/Slope numbers at all, even when sourced from community/defaults.

This audit does **not** conclude infringement or safety; it only marks the overlap as material enough for counsel.

---

## 6. Short takeaway

SimCap today is an **assigned-difficulty, WHS-shaped, condition-multiplier** engine with strong **snapshot immutability** and light competition guards. The Indoor Ability Index is a **pooled Bayesian / learned-difficulty** open standard with provisional confidence and heavier anti-sandbag machinery — gated on data volumes SimCap is nowhere near yet (~100 vs ~2,500 rounds). The useful near-term borrow is **UX honesty** (provisional labels, clearer unrated handling), not a premature learned-difficulty rewrite.
