Facility bay QR check-in — new feature, lower priority, not urgent.

## Why

Facilities running multiple bays want a golfer to be able to walk up, scan
a code at the bay, and land straight in Log a Round already set up for
that facility and that bay's platform — no manually finding the right
group, no picking Sim platform from the picker every time.

## Current state (confirmed by reading the code first)

- There's no "bay" concept anywhere in the app today — this is new.
- Groups (`social_groups`) already have an admin/member distinction via
  `group_member_admins` (migration 048), so facility-staff-only screens
  already have a natural permission check to hook into.
- The app already uses `expo-linking` for deep links (see
  `app/auth/callback.tsx` and `app/(auth)/reset-password.tsx` for the
  reset-password flow) — reuse that existing scheme/pattern rather than
  inventing a new one.
- There's already some kind of group invite mechanism
  (`group_pending_invites`, migration 004). Before building anything new,
  check whether this already covers "join a group via a shareable
  code/link" — if the join-a-group-by-code flow mentioned as an open task
  a while back never got built, this feature likely needs it as a
  dependency, and it may make sense to build that first since bay
  check-in is really "join this group" + "prefill this bay" stacked
  together.

## Proposed behavior

- A group admin can create one or more "bays" under their group from a
  group management screen (admin-only, gated the same way other
  admin-only actions are gated today). Each bay has a name (e.g. "Bay 3")
  and an optional default Sim platform.
- Each bay gets a QR code that encodes a deep link back into the app
  (reuse the existing deep-link scheme). The admin screen should render
  the QR in-app so it can be screenshotted/printed and stuck next to the
  bay.
- Scanning the code:
  - If the golfer isn't a member of that group yet, prompt them to join
    (reuse whatever the existing group-join flow is).
  - If they're already a member, take them straight to Log a Round with
    the group's course scope and the bay's default platform pre-filled.
- V1 does not need to pre-fill a specific course — platform is enough,
  since course/tee usually varies session to session even on the same
  bay.
- Admin screen should let a group admin rename or delete a bay.

## Things to check before building

- What deep-link scheme is currently registered (check `app.json` /
  Expo config) so the bay links match the existing pattern instead of a
  new one.
- Whether `round.tsx` (or wherever Log a Round pulls its initial state
  from) already supports being opened with pre-fill params, or whether
  that needs to be added.
- Whether the existing invite flow already solves "join this group from
  a link" — don't build a second, parallel join mechanism if one exists
  or is close to existing.

## Not in scope for this pass

- Linking a bay to a specific course/tee.
- Any hardware-side integration — this is purely "scan a code, land in
  the right screen with the right defaults," nothing talks to the
  simulator PC.
