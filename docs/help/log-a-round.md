# How to log a round

Use **Log a round** from the center tab. The screen is one scrolling form (not a multi-step wizard).

After you save, the round updates your SimCap index, Home chart, and Profile, and opens round analysis.

## Before you fill the form

Defaults when starting a new round:

- **Sim platform** — your preferred platform from Profile (otherwise Trackman)
- **Course** — Pebble Beach Golf Links
- **Date played** — today
- **Score** — 72
- **Putting mode** — Auto / 2-putt
- **Pin placement** — Thu / Round 1 (GSPro) or Easy (other platforms)
- **Wind** — Off / Calm
- **Mulligans** — None / No mulligans
- **Tee** — the course’s default tee (Pebble defaults to White)

## Step by step

### 1. Sim platform

Tap **Sim platform** and choose one of:

- Trackman
- Foresight
- Full Swing
- E6
- GSPro
- Garmin

Platform itself is **not** a separate difficulty multiplier. It mainly changes pin labels/options and which tee rating/slope rows you see for the course. The difficulty product uses putting × pin × wind × mulligans × the sim baseline only (see [SimCap handicap index](./simcap-handicap-index.md)).

### 2. Course

Tap **Course**, search by name if needed, and pick from the list.

Only courses in SimCap’s catalog appear. There’s no free-form custom course field.

### 3. Optional: Scan Scorecard (GSPro only)

If the platform is **GSPro**, you’ll see **Scan Scorecard 📷**.

- On a phone you can use **Photo library** or **Camera**.
- The scan may fill score, tee, putting mode, pin, wind, and mulligans.
- Always review before saving. You may see banners such as:
  - Scorecard scanned — please review before logging.
  - We weren't sure about some fields — please review carefully before logging.
  - Couldn't read this scorecard — please enter your round manually.

### 4. Date played

Use **Date played**.

Hint text: *Used for your index timeline and recent rounds order.*

The picker allows calendar years from **2018** through **current year + 1**. It does not strongly block unusual past or near-future dates beyond that year range and valid day-of-month clamping.

### 5. Tee

You’ll see **Tee** for normal catalog courses, plus this tip:

> Pick the tee closest to the total yardage you actually played, tee names and colors vary by simulator. If nothing's close, use Custom.

Each tee chip shows rating / slope, and yardage when available.

**Custom** shows:

- **Course rating** (example placeholder `e.g. 72.1`)
- **Slope** (example placeholder `e.g. 128`)

Custom values must be roughly rating **60–85** and slope **55–155**.

### 6. Score

Use **−** / **+** to set your gross score between **55** and **120**.

This screen logs a total gross score (not hole-by-hole for a normal round).

### 7. Putting mode

| Primary | Sublabel |
| --- | --- |
| Auto | 2-putt |
| Gimme | &lt;5ft |
| Putt | Everything |

### 8. Pin placement

Depends on platform:

**GSPro**

| Label | Sublabel |
| --- | --- |
| Thu | Round 1 |
| Fri | Round 2 |
| Sat | Round 3 |
| Sun | Round 4 |

**Other platforms**

- Easy
- Medium
- Hard

Changing platform can reset pin if the previous choice isn’t available.

### 9. Wind

| Primary | Sublabel |
| --- | --- |
| Off | Calm |
| Light | Breeze |
| Strong | Heavy |

### 10. Mulligans

| Primary | Sublabel |
| --- | --- |
| None | No mulligans |
| 1 | One allowed |
| 2 | Two allowed |
| 3+ | Three or more |

### 11. Preview

Before saving you’ll see:

- **Difficulty modifier** — based on putting, pins, wind, and mulligans (not platform)
- **Adjusted differential** — what feeds your SimCap index
- **Expected differential** — after you already have at least one counting round
- Optionally: **Shoot N or better to improve your index**

Tap ⓘ next to a differential for a short explanation.

### 12. Active tournaments (if any)

If you’re in an eligible active tournament, you’ll see **Active Tournaments**:

**Apply this round to [name]?** → **Yes** / **No** (defaults to Yes)

Extra notes may appear for Scramble or Best Ball.

**Scramble-only and your index:** if you opt into Scramble and do **not** also opt into any format that counts for the index (Stroke Play / Best Ball / Match Play), the log path sets a local `excludesFromSimcapIndex` flag so the round should not change your SimCap index in that session. That flag is **not** written to the `rounds` table and is **not** restored when rounds are fetched from Supabase — after a sync/refetch, a scramble-only round is treated as a normal counting round. Prefer not relying on scramble-only exclusion across devices or after a full reload until that is fixed in the product.

### 13. Save

Tap **Save round** (or **Save changes** if you’re editing).

Hint under the button: saves to your SimCap account, opens Round analysis, and updates your sim index, home chart, and profile.
