-- In-app pending invites for registered users + RPCs for send / accept / decline / cancel.
-- Email-only invites stay in social_group_invites with status open/cancelled.
--
-- Ordering: all CREATE TABLE first, then indexes, ALTER TABLE, policies, functions.
-- social_group_invites is created here with IF NOT EXISTS so this migration succeeds
-- when 002 was skipped or the table was never created.

-- ---------------------------------------------------------------------------
-- 1) CREATE TABLE (all tables this migration depends on owning / altering)
-- ---------------------------------------------------------------------------

create table if not exists public.social_group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.social_groups (id) on delete cascade,
  email text not null,
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_pending_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.social_groups (id) on delete cascade,
  invitee_user_id uuid not null references auth.users (id) on delete cascade,
  invited_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  invitee_display_snapshot text,
  inviter_display_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) CREATE INDEX (no policies/functions yet)
-- ---------------------------------------------------------------------------

create unique index if not exists group_pending_invites_one_active
  on public.group_pending_invites (group_id, invitee_user_id)
  where status = 'pending';

create index if not exists group_pending_invites_invitee_pending_idx
  on public.group_pending_invites (invitee_user_id)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 3) ALTER TABLE (columns / constraints on existing tables)
-- ---------------------------------------------------------------------------

alter table public.social_group_invites
  add column if not exists status text not null default 'open';

alter table public.social_group_invites
  drop constraint if exists social_group_invites_status_check;

alter table public.social_group_invites
  add constraint social_group_invites_status_check
  check (status in ('open', 'cancelled'));

drop index if exists public.social_group_invites_one_open_email;

create unique index if not exists social_group_invites_one_open_email
  on public.social_group_invites (group_id, lower(trim(email)))
  where status = 'open';

alter table public.group_pending_invites enable row level security;

alter table public.social_group_invites enable row level security;

-- ---------------------------------------------------------------------------
-- 4) CREATE POLICY (after tables, columns, and RLS are in place)
-- ---------------------------------------------------------------------------

drop policy if exists "gpi_select_invitee" on public.group_pending_invites;
create policy "gpi_select_invitee"
  on public.group_pending_invites for select
  using (invitee_user_id = auth.uid());

drop policy if exists "gpi_select_group_member" on public.group_pending_invites;
create policy "gpi_select_group_member"
  on public.group_pending_invites for select
  using (
    exists (
      select 1 from public.group_members m
      where m.group_id = group_pending_invites.group_id and m.user_id = auth.uid()
    )
  );

-- Baseline invite access (same as 002; recreated here if 002 was not applied).
drop policy if exists "social_group_invites_select_inviter_or_creator" on public.social_group_invites;
create policy "social_group_invites_select_inviter_or_creator"
  on public.social_group_invites for select
  using (
    invited_by = auth.uid()
    or exists (
      select 1 from public.social_groups g
      where g.id = group_id and g.created_by = auth.uid()
    )
  );

drop policy if exists "social_group_invites_insert_member" on public.social_group_invites;
create policy "social_group_invites_insert_member"
  on public.social_group_invites for insert
  with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.group_members m
      where m.group_id = social_group_invites.group_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "social_groups_select_pending_invitee" on public.social_groups;
create policy "social_groups_select_pending_invitee"
  on public.social_groups for select
  using (
    exists (
      select 1 from public.group_pending_invites gpi
      where gpi.group_id = social_groups.id
        and gpi.invitee_user_id = auth.uid()
        and gpi.status = 'pending'
    )
  );

drop policy if exists "profiles_select_pending_inviter" on public.profiles;
create policy "profiles_select_pending_inviter"
  on public.profiles for select
  using (
    exists (
      select 1 from public.group_pending_invites gpi
      where gpi.invitee_user_id = auth.uid()
        and gpi.invited_by = profiles.id
        and gpi.status = 'pending'
    )
  );

drop policy if exists "social_group_invites_update_creator" on public.social_group_invites;
create policy "social_group_invites_update_creator"
  on public.social_group_invites for update
  using (
    exists (
      select 1 from public.social_groups g
      where g.id = social_group_invites.group_id and g.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.social_groups g
      where g.id = social_group_invites.group_id and g.created_by = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5) CREATE FUNCTION + GRANT
-- ---------------------------------------------------------------------------

create or replace function public.send_group_invite(p_group_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_target uuid;
  v_self_email text;
  v_inv_name text;
  v_tgt_name text;
  v_tgt_email_local text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_email := lower(trim(p_email));
  if v_email is null or length(v_email) < 3 or strpos(v_email, '@') < 2 then
    raise exception 'Invalid email';
  end if;

  if not exists (
    select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = v_uid
  ) then
    raise exception 'Not a group member';
  end if;

  if not exists (select 1 from public.social_groups where id = p_group_id) then
    raise exception 'Group not found';
  end if;

  select lower(trim(email::text)) into v_self_email from auth.users where id = v_uid;
  if v_self_email = v_email then
    raise exception 'You cannot invite yourself';
  end if;

  if exists (
    select 1
    from public.group_members m
    inner join auth.users u on u.id = m.user_id
    where m.group_id = p_group_id and lower(trim(u.email::text)) = v_email
  ) then
    return jsonb_build_object('kind', 'already_member', 'email', p_email);
  end if;

  select coalesce(nullif(trim(display_name), ''), '') into v_inv_name from public.profiles where id = v_uid;
  if v_inv_name = '' then
    select coalesce(split_part(email::text, '@', 1), 'Someone') into v_inv_name from auth.users where id = v_uid;
  end if;

  select id into v_target from auth.users where lower(trim(email::text)) = v_email limit 1;

  if v_target is not null then
    if exists (
      select 1 from public.group_pending_invites
      where group_id = p_group_id and invitee_user_id = v_target and status = 'pending'
    ) then
      return jsonb_build_object('kind', 'in_app', 'email', p_email, 'duplicate', true);
    end if;

    select coalesce(nullif(trim(display_name), ''), '') into v_tgt_name from public.profiles where id = v_target;
    if v_tgt_name = '' then
      select split_part(email::text, '@', 1) into v_tgt_email_local from auth.users where id = v_target;
      v_tgt_name := coalesce(v_tgt_email_local, 'Member');
    end if;

    insert into public.group_pending_invites (
      group_id, invitee_user_id, invited_by, status,
      invitee_display_snapshot, inviter_display_snapshot
    ) values (
      p_group_id, v_target, v_uid, 'pending',
      v_tgt_name, v_inv_name
    );

    return jsonb_build_object('kind', 'in_app', 'email', p_email);
  end if;

  if exists (
    select 1 from public.social_group_invites
    where group_id = p_group_id and lower(trim(email::text)) = v_email and status = 'open'
  ) then
    return jsonb_build_object('kind', 'email', 'email', p_email, 'duplicate', true);
  end if;

  insert into public.social_group_invites (group_id, email, invited_by, status)
  values (p_group_id, v_email, v_uid, 'open');

  return jsonb_build_object('kind', 'email', 'email', p_email);
end;
$$;

grant execute on function public.send_group_invite(uuid, text) to authenticated;

create or replace function public.respond_group_invite(p_invite_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.group_pending_invites%rowtype;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into r
  from public.group_pending_invites
  where id = p_invite_id and invitee_user_id = v_uid and status = 'pending'
  for update;

  if not found then
    raise exception 'Invite not found or already handled';
  end if;

  if p_accept then
    select display_name into v_name from public.profiles where id = v_uid;
    insert into public.group_members (group_id, user_id, display_name_snapshot)
    values (r.group_id, v_uid, nullif(trim(v_name), ''))
    on conflict (group_id, user_id) do nothing;

    update public.group_pending_invites
    set status = 'accepted', updated_at = now()
    where id = p_invite_id;

    return jsonb_build_object('accepted', true);
  else
    update public.group_pending_invites
    set status = 'declined', updated_at = now()
    where id = p_invite_id;

    return jsonb_build_object('accepted', false);
  end if;
end;
$$;

grant execute on function public.respond_group_invite(uuid, boolean) to authenticated;

create or replace function public.cancel_outbound_group_invite(p_kind text, p_id uuid)
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

  if p_kind = 'in_app' then
    update public.group_pending_invites gpi
    set status = 'cancelled', updated_at = now()
    from public.social_groups g
    where gpi.id = p_id
      and gpi.group_id = g.id
      and g.created_by = v_uid
      and gpi.status = 'pending';
  elsif p_kind = 'email' then
    update public.social_group_invites sgi
    set status = 'cancelled'
    from public.social_groups g
    where sgi.id = p_id
      and sgi.group_id = g.id
      and g.created_by = v_uid
      and sgi.status = 'open';
  else
    raise exception 'Invalid kind';
  end if;
end;
$$;

grant execute on function public.cancel_outbound_group_invite(text, uuid) to authenticated;
