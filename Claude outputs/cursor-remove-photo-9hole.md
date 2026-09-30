Scope change to the Match Play "Create Match" wizard's "Sim setup photo"
step, now covering both a holes condition and a platform condition.

## Current behavior

Step 6 of 7 ("Sim setup photo") requires a photo to be chosen before
Continue is enabled, for every match on every platform.

## New behavior

Skip the "Sim setup photo" step entirely — go straight from Step 5 (Holes)
to what is currently Step 7 (Review & send) — in either of these cases:

1. Holes = Front 9 or Back 9 (any platform). Already scoped below.
2. Platform = web (any Holes selection, including 18).

Only require the photo when Platform is native (iOS/Android) AND Holes =
18 holes.

Reasoning for the web exemption: on web there's no camera/photo-library
API to hook into, so "Choose photo" falls back to the browser's OS-level
file picker — a plain file chooser, not the native "Take Photo / Choose
from Library" sheet. That's an acceptable degraded UX to just skip rather
than ship, so drop the step on web across the board. Keep requiring it on
the native app where the real picker sheet is available, for 18-hole
matches.

Use `Platform.OS === 'web'` (or however the codebase already gates
web-only behavior elsewhere) for the platform check.

Adjust the step counter/labels accordingly wherever the step is skipped
(6-step flow instead of 7).

## Things to check while making this change

- Confirm the sim-setup-photo field on the match record is already
  nullable (or make it nullable) — matches created via the skip paths
  above will now have no photo.
- Any opponent-facing surface that displays the sim setup photo needs to
  handle a missing photo gracefully — no broken image icon, just omit
  that section/element. Specifically:
  - The opponent's challenge-review screen (the current Step 6 copy says
    "so your opponent can see your exact setup," implying there's a
    display surface on their side before they accept — this needs the
    same missing-photo handling).
  - The active/in-progress match screen, if the photo is shown there as a
    reference during play.
  - The post-match results screen, if the photo is shown there.
  I haven't verified these three screens directly (QA never got past the
  photo step live on web), so please confirm which of them actually
  reference the photo and handle each one.
- Double check nothing server-side currently rejects match creation for a
  missing photo — if there's a validation step tied to photo presence, it
  needs the same exemptions (web, and Front9/Back9).

## Why

Came up during QA: the photo picker requirement was creating friction on
web generally (native OS file dialog, not a proper picker) and specifically
on the 9-hole path. Since Decision 4 already treats Front 9 / Back 9
matches as excluded from "Save to index," there's no correctness reason to
keep requiring a photo there either way.
