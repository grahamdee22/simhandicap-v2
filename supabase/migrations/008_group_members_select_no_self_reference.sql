-- group_members_select_same_group used "exists (select ... from group_members m ...)".
-- The inner scan on group_members is still subject to RLS, which can prevent seeing peers
-- in the same crew. Use a SECURITY DEFINER helper that reads memberships by auth.uid()
-- (see migration 009: that read must disable row_security briefly or RLS recurses into this function).
-- ---------------------------------------------------------------------------

create or replace function public.crew_group_ids_for_request_user()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select gm.group_id
  from public.group_members gm
  where gm.user_id = auth.uid();
$$;

revoke all on function public.crew_group_ids_for_request_user() from public;
grant execute on function public.crew_group_ids_for_request_user() to authenticated;

drop policy if exists "group_members_select_same_group" on public.group_members;

create policy "group_members_select_same_group"
  on public.group_members for select
  using (
    group_id in (select public.crew_group_ids_for_request_user())
  );
