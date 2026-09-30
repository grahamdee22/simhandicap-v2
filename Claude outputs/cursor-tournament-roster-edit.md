Allow editing a tournament's roster after launch — right now the only
option is deleting the whole tournament. Scoped to Stroke Play only for
this pass.

## Confirmed by reading the code

`app/(tabs)/league-manage/[id].tsx` shows team rosters as fully
read-only: "Rosters are set when the tournament is created. To change
teams, create a new tournament." No add, remove, or swap control
anywhere.

## Why Stroke Play only, for now

Stroke Play has no teams and no bracket — just a flat list of
participants logging rounds independently — which makes it the lowest-
risk format to support roster changes for first. Scramble/Best Ball
(team reassignment questions) and Match Play (bracket structure
questions) are real, harder design problems and are intentionally left
out of this pass — see the bottom of this doc.

## Screen design: Manage tournament (Stroke Play)

Add a **Players (N)** section to the existing Manage screen, below
whatever the format-specific info already shows.

**Remove a player:**
- Each player row gets a small remove action (X icon, or swipe-to-
  reveal — match whatever pattern the app already uses for removing
  something from a list elsewhere, for consistency).
- Tapping it opens a confirm dialog, same style as the existing "Delete
  tournament?" dialog:

  > Remove [Name] from this tournament?
  > Their rounds logged so far will still count toward final standings.
  > They won't be able to apply new rounds going forward.

  Confirm: **Remove**. Cancel available.
- Decided behavior (don't leave this for Cursor to guess): removal does
  **not** retroactively erase rounds they already applied — those stay
  counted in standings history. It only stops them from applying future
  rounds to this tournament. This matches how a real league works —
  someone dropping out mid-season doesn't erase the weeks they already
  played.
- After removal, that person should no longer see this tournament in
  the "Active Tournaments" apply-round prompt on their own Log a Round
  screen (same underlying eligibility check referenced in the
  pick-who-plays prompt — both features should end up sharing that same
  membership check rather than each rolling their own).

**Add a player:**
- An "Add player" button above the player list opens a picker of group
  members not already in the tournament. Support selecting more than
  one at once (an admin adding several new signups at the same time is
  a realistic case, not just one-at-a-time).
- Reuse the same checkbox-list pattern as the "Who's playing" step from
  tournament creation, for visual consistency between the two features.
- After confirming, show a short inline note, not a blocking dialog:
  "Added [N] player(s). They can start applying rounds now — rounds
  logged before today won't be backfilled." That second sentence
  matters: it heads off the "wait, why doesn't my round from last week
  count" confusion before it happens.

**Standings clarity:** add a small persistent note near the player list
(not just a one-time toast) along the lines of: "Standings only include
rounds logged while a player was on the roster." Small thing, but
prevents confusion later when someone looks at final standings and
can't figure out why a removed player's later rounds aren't there.

## Explicitly out of scope for this pass

- **Scramble / Best Ball:** removing someone from a team leaves it
  short-handed or needs a reassignment flow; adding someone means
  picking which team. Needs its own product decision on intended
  behavior before any building starts.
- **Match Play (bracket):** removing a seeded player mid-bracket raises
  real structural questions (bye vs. forfeit vs. reseed). Bracket
  regeneration (separate prompt) is the closest existing escape hatch,
  but that discards the whole bracket rather than surgically fixing one
  seed — full support for this needs its own design pass, not a rushed
  add-on here.
