Summary of the live browser QA pass on the 9-hole build (commit c6c4d9c) plus
the web-auth fix (ba31e1d), and what's needed before the next TestFlight
push.

## Confirmed working, no action needed

- Null-index gate (Decision 2): a brand-new account can't select Front 9 /
  Back 9 until it has one counting round. Verified live.
- Derived rating/slope resolver (Decision 1): Front 9 White tee showed
  36.1 / 128 · 3,024 yds against the 18-hole 72.1 / 128 · 6,048 yds — exact
  ÷2 on rating and yardage, slope unchanged, matches spec. Custom tee
  relabels correctly for Front 9.
- 9-hole score stepper bounds (27–65): confirmed exactly via direct
  testing.
- Index math and badging: saved a Front 9 round, share card read "FRONT 9
  COMPLETE," index contribution math checked out ((0.1+10.0)/2 × 0.96 =
  +4.8), and the "Front 9" badge appeared correctly in all five expected
  spots — share card, Home's Latest Round, Home's Recent Rounds, Round
  Detail, Profile.
- Web splash-hang fix (ba31e1d): confirmed fixed, reproduces the same way
  it used to before the fix and no longer does after.

## Needs a fix before TestFlight

1. **Stale copy on 9-hole score entry.** The Log a Round differential
   preview shows "your index benchmark sits outside the usual gross range
   (55–125)" for a 9-hole score like 27 — that's the 18-hole gross-score
   copy leaking onto the 9-hole flow. The underlying math is fine, this is
   copy-only: it needs its own range text (or to just not fire) when Holes
   is Front 9 / Back 9.
2. **Sim setup photo step scope change** — see the separate note
   (cursor-remove-photo-9hole.md) for full detail. Short version: skip the
   photo step on web (any holes) and for Front9/Back9 matches on any
   platform; keep requiring it for native 18-hole matches.

## Not yet verified — blocked until the photo change ships

**Decision 4 (Match Play "Save to index" gating for Front9/Back9
matches)** — couldn't complete live QA because reaching the results
screen requires finishing a match, which requires the photo step that's
being removed above. Once the web-skip ships, I'll re-run this end to end
in the browser: create a Front 9 direct challenge (self-test against my
own second account, no real opponents involved), accept it, enter scores,
and confirm "Save to index" is correctly hidden/blocked on the results
screen. Will report back before the TestFlight build goes out.

## Once the above is in

Graham's plan: land these fixes, then cut a TestFlight build to sanity
check the native app end to end (cold start, fresh sign-in, Home filling
in properly, and the native photo-required 18-hole flow still working
as before).
