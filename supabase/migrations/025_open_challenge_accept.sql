-- Open challenge: atomic accept (first wins) + storage paths for prospective acceptors.

-- ---------------------------------------------------------------------------
-- RPC: claim open challenge — sets player_2 + tee/rating/slope/photo, status → active
-- ---------------------------------------------------------------------------

create or replace function public.accept_open_challenge(
  p_match_id uuid,
  p_player_2_tee text,
  p_player_2_course_rating numeric,
  p_player_2_course_slope integer,
  p_player_2_settings_photo_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n int;
  st text;
  op boolean;
  p2 uuid;
  p1 uuid;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  update public.matches
  set
    player_2_id = uid,
    player_2_tee = p_player_2_tee,
    player_2_course_rating = p_player_2_course_rating,
    player_2_course_slope = p_player_2_course_slope,
    player_2_settings_photo_url = nullif(trim(p_player_2_settings_photo_url), ''),
    status = 'active'
  where id = p_match_id
    and is_open = true
    and status = 'open'
    and player_2_id is null
    and player_1_id is distinct from uid;

  get diagnostics n = row_count;

  if n > 0 then
    return jsonb_build_object('ok', true);
  end if;

  select m.status, m.is_open, m.player_2_id, m.player_1_id
    into st, op, p2, p1
  from public.matches m
  where m.id = p_match_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Match not found.');
  end if;

  if p1 = uid then
    return jsonb_build_object('ok', false, 'error', 'You cannot accept your own challenge.');
  end if;

  if op and st = 'open' and p2 is not null then
    return jsonb_build_object('ok', false, 'error', 'Challenge already taken.');
  end if;

  return jsonb_build_object('ok', false, 'error', 'This challenge is no longer available.');
end;
$$;

comment on function public.accept_open_challenge(uuid, text, numeric, integer, text) is
  'Atomically claims an open stroke challenge: first acceptor wins; others get Challenge already taken.';

revoke all on function public.accept_open_challenge(uuid, text, numeric, integer, text) from public;
grant execute on function public.accept_open_challenge(uuid, text, numeric, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: signed-in users may read open-feed screenshots; prospective acceptors may upload
-- ---------------------------------------------------------------------------

drop policy if exists "match_settings_select_participants" on storage.objects;

create policy "match_settings_select_participants"
  on storage.objects for select
  using (
    bucket_id = 'match-settings'
    and cardinality(string_to_array(nullif(trim(name), ''), '/')) >= 3
    and (
      exists (
        select 1
        from public.matches m
        where m.id::text = split_part(name, '/', 1)
          and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
      )
      or exists (
        select 1
        from public.matches m
        where m.id::text = split_part(name, '/', 1)
          and m.is_open = true
          and m.status = 'open'
      )
    )
  );

drop policy if exists "match_settings_insert_own_slot" on storage.objects;

create policy "match_settings_insert_own_slot"
  on storage.objects for insert
  with check (
    bucket_id = 'match-settings'
    and cardinality(string_to_array(nullif(trim(name), ''), '/')) >= 3
    and split_part(name, '/', 2) = auth.uid()::text
    and (
      exists (
        select 1
        from public.matches m
        where m.id::text = split_part(name, '/', 1)
          and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
      )
      or exists (
        select 1
        from public.matches m
        where m.id::text = split_part(name, '/', 1)
          and m.is_open = true
          and m.status = 'open'
          and m.player_2_id is null
          and m.player_1_id is distinct from auth.uid()
      )
    )
  );

drop policy if exists "match_settings_update_own_slot" on storage.objects;

create policy "match_settings_update_own_slot"
  on storage.objects for update
  using (
    bucket_id = 'match-settings'
    and split_part(name, '/', 2) = auth.uid()::text
    and (
      exists (
        select 1
        from public.matches m
        where m.id::text = split_part(name, '/', 1)
          and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
      )
      or exists (
        select 1
        from public.matches m
        where m.id::text = split_part(name, '/', 1)
          and m.is_open = true
          and m.status = 'open'
          and m.player_2_id is null
          and m.player_1_id is distinct from auth.uid()
      )
    )
  )
  with check (
    bucket_id = 'match-settings'
    and split_part(name, '/', 2) = auth.uid()::text
    and (
      exists (
        select 1
        from public.matches m
        where m.id::text = split_part(name, '/', 1)
          and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
      )
      or exists (
        select 1
        from public.matches m
        where m.id::text = split_part(name, '/', 1)
          and m.is_open = true
          and m.status = 'open'
          and m.player_2_id is null
          and m.player_1_id is distinct from auth.uid()
      )
    )
  );

drop policy if exists "match_settings_delete_own_slot" on storage.objects;

create policy "match_settings_delete_own_slot"
  on storage.objects for delete
  using (
    bucket_id = 'match-settings'
    and split_part(name, '/', 2) = auth.uid()::text
    and (
      exists (
        select 1
        from public.matches m
        where m.id::text = split_part(name, '/', 1)
          and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
      )
      or exists (
        select 1
        from public.matches m
        where m.id::text = split_part(name, '/', 1)
          and m.is_open = true
          and m.status = 'open'
          and m.player_2_id is null
          and m.player_1_id is distinct from auth.uid()
      )
    )
  );
