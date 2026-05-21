-- Match play RPCs: allow group admins (migration 049).

drop policy if exists "league_match_pairings_mutate_creator" on public.league_match_pairings;
create policy "league_match_pairings_mutate_manager"
  on public.league_match_pairings for all
  using (
    exists (
      select 1 from public.leagues l
      where l.id = league_match_pairings.league_id
        and public.user_can_manage_social_group(l.group_id)
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      where l.id = league_match_pairings.league_id
        and public.user_can_manage_social_group(l.group_id)
    )
  );


create or replace function public.generate_match_play_pairings(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_league public.leagues%rowtype;
  v_entries uuid[];
  v_n int;
  v_i int;
  v_created int := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if not found then
    raise exception 'League not found';
  end if;
  if v_league.format <> 'match_play' then
    raise exception 'League is not match play format';
  end if;

  if not public.user_can_manage_social_group(v_league.group_id) then
    raise exception 'Only the group creator or an admin can generate pairings';
  end if;

  delete from public.league_match_pairings where league_id = p_league_id;

  select array_agg(e.id order by random())
  into v_entries
  from public.league_entries e
  where e.league_id = p_league_id;

  v_n := coalesce(array_length(v_entries, 1), 0);
  if v_n < 2 then
    raise exception 'Need at least 2 players to create pairings';
  end if;

  v_i := 1;
  while v_i < v_n loop
    insert into public.league_match_pairings (
      league_id,
      player_1_entry_id,
      player_2_entry_id,
      status,
      scheduled_at
    )
    values (
      p_league_id,
      v_entries[v_i],
      v_entries[v_i + 1],
      'scheduled',
      now()
    );
    v_created := v_created + 1;
    v_i := v_i + 2;
  end loop;

  return jsonb_build_object(
    'league_id', p_league_id,
    'pairings_created', v_created,
    'players_unpaired', case when v_n % 2 = 1 then 1 else 0 end
  );
end;
$$;


create or replace function public.save_admin_match_play_pairings(
  p_league_id uuid,
  p_pairings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_league public.leagues%rowtype;
  v_pairing jsonb;
  v_u1 uuid;
  v_u2 uuid;
  v_e1 uuid;
  v_e2 uuid;
  v_created int := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if not found then
    raise exception 'League not found';
  end if;
  if v_league.format <> 'match_play' then
    raise exception 'League is not match play format';
  end if;
  if v_league.match_play_pairing_method <> 'admin' then
    raise exception 'League does not use admin-assigned pairings';
  end if;

  if not public.user_can_manage_social_group(v_league.group_id) then
    raise exception 'Only the group creator or an admin can save pairings';
  end if;

  if jsonb_typeof(p_pairings) <> 'array' then
    raise exception 'p_pairings must be a JSON array';
  end if;

  delete from public.league_match_pairings where league_id = p_league_id;

  for v_pairing in select * from jsonb_array_elements(p_pairings)
  loop
    v_u1 := nullif(v_pairing->>'player_1_user_id', '')::uuid;
    v_u2 := nullif(v_pairing->>'player_2_user_id', '')::uuid;
    if v_u1 is null or v_u2 is null or v_u1 = v_u2 then
      raise exception 'Each pairing needs two distinct player user ids';
    end if;

    select e.id into v_e1 from public.league_entries e
    where e.league_id = p_league_id and e.user_id = v_u1;
    select e.id into v_e2 from public.league_entries e
    where e.league_id = p_league_id and e.user_id = v_u2;

    if v_e1 is null or v_e2 is null then
      raise exception 'Both players must be entered in the tournament';
    end if;

    insert into public.league_match_pairings (
      league_id,
      player_1_entry_id,
      player_2_entry_id,
      status,
      scheduled_at
    )
    values (p_league_id, v_e1, v_e2, 'scheduled', now());

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object(
    'league_id', p_league_id,
    'pairings_created', v_created
  );
end;
$$;


create or replace function public.generate_match_play_bracket(
  p_league_id uuid,
  p_seeded_user_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_league public.leagues%rowtype;
  v_n int;
  v_i int;
  v_user_id uuid;
  v_entry_id uuid;
  v_e1 uuid;
  v_e2 uuid;
  v_created int := 0;
  v_rows int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_league from public.leagues where id = p_league_id;
  if not found then
    raise exception 'League not found';
  end if;
  if v_league.format <> 'match_play' then
    raise exception 'League is not match play format';
  end if;

  if not public.user_can_manage_social_group(v_league.group_id) then
    raise exception 'Only the group creator or an admin can generate the bracket';
  end if;

  select count(*)::int into v_n
  from public.league_entries e
  where e.league_id = p_league_id;

  if v_n not in (2, 3, 4, 8) then
    raise exception 'Match Play bracket requires 2, 3, 4, or 8 players';
  end if;

  update public.league_entries set bracket_seed = null where league_id = p_league_id;
  delete from public.league_match_pairings where league_id = p_league_id;

  if p_seeded_user_ids is not null and coalesce(array_length(p_seeded_user_ids, 1), 0) = v_n then
    v_i := 1;
    foreach v_user_id in array p_seeded_user_ids loop
      update public.league_entries
      set bracket_seed = v_i
      where league_id = p_league_id and user_id = v_user_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception 'Every group member must be entered in the tournament';
      end if;
      v_i := v_i + 1;
    end loop;
  else
    v_i := 0;
    for v_entry_id, v_user_id in
      select e.id, e.user_id
      from public.league_entries e
      where e.league_id = p_league_id
      order by e.created_at
    loop
      v_i := v_i + 1;
      update public.league_entries set bracket_seed = v_i where id = v_entry_id;
    end loop;
  end if;

  update public.leagues
  set
    match_play_pairing_method = 'bracket',
    current_bracket_round = case when v_n = 2 then 'final' else 'r1' end
  where id = p_league_id;

  if v_n = 2 then
    v_e1 := public.entry_id_for_bracket_seed(p_league_id, 1);
    v_e2 := public.entry_id_for_bracket_seed(p_league_id, 2);
    insert into public.league_match_pairings (
      league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
      bracket_round, bracket_slot
    )
    values (p_league_id, v_e1, v_e2, 'scheduled', now(), 'final', 0);
    v_created := 1;
  elsif v_n = 3 then
    v_e1 := public.entry_id_for_bracket_seed(p_league_id, 2);
    v_e2 := public.entry_id_for_bracket_seed(p_league_id, 3);
    insert into public.league_match_pairings (
      league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
      bracket_round, bracket_slot
    )
    values (p_league_id, v_e1, v_e2, 'scheduled', now(), 'r1', 0);
    v_created := 1;
  elsif v_n = 4 then
    insert into public.league_match_pairings (
      league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
      bracket_round, bracket_slot
    )
    values (
      p_league_id,
      public.entry_id_for_bracket_seed(p_league_id, 1),
      public.entry_id_for_bracket_seed(p_league_id, 4),
      'scheduled', now(), 'r1', 0
    );
    insert into public.league_match_pairings (
      league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
      bracket_round, bracket_slot
    )
    values (
      p_league_id,
      public.entry_id_for_bracket_seed(p_league_id, 2),
      public.entry_id_for_bracket_seed(p_league_id, 3),
      'scheduled', now(), 'r1', 1
    );
    v_created := 2;
  elsif v_n = 8 then
    insert into public.league_match_pairings (
      league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
      bracket_round, bracket_slot
    )
    values
      (p_league_id, public.entry_id_for_bracket_seed(p_league_id, 1), public.entry_id_for_bracket_seed(p_league_id, 8), 'scheduled', now(), 'r1', 0),
      (p_league_id, public.entry_id_for_bracket_seed(p_league_id, 4), public.entry_id_for_bracket_seed(p_league_id, 5), 'scheduled', now(), 'r1', 1),
      (p_league_id, public.entry_id_for_bracket_seed(p_league_id, 3), public.entry_id_for_bracket_seed(p_league_id, 6), 'scheduled', now(), 'r1', 2),
      (p_league_id, public.entry_id_for_bracket_seed(p_league_id, 2), public.entry_id_for_bracket_seed(p_league_id, 7), 'scheduled', now(), 'r1', 3);
    v_created := 4;
  end if;

  return jsonb_build_object(
    'league_id', p_league_id,
    'player_count', v_n,
    'pairings_created', v_created,
    'current_bracket_round', case when v_n = 2 then 'final' else 'r1' end
  );
end;
$$;

