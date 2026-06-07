-- Fix Match Play bracket advance for non-power-of-2 fields (e.g. 10 players).
-- Prior advance logic used wrong winner-array indices when pairing odd winner
-- counts, inserting null player_2_entry_id and breaking R2+ / auto-completion.

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
  v_slot int;
  v_user_id uuid;
  v_entry_id uuid;
  v_rows int;
  v_seed1 int;
  v_seed2 int;
  v_e1 uuid;
  v_e2 uuid;
  v_created int := 0;
  v_first_round text;
  v_order int[];
  v_pos int;
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

  if v_n < 2 or v_n > 30 or v_n % 2 <> 0 then
    raise exception 'Match Play requires an even number of players from 2 to 30';
  end if;

  v_first_round := public.bracket_round_name_for_players(0, v_n);

  update public.league_entries set bracket_seed = null where league_id = p_league_id;
  delete from public.league_match_pairings where league_id = p_league_id;

  if p_seeded_user_ids is not null and coalesce(array_length(p_seeded_user_ids, 1), 0) = v_n then
    v_slot := 1;
    foreach v_user_id in array p_seeded_user_ids loop
      update public.league_entries
      set bracket_seed = v_slot
      where league_id = p_league_id and user_id = v_user_id;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception 'Every group member must be entered in the tournament';
      end if;
      v_slot := v_slot + 1;
    end loop;
  else
    v_slot := 0;
    for v_entry_id, v_user_id in
      select e.id, e.user_id
      from public.league_entries e
      where e.league_id = p_league_id
      order by e.created_at
    loop
      v_slot := v_slot + 1;
      update public.league_entries set bracket_seed = v_slot where id = v_entry_id;
    end loop;
  end if;

  if v_n > 0 and (v_n & (v_n - 1)) = 0 then
    v_order := public.bracket_seed_order(v_n);
    for v_slot in 0..(v_n / 2 - 1) loop
      v_pos := v_slot * 2;
      v_seed1 := v_order[v_pos + 1];
      v_seed2 := v_order[v_pos + 2];
      v_e1 := public.entry_id_for_bracket_seed(p_league_id, v_seed1);
      v_e2 := public.entry_id_for_bracket_seed(p_league_id, v_seed2);
      if v_e1 is null or v_e2 is null then
        raise exception 'Bracket seed mapping failed for seeds % and %', v_seed1, v_seed2;
      end if;
      insert into public.league_match_pairings (
        league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
        bracket_round, bracket_slot
      )
      values (p_league_id, v_e1, v_e2, 'scheduled', now(), v_first_round, v_slot);
      v_created := v_created + 1;
    end loop;
  else
    for v_slot in 0..(v_n / 2 - 1) loop
      v_seed1 := v_slot + 1;
      v_seed2 := v_n - v_slot;
      v_e1 := public.entry_id_for_bracket_seed(p_league_id, v_seed1);
      v_e2 := public.entry_id_for_bracket_seed(p_league_id, v_seed2);
      if v_e1 is null or v_e2 is null then
        raise exception 'Bracket seed mapping failed for seeds % and %', v_seed1, v_seed2;
      end if;
      insert into public.league_match_pairings (
        league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
        bracket_round, bracket_slot
      )
      values (p_league_id, v_e1, v_e2, 'scheduled', now(), v_first_round, v_slot);
      v_created := v_created + 1;
    end loop;
  end if;

  update public.leagues
  set
    match_play_pairing_method = 'bracket',
    current_bracket_round = v_first_round,
    bracket_byes = null
  where id = p_league_id;

  return jsonb_build_object(
    'league_id', p_league_id,
    'player_count', v_n,
    'pairings_created', v_created,
    'current_bracket_round', v_first_round
  );
end;
$$;

create or replace function public.advance_match_play_bracket(p_pairing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pairing public.league_match_pairings%rowtype;
  v_league public.leagues%rowtype;
  v_n int;
  v_round_idx int;
  v_next_idx int;
  v_competitors int;
  v_match_count int;
  v_next_round text;
  v_byes jsonb;
  v_winners uuid[] := '{}';
  v_w int;
  v_i int;
  v_j int;
  v_slot int;
  v_feeder_1 uuid;
  v_feeder_2 uuid;
  v_feeder_slot_1 int;
  v_feeder_slot_2 int;
  v_e1 uuid;
  v_e2 uuid;
begin
  select * into v_pairing from public.league_match_pairings where id = p_pairing_id;
  if not found then
    raise exception 'Pairing not found';
  end if;

  select * into v_league from public.leagues where id = v_pairing.league_id;
  if v_league.match_play_pairing_method <> 'bracket' then
    return jsonb_build_object('advanced', false, 'reason', 'not_bracket');
  end if;

  if v_pairing.status not in ('complete', 'halved') then
    return jsonb_build_object('advanced', false, 'reason', 'match_not_finished');
  end if;

  if public.bracket_winner_entry_id(v_pairing) is null then
    return jsonb_build_object('advanced', false, 'reason', 'no_winner');
  end if;

  select count(*)::int into v_n
  from public.league_entries where league_id = v_pairing.league_id;

  v_round_idx := public.bracket_round_index_for_players(v_pairing.bracket_round, v_n);
  if v_round_idx < 0 then
    return jsonb_build_object('advanced', false, 'reason', 'unknown_round');
  end if;

  if not public.bracket_round_all_complete(v_pairing.league_id, v_pairing.bracket_round) then
    return jsonb_build_object('advanced', false);
  end if;

  v_next_idx := v_round_idx + 1;
  if v_next_idx >= public.bracket_total_rounds_for_players(v_n) then
    return jsonb_build_object('advanced', false, 'reason', 'already_final');
  end if;

  v_next_round := public.bracket_round_name_for_players(v_next_idx, v_n);

  if exists (
    select 1 from public.league_match_pairings
    where league_id = v_pairing.league_id and bracket_round = v_next_round
  ) then
    return jsonb_build_object('advanced', false, 'reason', 'next_round_exists');
  end if;

  v_competitors := public.bracket_competitors_in_round(v_n, v_round_idx);
  v_match_count := v_competitors / 2;

  if v_competitors % 2 = 1 then
    v_winners := array_append(v_winners, public.bracket_bye_entry(v_pairing.league_id, v_pairing.bracket_round));
    for v_i in 0..(v_match_count - 1) loop
      v_winners := array_append(
        v_winners,
        public.bracket_slot_winner(v_pairing.league_id, v_pairing.bracket_round, v_i)
      );
    end loop;
  else
    for v_i in 0..(v_match_count - 1) loop
      v_winners := array_append(
        v_winners,
        public.bracket_slot_winner(v_pairing.league_id, v_pairing.bracket_round, v_i)
      );
    end loop;
  end if;

  v_w := coalesce(array_length(v_winners, 1), 0);
  if v_w < 2 then
    raise exception 'Bracket advance failed: expected at least 2 winners, got %', v_w;
  end if;

  v_byes := coalesce(v_league.bracket_byes, '[]'::jsonb);

  if v_w % 2 = 1 then
    -- Slot 0 receives the bye; pair remaining winner slots outer-inner (matches bracketAdvancePairings).
    v_byes := v_byes || jsonb_build_array(
      jsonb_build_object('round', v_next_round, 'slot', 0, 'entry_id', v_winners[1])
    );
    v_slot := 0;
    for v_i in 1..(v_w / 2) loop
      v_j := v_w - v_i;
      v_e1 := v_winners[v_i + 1];
      v_e2 := v_winners[v_j + 1];
      if v_e1 is null or v_e2 is null then
        raise exception 'Bracket advance failed: null winner pairing slots % and % (w=%)', v_i, v_j, v_w;
      end if;

      if v_competitors % 2 = 1 then
        v_feeder_slot_1 := v_i - 1;
        v_feeder_slot_2 := v_j - 1;
      else
        v_feeder_slot_1 := v_i;
        v_feeder_slot_2 := v_j;
      end if;

      select id into v_feeder_1
      from public.league_match_pairings
      where league_id = v_pairing.league_id
        and bracket_round = v_pairing.bracket_round
        and bracket_slot = v_feeder_slot_1
      limit 1;

      select id into v_feeder_2
      from public.league_match_pairings
      where league_id = v_pairing.league_id
        and bracket_round = v_pairing.bracket_round
        and bracket_slot = v_feeder_slot_2
      limit 1;

      insert into public.league_match_pairings (
        league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
        bracket_round, bracket_slot, feeder_pairing_1_id, feeder_pairing_2_id
      )
      values (
        v_pairing.league_id,
        v_e1,
        v_e2,
        'scheduled',
        now(),
        v_next_round,
        v_slot,
        v_feeder_1,
        v_feeder_2
      );
      v_slot := v_slot + 1;
    end loop;
  else
    v_slot := 0;
    for v_i in 0..(v_w / 2 - 1) loop
      v_e1 := v_winners[v_i * 2 + 1];
      v_e2 := v_winners[v_i * 2 + 2];
      if v_e1 is null or v_e2 is null then
        raise exception 'Bracket advance failed: null winner at even pairing index %', v_i;
      end if;

      select id into v_feeder_1
      from public.league_match_pairings
      where league_id = v_pairing.league_id
        and bracket_round = v_pairing.bracket_round
        and bracket_slot = v_i * 2
      limit 1;

      select id into v_feeder_2
      from public.league_match_pairings
      where league_id = v_pairing.league_id
        and bracket_round = v_pairing.bracket_round
        and bracket_slot = v_i * 2 + 1
      limit 1;

      insert into public.league_match_pairings (
        league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
        bracket_round, bracket_slot, feeder_pairing_1_id, feeder_pairing_2_id
      )
      values (
        v_pairing.league_id,
        v_e1,
        v_e2,
        'scheduled',
        now(),
        v_next_round,
        v_slot,
        v_feeder_1,
        v_feeder_2
      );
      v_slot := v_slot + 1;
    end loop;
  end if;

  update public.leagues
  set
    current_bracket_round = v_next_round,
    bracket_byes = case when jsonb_array_length(v_byes) > 0 then v_byes else null end
  where id = v_pairing.league_id;

  if v_next_round = 'final' then
    update public.leagues set bracket_byes = null where id = v_pairing.league_id;
  end if;

  return jsonb_build_object('advanced', true, 'created_round', v_next_round);
end;
$$;
