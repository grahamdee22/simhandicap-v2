-- Fix chicken-and-egg: creators could not SELECT their new social_groups row (only
-- "social_groups_select_member" existed), so group_members_insert_creator's WITH CHECK
-- subquery on social_groups saw zero rows and the client insert of the creator failed.
--
-- Fix invite accept: INSERT ... ON CONFLICT DO UPDATE applies UPDATE RLS; invitees
-- had no UPDATE policy on group_members, so the upsert could fail. Use plain INSERT +
-- unique_violation handler instead.
-- ---------------------------------------------------------------------------

drop policy if exists "social_groups_select_creator" on public.social_groups;
create policy "social_groups_select_creator"
  on public.social_groups for select
  using (created_by = auth.uid());

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
      returning id into v_member_id;
    exception
      when unique_violation then
        select id into v_member_id
        from public.group_members
        where group_id = r.group_id and user_id = v_uid;
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
        'group_members insert returned no id for invite % (group %, user %)',
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
