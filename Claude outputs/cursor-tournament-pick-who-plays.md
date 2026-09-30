Add a "pick who plays" step to tournament creation — right now every
group member is auto-entered, no way to run a tournament among just a
subset of the group.

## Confirmed by reading the code

`app/(tabs)/league-create/[groupId].tsx` line 90:

```
const members = group?.members.filter((m) => m.userId) ?? [];
```

That's the entire group membership, unfiltered, and it's used for
everything downstream — format eligibility
(`MIN_GROUP_MEMBERS_FOR_TEAM_FORMATS`, `teamFormatsDisabled`), team-size
suggestions, match play seeding, team auto-assignment, and it's passed
straight into `createLeague({..., members, ...})` when the tournament is
created.

`createLeague` already accepts an explicit `members` array, which
suggests league participation is already tracked separately from group
membership — this should mostly be a UI addition, not a data-model
change. Confirm by checking whether the "Active Tournaments" round-apply
prompt on Log a Round filters eligible tournaments by the league's own
stored member list or by group membership generally — if it's currently
checking group membership, fix that too, or someone deliberately left
out could still get prompted to apply rounds to a tournament they're not
in.

## Step order (decided, don't leave this to chance)

New step goes **right after Basic Info (name + format), before Players
per team / Settings**. Reasoning: format is already chosen by that
point, so the format's constraints (min 4 for Scramble/Best Ball, even
number for Match Play) can be validated live against whoever's selected
on this new screen, instead of the admin picking participants first and
only finding out afterward that their format doesn't work for that
group size.

Full order becomes: Basic Info → **Who's playing** → Players per team
(team formats only) → Settings → Assign Teams (team formats only) →
Review & Launch.

## Screen design: "Who's playing"

- Title: **Who's playing?**
- Helper text: "Everyone in the group is included by default. Uncheck
  anyone who's sitting this one out."
- Full group roster as a checkbox list, all checked by default (matches
  today's behavior as the common case).
- "Select all" / "Deselect all" toggle at the top — needed for larger
  facility groups where unchecking one-by-one from 40 people would be
  painful.
- A simple text filter/search field above the list, shown once the
  group is past some reasonable size (e.g. 15+) — not needed for small
  groups, worth having for facility-scale ones.
- Running counter below the list: "16 selected."
- Live validation: if the current selection doesn't satisfy the chosen
  format's requirement, show the same style of inline warning already
  used elsewhere in this wizard (e.g. today's "Requires at least 4 group
  members" / match-play-disabled messaging) — e.g. "Match Play needs an
  even number of players (currently 15)." Continue stays disabled until
  the selection is valid.
- Continue advances to Players per team (or Settings, for non-team
  formats) using only the selected subset from here on — that filtered
  list becomes what everything downstream (`unassignedMembers`, team
  auto-assign, match play seeding, and the final `members` sent to
  `createLeague`) operates on.

## Things to check

- Confirm league membership is already stored separately from group
  membership (looks like it is, since `members` is passed explicitly to
  `createLeague`) — if not, this needs a schema change first.
- Fix the round-apply eligibility check on Log a Round to filter by the
  tournament's actual participant list, not just group membership, if
  it isn't already.
- No change needed to Manage tournament for this feature specifically —
  rosters still lock at launch; this only changes who's eligible to be
  included when the tournament is first created. Roster editing after
  launch is a separate piece (see the roster-edit prompt).
