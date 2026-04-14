-- crew_group_ids_for_request_user() + set_config(row_security, off) still re-entered
-- group_members RLS when invoked from the SELECT policy (nested policy evaluation).
-- Replace with a plain disjunctive policy: own row OR same group_id as any of my rows.
-- Inner scan only touches rows where user_id = auth.uid(); each such row passes via the
-- first branch (user_id = auth.uid()) without needing the IN list first — no recursion.
-- ---------------------------------------------------------------------------

drop policy if exists "group_members_select_same_group" on public.group_members;

create policy "group_members_select_same_group"
  on public.group_members for select
  using (
    user_id = auth.uid()
    or group_id in (
      select gm.group_id
      from public.group_members gm
      where gm.user_id = auth.uid()
    )
  );

drop function if exists public.crew_group_ids_for_request_user();
