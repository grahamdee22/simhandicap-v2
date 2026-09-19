# How to create a group

Groups let you track handicaps and compete with your regular sim crew. Everything starts on the **Social** tab.

## Create a group

1. Open the **Social** tab.
2. Scroll to **My Groups**.
3. Tap **Create your first group** (if you don’t have any yet) or **Create a New Group**.
4. In the **New group** window, enter a **Group name**.
5. Tap **Create**.

**Name rules:** the name only needs to be non-empty after trimming. There is no uniqueness check and no maximum length enforced in the create RPC or UI.

**Account / sync:**

- When Supabase is configured (normal builds), you must be signed in. Creation goes through the `create_social_group` RPC; unsigned-in attempts fail with a “Not signed in” (or auth) error. There is no local fallback in that path.
- When Supabase is **not** configured (local/dev without backend), Create saves the group only on the device via the local store — it will not sync to a server.

After a successful create, the new group appears as a tab under **My Groups**, and you’re added as the first member and **Creator**.

## Invite people

Open the group, then use:

- **+ Invite** — available to any group member. Opens **Invite to group**. Enter an **Email address**, then tap **Send invite**.
  - If they already use SimCap, they’ll see an invite at the top of **Social** with **Accept** and **Decline**.
  - If they don’t have an account yet, SimCap records the invite and can open your email app with a signup message.
- **Bulk Invite** — available to the group creator or an admin. Enter multiple email addresses (one per line), then tap **Send invites**.

## Accept an invite

If someone invites you, you’ll see a card at the top of **Social** with **Accept** and **Decline**. Accepting adds you to that crew.

## What you’ll see in a group

Each group shows:

- Member ranks (lower effective handicap first)
- Display name, rounds logged, platform, index, and trend
- **Creator** or **Admin** badges when relevant
- **Chat**
- **Tournaments** for that crew
- **Crew Match Calculator** lower on the Social screen (for in-person stroke allocation)

## Roles

- **Creator** — full control, including **Make admin** / **Remove admin** and deleting the group
- **Admin** — can manage tournaments and use bulk invite tools
- **Member** — can invite one person at a time, chat, and play in group tournaments/matches

## Delete a group

Deleting a group asks for confirmation and warns that members, invites, and history will be removed. In the current product that action is a **soft delete**: the creator RPC sets `social_groups.is_active = false`. The crew disappears from the app; underlying rows are retained, not hard-wiped.
