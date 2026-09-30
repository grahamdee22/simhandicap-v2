Expand scorecard scan past GSPro-only — lower priority, ship in two phases.

## Current state (confirmed by reading the code first)

The scan feature is GSPro-only today, in two places:

- `app/(tabs)/log/round.tsx` only shows the scan option when
  `isGsProPlatform(platform)` is true — every other platform never sees
  the scan UI at all.
- `supabase/functions/parse-scorecard/index.ts`'s extraction prompt is
  hardcoded to GSPro specifically: it tells the model "You are analyzing
  a GS Pro golf simulator scorecard screenshot," references GSPro's
  "ROUND SETTINGS bar," and the field-mapping functions
  (`mapWind`/`mapPin`/`mapPutting`) are tuned to GSPro's own terms (pin
  placement as Thu/Fri/Sat/Sun, wind as Off/Light/Strong, etc).

So this isn't a small tweak — the model currently has no idea what a
TrackMan, Foresight/FSX, E6, or Full Swing round-summary screen even
looks like, because it's never been told.

## Why it matters

A lot of real facilities run mixed hardware across bays, not one
platform everywhere. Right now, a golfer on anything but GSPro can't use
scan at all.

## The constraint

We don't have real reference screenshots of the other platforms' actual
scorecard/round-summary screens yet — still gathering those from
facility contacts. Don't wait on that to start — ship this in two
phases instead.

## Phase 1 — do now, without reference images

- Remove the `isGsProPlatform(platform)` gate so scan is offered on
  every platform, not just GSPro.
- Generalize the extraction prompt so it's not GSPro-specific by name —
  ask the model to identify which simulator platform the screenshot is
  from (GSPro, TrackMan, Foresight/FSX, E6, Full Swing, or Unknown) as
  an added field in the response, with its own confidence, and to
  extract score/course/tee/settings using general knowledge of what a
  golf simulator scorecard typically shows rather than assuming GSPro's
  specific layout.
- Keep the current GSPro-tuned mapping logic
  (`mapWind`/`mapPin`/`mapPutting`/etc) as the specific path used when
  the detected platform is GSPro, since that's been tested and works.
  For every other detected platform, use a looser fallback: try
  confidently for total score and course name, and treat
  wind/pin/putting/mulligans as best-effort — mark them lower confidence
  rather than guessing hard, same confidence-based pattern the app
  already uses elsewhere (low confidence should nudge the user to
  confirm/fill in manually rather than silently trusting a guess).
- If platform detection confidence is low, don't silently apply it —
  show the user what was detected and let them correct it if it's the
  wrong sim, the same way a low-confidence course match already prompts
  for confirmation.

## Phase 2 — once we have real screenshots per platform

- Replace the generic best-effort extraction for each platform with a
  real, testable prompt tuned to that platform's actual layout and
  terminology, the same way the current prompt was hand-built around
  GSPro's specific screen.
- Worth asking for at least one or two clean examples per platform
  before this phase starts — a blurry phone photo of a projector screen
  is a worse first example than one clean screenshot.

## Why phase it this way

Shipping Phase 1 now gets scan working for every platform at
best-effort accuracy immediately, instead of staying GSPro-only while
waiting on reference images that may take a while to collect. Phase 2
is a quality upgrade on top of something that already works, not a
blocker to shipping anything.
