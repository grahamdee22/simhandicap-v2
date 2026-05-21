-- Group admins: creator-designated members with tournament / invite management permissions.

alter table public.group_members
  add column if not exists is_admin boolean not null default false;

comment on column public.group_members.is_admin is
  'When true, member can manage tournaments and invites like the group creator. Only the creator can change this flag.';

create or replace function public.user_can_manage_social_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.social_groups g
    where g.id = p_group_id
      and g.created_by = auth.uid()
  )
  or exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
      and gm.is_admin = true
  );
$$;

revoke all on function public.user_can_manage_social_group(uuid) from public;
grant execute on function public.user_can_manage_social_group(uuid) to authenticated;

create or replace function public.is_social_group_manager(p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  return public.user_can_manage_social_group(p_group_id);
end;
$$;

revoke all on function public.is_social_group_manager(uuid) from public;
grant execute on function public.is_social_group_manager(uuid) to authenticated;

create or replace function public.set_group_member_admin(
  p_group_id uuid,
  p_user_id uuid,
  p_is_admin boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.social_groups g
    where g.id = p_group_id and g.created_by = v_uid
  ) then
    raise exception 'Only the group creator can change admin roles';
  end if;

  if p_user_id = v_uid then
    raise exception 'Cannot change your own admin status';
  end if;

  if exists (
    select 1 from public.social_groups g
    where g.id = p_group_id and g.created_by = p_user_id
  ) then
    raise exception 'The group creator already has full permissions';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = p_user_id
  ) then
    raise exception 'User is not a member of this group';
  end if;

  update public.group_members
  set is_admin = coalesce(p_is_admin, false)
  where group_id = p_group_id and user_id = p_user_id;
end;
$$;

revoke all on function public.set_group_member_admin(uuid, uuid, boolean) from public;
grant execute on function public.set_group_member_admin(uuid, uuid, boolean) to authenticated;

-- League / tournament policies: creator or admin
drop policy if exists "leagues_insert_group_creator" on public.leagues;
create policy "leagues_insert_group_manager"
  on public.leagues for insert
  with check (
    created_by = auth.uid()
    and public.user_can_manage_social_group(group_id)
  );

drop policy if exists "leagues_update_group_creator" on public.leagues;
create policy "leagues_update_group_manager"
  on public.leagues for update
  using (public.user_can_manage_social_group(group_id))
  with check (public.user_can_manage_social_group(group_id));

drop policy if exists "leagues_delete_group_creator" on public.leagues;
create policy "leagues_delete_group_manager"
  on public.leagues for delete
  using (public.user_can_manage_social_group(group_id));

drop policy if exists "league_teams_mutate_creator" on public.league_teams;
create policy "league_teams_mutate_manager"
  on public.league_teams for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = league_teams.league_id
        and public.user_can_manage_social_group(l.group_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = league_teams.league_id
        and public.user_can_manage_social_group(l.group_id)
    )
  );

drop policy if exists "league_team_members_mutate_creator" on public.league_team_members;
create policy "league_team_members_mutate_manager"
  on public.league_team_members for all
  using (
    exists (
      select 1
      from public.league_teams t
      inner join public.leagues l on l.id = t.league_id
      where t.id = league_team_members.league_team_id
        and public.user_can_manage_social_group(l.group_id)
    )
  )
  with check (
    exists (
      select 1
      from public.league_teams t
      inner join public.leagues l on l.id = t.league_id
      where t.id = league_team_members.league_team_id
        and public.user_can_manage_social_group(l.group_id)
    )
  );

drop policy if exists "league_entries_insert_creator" on public.league_entries;
create policy "league_entries_insert_manager"
  on public.league_entries for insert
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = league_entries.league_id
        and public.user_can_manage_social_group(l.group_id)
    )
  );

drop policy if exists "league_entries_update_creator" on public.league_entries;
create policy "league_entries_update_manager"
  on public.league_entries for update
  using (
    exists (
      select 1 from public.leagues l
      where l.id = league_entries.league_id
        and public.user_can_manage_social_group(l.group_id)
    )
  );

-- Pending / email invite cancel: creator or admin
drop policy if exists "group_pending_invites_update_creator" on public.group_pending_invites;
create policy "group_pending_invites_update_manager"
  on public.group_pending_invites for update
  using (public.user_can_manage_social_group(group_id))
  with check (public.user_can_manage_social_group(group_id));

drop policy if exists "social_group_invites_update_creator" on public.social_group_invites;
create policy "social_group_invites_update_manager"
  on public.social_group_invites for update
  using (public.user_can_manage_social_group(group_id))
  with check (public.user_can_manage_social_group(group_id));
