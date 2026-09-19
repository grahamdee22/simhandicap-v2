# How to create and run a tournament

Tournaments belong to a group. Only the group **Creator** or an **Admin** can create and manage them.

## Before you start

1. Open the **Social** tab.
2. Select the group under **My Groups**.
3. Scroll to **Tournaments**.

You can create a tournament only when the group doesn’t already show an active one. Members who aren’t managers see **No active tournament** until one exists.

A group can have only one tournament with `status = active` at a time (create is blocked if any such row exists). The Social list only **shows** a tournament as active when today’s date falls between its start and end dates (`isLeagueActive`). Those two rules interact oddly with future start dates — see [Future start dates](#future-start-dates) below.

## Create a tournament

Tap **Create Tournament**. You’ll move through a short wizard.

### Step: Basic info

1. Enter a **Tournament name** (placeholder example: `Spring League`).
2. Choose a **Format**:

| Format | What the app says |
| --- | --- |
| **Stroke Play** | Total strokes win. Log your rounds, and the lowest average net score over the tournament wins. |
| **Match Play** | Single-elimination bracket seeded by SimCap index. Win holes to advance — the bracket is the standings. Requires 2–30 players (even number). |
| **Scramble** | Everyone hits, the team picks the best shot, and you all play from there. One team score per hole. |
| **Best Ball** | Everyone plays their own ball. The lowest score on each hole counts for the team. |

- **Scramble** and **Best Ball** need at least **4** group members.
- **Match Play** needs an **even** number of members between **2** and **30**.

All current group members are entered automatically. There is no “pick who plays” step during creation.

Tap **Continue**.

### Step: Players per team (Scramble / Best Ball only)

Choose how many players are on each team. SimCap creates the teams for you.

- Preset options: **2**, **3**, **4**, or **5** players per team (when that evenly divides the group)
- **Custom** for larger team sizes when available

Teams must divide evenly, and each team needs at least 2 players.

Tap **Continue**.

### Step: Settings

You’ll set:

- **Start date** (defaults to today)
- **End date** (defaults to 28 days later)
- **Rounds that count toward standings** (defaults to **4**, adjustable from 1–10) — not shown for Match Play
- **Use SimCap handicap** — On / Off (defaults to **On**)
  - Help text: adjusts scores using each player’s effective handicap (SimCap index when established, otherwise GHIN)
- **Override team handicap (optional)** — Scramble only. Leave blank for automatic 15%/85% calculation
- **Tournament notes (optional)** — up to 500 characters (example placeholder: course, tees, putting mode)

For **Match Play**, instead of rounds-that-count you’ll see **Single-elimination bracket** info and a seeded player list (#1 = lowest index).

Tap **Continue**.

### Step: Assign Teams (Scramble / Best Ball only)

1. Optionally tap **Auto-assign teams** (snake draft by handicap; players without a handicap may be placed randomly after a warning).
2. Or assign players manually from **Unassigned players** into **Team 1**, **Team 2**, and so on.
3. You can rename teams, move players, or remove them from a team.
4. For **Scramble**, pick a **Designated scorer** on each team. That person is the only one who can apply scramble rounds.

Every player must be assigned, and each team needs at least 2 players.

Tap **Continue**.

### Step: Review & Launch

Review the summary, then tap **Launch Tournament**.

- Success for most formats: members will see it in their group.
- Match Play success: **Bracket is ready — lowest index is the #1 seed.**
- If bracket generation fails, the create flow may say to retry from **Manage tournament**. Manage currently only lists pairings (plus name/end date/end/delete) — there is **no** regenerate-bracket control. Treat a failed bracket launch as needing a new tournament (or a code fix), not a Manage retry.

## How players enter scores

1. Open **Log a round** and save a round as usual.
2. If you’re in an eligible active tournament, you’ll see **Active Tournaments** with:

   **Apply this round to [tournament name]?** → **Yes** / **No**

   Each tournament defaults to **Yes**.

3. What happens next depends on format:

| Format | After you apply |
| --- | --- |
| **Stroke Play** | The round counts toward standings immediately (net = logged gross minus handicap when handicap is on). |
| **Match Play / Scramble / Best Ball** | You’ll be sent to a **Tournament scorecard** to enter all 18 hole scores. |

- Pending hole cards show a banner: **Complete your tournament scorecard**. Pending cards don’t count in standings until finished.
- You can **Finish later** and return from that banner.
- Scramble note on the log screen: only the designated scorer can apply rounds; scramble won’t affect your SimCap index (see [Log a round](./log-a-round.md) for the sync caveat on that exclusion).
- Best Ball note: Best Ball rounds count toward your SimCap index.

**Hole totals vs logged gross:** if the sum of hole scores doesn’t match the gross you first logged, the scorecard still allows submit. A banner explains that tournament scoring uses the hole totals while your SimCap differential keeps the logged gross. Submit does not require the totals to match.

**Best Ball teammate matching:** team hole aggregation groups by the round’s **played date** (`played_at` date). Cards logged on the same calendar date are treated as the same team round.

## How handicap settings actually apply

- **Stroke Play:** **Use SimCap handicap** clearly drives net = gross − effective handicap (when on and an index exists).
- **Tournament Match Play (bracket):** hole winners are compared with **gross** hole scores (`compareMatchPlayGrossHoles`). The handicap switch does not change that hole-by-hole comparison.
- **Scramble / Best Ball:** the `calculate-team-hole-scores` edge function always writes `team_net_score` equal to the gross team hole score. Standings helpers accept a `use_handicap` argument but do not apply a separate net adjustment on top of those stored hole totals. Do not expect the handicap switch or Scramble override to change team hole totals in the current implementation.

## Standings

On Social, the active tournament card shows format, days left, name, optional notes, a short preview, and **See full standings →**.

- **Stroke / Scramble / Best Ball:** ranked by **Low Net** (average of each player’s or team’s best N nets, where N is “rounds that count”). For Scramble/Best Ball that “net” is currently the same as the stored team hole totals (see above).
- **Match Play (bracket):** the bracket itself is the standings.

When a tournament completes, non-bracket formats show champion / 2nd / 3rd cards. Past events appear under **Past tournaments**.

## Manage a tournament

Open the tournament, then tap **Manage tournament** (creator/admin only). You can:

- **Save name**
- **Save end date** (extend the end date)
- View fixed team rosters or match pairings
- **End tournament early** — marks it completed and keeps final standings
- **Delete tournament** — permanently removes tournament data

Team rosters can’t be edited after launch. To change teams, create a new tournament.

A tournament can also complete automatically when its end date passes, or when every player/team has finished the required counting rounds / bracket final.

## Future start dates

If you set a **future start date** while leaving status active:

1. Social’s tournament list uses `isLeagueActive` (today must be ≥ start and ≤ end), so the event may **not** appear as the active card, and **Create Tournament** can reappear for managers.
2. Create is still blocked if any league row for the group has `status = 'active'`, including that future-dated one.
3. On the tournament detail screen, `completed` is computed as `status === 'completed' || !isLeagueActive(league)`, so a future-dated active event can show a **Completed** pill before it has started.

Prefer starting tournaments on or before today unless you intentionally want that behavior.
