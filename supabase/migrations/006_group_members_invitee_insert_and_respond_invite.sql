-- Invitees could not join: only "group_members_insert_creator" allowed inserts, and RLS
-- still uses the caller's auth.uid() for WITH CHECK, so accept-RPC inserts failed for non-creators.
--
-- After deploy, verify in SQL editor (replace email if needed):
--   select gm.id, gm.group_id, gm.user_id, gm.display_name_snapshot
--   from public.group_members gm
--   join auth.users u on u.id = gm.user_id
--   where lower(trim(u.email::text)) = lower(trim('samanthawaskow@gmail.com'));
-- ---------------------------------------------------------------------------

drop policy if exists "group_members_insert_pending_invitee" on public.group_members;
create policy "group_members_insert_pending_invitee"
  on public.group_members for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.group_pending_invites gpi
      where gpi.group_id = group_members.group_id
        and gpi.invitee_user_id = auth.uid()
        and gpi.status = 'pending'
    )
  );

-- Upsert + verify membership; clear errors if the row is not persisted.
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
  v_member_id uuid;
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

    begin
      insert into public.group_members (group_id, user_id, display_name_snapshot)
      values (r.group_id, v_uid, v_snap)
      on conflict (group_id, user_id) do update
        set display_name_snapshot = coalesce(
          excluded.display_name_snapshot,
          public.group_members.display_name_snapshot
        )
      returning id into v_member_id;
    exception
      when others then
        raise exception
          'group_members insert failed for invite % (group %, user %): % [SQLSTATE %]',
          p_invite_id,
          r.group_id,
          v_uid,
          sqlerrm,
          sqlstate;
    end;

    if v_member_id is null then
      raise exception
        'group_members upsert returned no id for invite % (group %, user %)',
        p_invite_id,
        r.group_id,
        v_uid;
    end if;

    if not exists (
      select 1
      from public.group_members m
      where m.group_id = r.group_id and m.user_id = v_uid
    ) then
      raise exception
        'group_members verification failed after accept: user % is not a member of group % (invite %)',
        v_uid,
        r.group_id,
        p_invite_id;
    end if;

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
