-- Authoritative creator check for UI (tournaments, etc.) without relying on client
-- reading social_groups.created_by through SELECT RLS or persisted store fields.

create or replace function public.is_social_group_creator(p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;

  return exists (
    select 1
    from public.social_groups g
    where g.id = p_group_id
      and g.created_by = v_uid
  );
end;
$$;

revoke all on function public.is_social_group_creator(uuid) from public;
grant execute on function public.is_social_group_creator(uuid) to authenticated;
