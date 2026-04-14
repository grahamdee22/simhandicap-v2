-- profiles_select_groupmates still subqueried group_members as the invoker; RLS on that
-- scan can prevent the EXISTS from succeeding for peer rows. Return co-crew user ids in a
-- SECURITY DEFINER helper (mirror + group_members read as definer; filter uses auth.uid()).
-- ---------------------------------------------------------------------------

create or replace function public.crew_peer_user_ids_for_request()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select distinct gm.user_id
  from public.group_members gm
  where gm.group_id in (
    select ug.group_id
    from public.user_group_membership ug
    where ug.user_id = auth.uid()
  );
$$;

revoke all on function public.crew_peer_user_ids_for_request() from public;
grant execute on function public.crew_peer_user_ids_for_request() to authenticated;

drop policy if exists "profiles_select_groupmates" on public.profiles;

create policy "profiles_select_groupmates"
  on public.profiles for select
  using (
    id in (select public.crew_peer_user_ids_for_request())
  );
