-- Match Play: allow any even player count from 2–30 (single-elimination bracket).

alter table public.leagues
  add column if not exists bracket_byes jsonb;

comment on column public.leagues.bracket_byes is
  'First-round bye slots: [{ "slot": 0, "entry_id": "uuid" }, ...]. Cleared when bracket is reset.';

alter table public.leagues
  drop constraint if exists leagues_current_bracket_round_check;

alter table public.leagues
  add constraint leagues_current_bracket_round_check
  check (
    current_bracket_round is null
    or current_bracket_round ~ '^r[1-5]$'
    or current_bracket_round in ('semifinal', 'final')
  );

alter table public.league_match_pairings
  drop constraint if exists league_match_pairings_bracket_round_check;

alter table public.league_match_pairings
  add constraint league_match_pairings_bracket_round_check
  check (
    bracket_round is null
    or bracket_round ~ '^r[1-5]$'
    or bracket_round in ('semifinal', 'final')
  );

-- ---------------------------------------------------------------------------
-- Bracket sizing helpers
-- ---------------------------------------------------------------------------

create or replace function public.bracket_size_for_players(p_n int)
returns int
language plpgsql
immutable
as $$
declare
  v_b int := 2;
begin
  if p_n <= 2 then
    return 2;
  end if;
  while v_b < p_n loop
    v_b := v_b * 2;
  end loop;
  return v_b;
end;
$$;

create or replace function public.bracket_total_rounds(p_bracket_size int)
returns int
language plpgsql
immutable
as $$
declare
  v_rounds int := 0;
  v_n int := p_bracket_size;
begin
  while v_n > 1 loop
    v_rounds := v_rounds + 1;
    v_n := v_n / 2;
  end loop;
  return v_rounds;
end;
$$;

create or replace function public.bracket_round_name(p_round_index int, p_total_rounds int)
returns text
language plpgsql
immutable
as $$
begin
  if p_round_index >= p_total_rounds - 1 then
    return 'final';
  end if;
  return 'r' || (p_round_index + 1)::text;
end;
$$;

create or replace function public.bracket_round_index(p_round text, p_total_rounds int)
returns int
language plpgsql
stable
as $$
begin
  if p_round = 'final' then
    return p_total_rounds - 1;
  end if;
  if p_round = 'semifinal' then
    return greatest(0, p_total_rounds - 2);
  end if;
  if p_round ~ '^r[1-9]+$' then
    return substring(p_round from 2)::int - 1;
  end if;
  return -1;
end;
$$;

create or replace function public.bracket_slots_in_round(p_bracket_size int, p_round_index int)
returns int
language plpgsql
immutable
as $$
begin
  return (p_bracket_size / power(2, p_round_index + 1))::int;
end;
$$;

create or replace function public.bracket_seed_order(p_bracket_size int)
returns int[]
language plpgsql
immutable
as $$
declare
  v_half int[];
  v_result int[] := '{}';
  v_seed int;
  v_other int;
begin
  if p_bracket_size < 2 then
    return v_result;
  end if;
  if p_bracket_size = 2 then
    return array[1, 2];
  end if;
  v_half := public.bracket_seed_order(p_bracket_size / 2);
  foreach v_seed in array v_half loop
    v_other := p_bracket_size + 1 - v_seed;
    v_result := v_result || array[v_seed, v_other];
  end loop;
  return v_result;
end;
$$;

create or replace function public.bracket_slot_winner(
  p_league_id uuid,
  p_round text,
  p_slot int
)
returns uuid
language plpgsql
stable
as $$
declare
  v_pairing public.league_match_pairings%rowtype;
  v_bye jsonb;
  v_item jsonb;
begin
  select * into v_pairing
  from public.league_match_pairings
  where league_id = p_league_id
    and bracket_round = p_round
    and bracket_slot = p_slot
  limit 1;

  if found then
    return public.bracket_winner_entry_id(v_pairing);
  end if;

  if p_round <> 'r1' then
    return null;
  end if;

  select bracket_byes into v_bye from public.leagues where id = p_league_id;
  if v_bye is null then
    return null;
  end if;

  for v_item in select * from jsonb_array_elements(v_bye) loop
    if (v_item->>'slot')::int = p_slot then
      return (v_item->>'entry_id')::uuid;
    end if;
  end loop;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Generate bracket (2–30 even players)
-- ---------------------------------------------------------------------------

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
  v_b int;
  v_total_rounds int;
  v_order int[];
  v_byes jsonb := '[]'::jsonb;
  v_i int;
  v_user_id uuid;
  v_entry_id uuid;
  v_rows int;
  v_slot int;
  v_seed1 int;
  v_seed2 int;
  v_e1 uuid;
  v_e2 uuid;
  v_created int := 0;
  v_first_round text;
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

  v_b := public.bracket_size_for_players(v_n);
  v_total_rounds := public.bracket_total_rounds(v_b);
  v_order := public.bracket_seed_order(v_b);
  v_first_round := public.bracket_round_name(0, v_total_rounds);

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

  for v_i in 0..(array_length(v_order, 1) / 2 - 1) loop
    v_slot := v_i;
    v_seed1 := v_order[v_i * 2 + 1];
    v_seed2 := v_order[v_i * 2 + 2];
    if v_seed1 <= v_n and v_seed2 <= v_n then
      v_e1 := public.entry_id_for_bracket_seed(p_league_id, v_seed1);
      v_e2 := public.entry_id_for_bracket_seed(p_league_id, v_seed2);
      insert into public.league_match_pairings (
        league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
        bracket_round, bracket_slot
      )
      values (p_league_id, v_e1, v_e2, 'scheduled', now(), v_first_round, v_slot);
      v_created := v_created + 1;
    elsif v_seed1 <= v_n then
      v_e1 := public.entry_id_for_bracket_seed(p_league_id, v_seed1);
      v_byes := v_byes || jsonb_build_array(
        jsonb_build_object('slot', v_slot, 'entry_id', v_e1)
      );
    elsif v_seed2 <= v_n then
      v_e2 := public.entry_id_for_bracket_seed(p_league_id, v_seed2);
      v_byes := v_byes || jsonb_build_array(
        jsonb_build_object('slot', v_slot, 'entry_id', v_e2)
      );
    end if;
  end loop;

  update public.leagues
  set
    match_play_pairing_method = 'bracket',
    current_bracket_round = v_first_round,
    bracket_byes = case when jsonb_array_length(v_byes) > 0 then v_byes else null end
  where id = p_league_id;

  return jsonb_build_object(
    'league_id', p_league_id,
    'player_count', v_n,
    'pairings_created', v_created,
    'current_bracket_round', v_first_round
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Advance bracket (generic rounds)
-- ---------------------------------------------------------------------------

create or replace function public.advance_match_play_bracket(p_pairing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pairing public.league_match_pairings%rowtype;
  v_league public.leagues%rowtype;
  v_winner uuid;
  v_n int;
  v_b int;
  v_total_rounds int;
  v_round_idx int;
  v_next_idx int;
  v_slots int;
  v_next_round text;
  v_i int;
  v_w1 uuid;
  v_w2 uuid;
  v_feeder_1 uuid;
  v_feeder_2 uuid;
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

  v_winner := public.bracket_winner_entry_id(v_pairing);
  if v_winner is null then
    return jsonb_build_object('advanced', false, 'reason', 'no_winner');
  end if;

  select count(*)::int into v_n
  from public.league_entries where league_id = v_pairing.league_id;

  v_b := public.bracket_size_for_players(v_n);
  v_total_rounds := public.bracket_total_rounds(v_b);
  v_round_idx := public.bracket_round_index(v_pairing.bracket_round, v_total_rounds);

  if v_round_idx < 0 then
    return jsonb_build_object('advanced', false, 'reason', 'unknown_round');
  end if;

  if not public.bracket_round_all_complete(v_pairing.league_id, v_pairing.bracket_round) then
    return jsonb_build_object('advanced', false);
  end if;

  v_next_idx := v_round_idx + 1;
  if v_next_idx >= v_total_rounds then
    return jsonb_build_object('advanced', false, 'reason', 'already_final');
  end if;

  v_next_round := public.bracket_round_name(v_next_idx, v_total_rounds);

  if exists (
    select 1 from public.league_match_pairings
    where league_id = v_pairing.league_id and bracket_round = v_next_round
  ) then
    return jsonb_build_object('advanced', false, 'reason', 'next_round_exists');
  end if;

  v_slots := public.bracket_slots_in_round(v_b, v_round_idx);

  for v_i in 0..(v_slots / 2 - 1) loop
    v_w1 := public.bracket_slot_winner(v_pairing.league_id, v_pairing.bracket_round, v_i * 2);
    v_w2 := public.bracket_slot_winner(v_pairing.league_id, v_pairing.bracket_round, v_i * 2 + 1);
    if v_w1 is null or v_w2 is null then
      raise exception 'Bracket advance failed: missing winner for slot %', v_i;
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
      v_w1,
      v_w2,
      'scheduled',
      now(),
      v_next_round,
      v_i,
      v_feeder_1,
      v_feeder_2
    );
  end loop;

  update public.leagues
  set current_bracket_round = v_next_round
  where id = v_pairing.league_id;

  if v_next_round = 'final' then
    update public.leagues set bracket_byes = null where id = v_pairing.league_id;
  end if;

  return jsonb_build_object('advanced', true, 'created_round', v_next_round);
end;
$$;
