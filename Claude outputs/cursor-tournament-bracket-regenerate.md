Add a bracket-regenerate control to Manage tournament — the app already
promises this exists, it doesn't.

## Confirmed by reading the code

In `app/(tabs)/league-create/[groupId].tsx`, a failed bracket generation
at launch shows: "Tournament created. Bracket could not be generated:
[error]. Use Manage tournament to try again."

But `app/(tabs)/league-manage/[id].tsx` only has: save name, save end
date, a read-only pairings list, end tournament early, delete tournament
— no regenerate/retry control at all.

The function already exists and is already used at creation time:
`generateMatchPlayBracket(leagueId, seededUserIds, accessToken)` in
`src/lib/matchPlayTournamentPairings.ts`. `fetchLeagueMatchPairings`
(already used in league-manage) tells you whether pairings exist.

## Two distinct states, designed separately

**State A — bracket never generated (the actual bug being fixed).**
Where the screen currently shows "No pairings yet." for a Match Play
tournament with zero pairings, replace that with:

- A short line: "Bracket wasn't generated when this tournament
  launched."
- A primary button: **Generate bracket**.
- No confirmation needed — nothing exists yet to lose, so this should
  be a single tap straight into a loading state (button shows a
  spinner, disabled while in flight).
- On success: swap the button out for the real pairings list, same
  layout used when a bracket already exists, plus a brief confirmation
  banner: "Bracket generated — lowest index is the #1 seed" (matches
  the wording already used at creation time, for consistency).
- On failure: show the actual returned error inline, in the same red
  banner style already used elsewhere in the app for failed states.
  Keep the Generate bracket button visible so they can retry without
  leaving the screen.

**State B — bracket already exists.** This is the "fix a bad bracket"
escape hatch, not the primary bug, but worth including since it's the
same underlying function. Rule: only offer this when none of the
existing pairings have a recorded result yet (check pairing status via
`fetchLeagueMatchPairings`). If any match already has a result, hide
this option entirely — regenerating at that point would destroy real
completed play, and that's not an acceptable trade for an escape hatch.

- When eligible, show a smaller, secondary "Regenerate bracket" text
  link below the pairings list, not a prominent button — this should
  read as a rare/advanced action, not something to reach for casually.
- Tapping it requires confirmation, styled like the existing "Delete
  tournament?" confirm dialog: "Regenerate bracket? This will discard
  the current pairings and reseed from scratch." Confirm / Cancel.
- Same success/failure handling as State A.

## Things to check

- Confirm there isn't a reason bracket regeneration was left out of
  Manage originally (e.g. an assumption elsewhere that a league without
  pairings is always brand new) before wiring this in.
- Confirm `fetchLeagueMatchPairings`'s pairing status field is enough to
  determine "has any match been played yet" for the State B gating
  rule above.
