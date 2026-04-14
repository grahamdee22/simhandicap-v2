-- crew_group_ids_for_request_user() reads group_members; that scan still had RLS
-- applied, so the SELECT policy (which calls this function) re-entered forever.
-- Briefly disable row_security inside the definer function, then restore, so the
-- helper sees all of the caller's membership rows without re-evaluating group_members RLS.
-- ---------------------------------------------------------------------------

create or replace function public.crew_group_ids_for_request_user()
returns setof uuid
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform set_config('row_security', 'off', true);
  return query
    select gm.group_id
    from public.group_members gm
    where gm.user_id = auth.uid();
  perform set_config('row_security', 'on', true);
  return;
exception
  when others then
    perform set_config('row_security', 'on', true);
    raise;
end;
$$;

revoke all on function public.crew_group_ids_for_request_user() from public;
grant execute on function public.crew_group_ids_for_request_user() to authenticated;
