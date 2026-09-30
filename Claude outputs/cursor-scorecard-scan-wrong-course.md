Bug: scanning a scorecard screenshot on Log a Round can save the round
under the wrong course.

## Report

Graham scanned a scorecard screenshot on Log a Round and the round posted
under a different course than the one in the screenshot.

## Root cause

The AI parse does read the course name off the photo correctly, but that
value is never used to set the course on the form. The round just keeps
saving under whatever course was already selected before the scan.

Specifically:

- `supabase/functions/parse-scorecard/index.ts` extracts and returns
  `raw_course_name` from the scanned image (it's in the response).
- `src/lib/parseScorecard.ts` passes that value through on the result
  object, but nothing downstream reads it.
- `applyParseScorecardToLogForm` in `src/lib/scorecardParseApply.ts` only
  maps `total_score`, `mulligans`, `wind`, `pin_placement`, `putting_mode`,
  and `tees` onto the form — there's no course/courseId handling in it at
  all, and it never looks at `raw_course_name`.
- In `app/(tabs)/log/round.tsx`, `courseId` is only ever set by the user
  manually picking a course from the picker UI. The scan handler applies
  score/conditions/tee from the parse result but never calls `setCourseId`
  from it.
- Secondary issue: the tee list sent to the AI for tee-matching is built
  from whatever course is currently selected in the form, not the course
  in the photo — so if the selected course is wrong, the tee auto-fill is
  also being matched against the wrong course's tees.
- There's no confirmation step either — the scan banner just says "please
  review before logging" generically, it never surfaces what course it
  detected or flags a mismatch against what's currently selected.

## What's needed

When a scan returns a `raw_course_name`, it should actually inform the
course on the form — fuzzy-matched against the course catalog (curated +
community), same way course lookup/matching already works elsewhere in
the app. At minimum, don't silently keep a stale/unrelated course selected
when the scan detected a different one. Ideally, surface the detected
course to the user (e.g. in the review banner) so they can confirm or
correct it before saving, especially in ambiguous/low-confidence matches.

Flag if there's no existing course fuzzy-matcher to reuse and a new one
is needed — want to know the scope before this gets built.
