# How the SimCap handicap index is calculated

Your **Sim handicap index** on Home is built from the rounds you log. It is inspired by World Handicap System ideas, but it is SimCap’s own formula with simulator-condition adjustments — **not** a full copy of every current WHS rule (for example, it always uses “best up to 8 of last 20 × 0.96” rather than the full staged WHS score-count tables).

## The short version

1. Each logged round becomes an **adjusted differential**.
2. SimCap looks at your most recent counting rounds (up to 20).
3. It averages your best differentials (up to 8).
4. It multiplies that average by **0.96**.
5. It rounds to one decimal place.

That result is your SimCap index.

## What counts as a counting round

Most normal logged rounds count.

Soft-deleted / inactive rounds don’t count.

**Scramble-only rounds:** the log screen can set a local `excludesFromSimcapIndex` flag when a round is applied only to Scramble (and not to any index-counting tournament). Index math in the store respects that flag. The flag is **not** persisted on the `rounds` row and is dropped on fetch from Supabase, so after sync the same round counts like any other. Stroke Play and Best Ball tournament rounds are intended to count.

## Step 1: Raw differential

For each round:

`(Gross score − Course rating) × 113 ÷ Slope`

- Gross score is the total you logged (55–120 on the log screen).
- Course rating and slope come from the tee you picked, or from **Custom** if you entered your own.

## Step 2: Difficulty modifier

SimCap multiplies several condition factors together, then applies a universal sim baseline.

**Platform is not a factor** in this product. Choosing Trackman vs GSPro etc. does not add a separate multiplier; it mainly changes pin labels and tee data.

**Putting mode**

| Setting | Factor |
| --- | --- |
| Putt / Everything | 1.00 |
| Gimme / &lt;5ft | 1.05 |
| Auto / 2-putt | 1.15 |

**Pin placement**

| Setting shown | Factor |
| --- | --- |
| Thu (GSPro) / Easy | 1.12 |
| Fri (GSPro) / Medium | 1.08 |
| Sat (GSPro) | 1.04 |
| Sun (GSPro) / Hard | 1.00 |

**Wind**

| Setting | Factor |
| --- | --- |
| Off / Calm | 1.10 |
| Light / Breeze | 1.05 |
| Strong / Heavy | 1.00 |

**Mulligans**

| Setting | Factor |
| --- | --- |
| None | 1.00 |
| 1 | 1.15 |
| 2 | 1.30 |
| 3+ | 1.50 |

**Sim baseline:** × **0.88**  
(This is a built-in adjustment for typical simulator conditions such as flat lies and ideal turf. It is always applied; you don’t choose it on the form.)

Final modifier:

`putting × pin × wind × mulligans × 0.88`

The modifier is also floored at **0.50** (current selectable settings don’t usually reach that floor).

Easier conditions raise the modifier (your differential looks worse for the same gross). Harder conditions lower it (more credit).

## Step 3: Adjusted differential

`Raw differential × Difficulty modifier`

Raw and adjusted differentials are rounded to one decimal place. The modifier shown on the log screen is rounded to two decimals.

This adjusted differential is what feeds your index.

## Step 4: Build the index

From your counting rounds, ordered by played date:

1. Take the latest **20** adjusted differentials (or all of them if you have fewer than 20).
2. Sort those differentials best-to-worst (lower is better).
3. Average the best **8** (or all of them if you have fewer than 8).
4. Multiply by **0.96**.
5. Round to one decimal.

Examples of how many differentials are averaged:

- 1 round → average that 1
- 5 rounds → average the best 5
- 8+ rounds → average the best 8 of the latest 20

There is **no** separate upper/lower index cap in the current formula.

## How the index is displayed

- Typical index: `4.3`
- Below scratch: stored as a negative number and shown with a plus, for example `+2.1`
- No index yet: `—`

Home can show a SimCap index as soon as you have **at least one** counting round.

## Important: two different “established” rules

These are not the same:

| Place | Rule in the app today |
| --- | --- |
| **Home Sim handicap index** | Appears after **1** counting round |
| **Tournament effective handicap** | Uses SimCap only after **3** counting rounds; otherwise falls back to GHIN from the player’s profile when available |

If someone has only one or two rounds, they can already see an index on Home, while a tournament may still treat them as using GHIN.

## What the log screen is previewing

While logging:

- **Adjusted differential** — your raw differential after the difficulty modifier. This is what gets used for the index.
- **Expected differential** — roughly what SimCap expects from a golfer at your current index on that course/tee with those conditions. If your adjusted differential is better (lower) than expected, your index should improve.

## Notes / unclear behavior

- Round detail’s “outside the best 8 / 20” helper uses a local `top8Ids` that ranks **all** rounds in the store by adjusted differential. Home index math uses `roundsForSimcapIndex`, which filters out rounds with `excludesFromSimcapIndex`. Those two sets can disagree when scramble-exclusion flags are present in memory. Trust the Home index over that helper label when they conflict. (This is a code inconsistency, not just missing docs.)
