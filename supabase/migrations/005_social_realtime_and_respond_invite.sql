-- Reliable accept: upsert group_members with a non-empty display_name_snapshot,
-- and enable Realtime so other members' clients can refetch when invites are accepted.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_members'
  ) then
    alter publication supabase_realtime add table public.group_members;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_pending_invites'
  ) then
    alter publication supabase_realtime add table public.group_pending_invites;
  end if;
end $$;

create or replace function public.respond_group_invite(p_invite_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.group_pending_invites%rowtype;
  v_profile_name text;
  v_snap text;
  v_email_local text;
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
    select display_name into v_profile_name from public.profiles where id = v_uid;
    select coalesce(nullif(split_part(email::text, '@', 1), ''), '') into v_email_local
    from auth.users where id = v_uid;

    v_snap := coalesce(
      nullif(trim(v_profile_name), ''),
      nullif(trim(r.invitee_display_snapshot), ''),
      nullif(v_email_local, '')
    );

    insert into public.group_members (group_id, user_id, display_name_snapshot)
    values (r.group_id, v_uid, v_snap)
    on conflict (group_id, user_id) do update
      set display_name_snapshot = coalesce(
        excluded.display_name_snapshot,
        public.group_members.display_name_snapshot
      );

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
