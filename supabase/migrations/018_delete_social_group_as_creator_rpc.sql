-- Client DELETE on social_groups cascades to group_members, etc. Each child DELETE is
-- evaluated with the caller's role; missing DELETE policies or RLS re-entry can hang or fail.
-- Same pattern as create_social_group (013): one SECURITY DEFINER RPC performs the delete.

create or replace function public.delete_social_group_as_creator(p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.social_groups
  where id = p_group_id
    and created_by = v_uid;

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.delete_social_group_as_creator(uuid) from public;
grant execute on function public.delete_social_group_as_creator(uuid) to authenticated;
