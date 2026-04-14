-- Legacy dashboard / manual policy only allowed user_id = auth.uid(); it conflicted with
-- group_members_select_same_group (full crew roster) and caused RLS recursion / wrong visibility.
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view group members" on public.group_members;
