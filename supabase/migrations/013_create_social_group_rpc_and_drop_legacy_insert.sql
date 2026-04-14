-- Client INSERT into group_members evaluates INSERT RLS, whose WITH CHECK reads
-- social_groups; social_groups_select_member EXISTS-scans group_members, which
-- re-enters group_members SELECT RLS → infinite recursion.
--
-- Atomic server-side create bypasses RLS on these inserts (definer). Mirror rows
-- are still filled by trg_group_members_sync_user_membership after group_members insert.
--
-- Also drop duplicate dashboard INSERT policies on group_members if present.
-- ---------------------------------------------------------------------------

drop policy if exists "Users can join groups" on public.group_members;
drop policy if exists "Users can join group_members" on public.group_members;

create or replace function public.create_social_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trim text;
  v_group_id uuid;
  v_snap text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_trim := nullif(trim(p_name), '');
  if v_trim is null or length(v_trim) < 1 then
    raise exception 'Invalid group name';
  end if;

  insert into public.social_groups (name, created_by)
  values (v_trim, v_uid)
  returning id into v_group_id;

  begin
    select nullif(trim(display_name), '') into v_snap from public.profiles where id = v_uid;

    insert into public.group_members (group_id, user_id, display_name_snapshot)
    values (v_group_id, v_uid, v_snap);
  exception
    when others then
      delete from public.social_groups where id = v_group_id;
      raise;
  end;

  return v_group_id;
end;
$$;

revoke all on function public.create_social_group(text) from public;
grant execute on function public.create_social_group(text) to authenticated;
