-- Deactivate groups instead of hard-deleting (preserves data; client hides is_active = false).

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

  update public.social_groups
  set is_active = false
  where id = p_group_id
    and created_by = v_uid
    and is_active = true;

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

comment on function public.delete_social_group_as_creator(uuid) is
  'Group creator deactivates a crew (sets is_active = false). Name retained for client compatibility.';
