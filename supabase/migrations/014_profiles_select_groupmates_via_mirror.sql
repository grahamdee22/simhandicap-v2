-- profiles_select_groupmates used "group_members m1 JOIN group_members m2"; evaluating
-- peer rows in that join could fail under RLS. Use user_group_membership for the reader's
-- crew ids (no peer rows) and a single group_members scan: peer is in one of those crews.
-- ---------------------------------------------------------------------------

drop policy if exists "profiles_select_groupmates" on public.profiles;

create policy "profiles_select_groupmates"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.group_members gm
      where gm.user_id = profiles.id
        and gm.group_id in (
          select ug.group_id
          from public.user_group_membership ug
          where ug.user_id = auth.uid()
        )
    )
  );
