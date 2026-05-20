-- Single-elimination Match Play bracket (v2.14). Seeded by SimCap index at creation.

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

alter table public.leagues
  add column if not exists current_bracket_round text;

alter table public.leagues
  drop constraint if exists leagues_match_play_pairing_method_check;

alter table public.leagues
  add constraint leagues_match_play_pairing_method_check
  check (
    match_play_pairing_method is null
    or match_play_pairing_method in ('random', 'admin', 'bracket')
  );

alter table public.leagues
  drop constraint if exists leagues_current_bracket_round_check;

alter table public.leagues
  add constraint leagues_current_bracket_round_check
  check (
    current_bracket_round is null
    or current_bracket_round in ('r1', 'semifinal', 'final')
  );

comment on column public.leagues.current_bracket_round is
  'Active bracket round for match-play bracket tournaments (denormalized for UI).';

alter table public.league_entries
  add column if not exists bracket_seed integer;

create unique index if not exists league_entries_league_bracket_seed_uidx
  on public.league_entries (league_id, bracket_seed)
  where bracket_seed is not null;

alter table public.league_match_pairings
  add column if not exists bracket_round text,
  add column if not exists bracket_slot integer not null default 0,
  add column if not exists feeder_pairing_1_id uuid references public.league_match_pairings (id) on delete set null,
  add column if not exists feeder_pairing_2_id uuid references public.league_match_pairings (id) on delete set null;

alter table public.league_match_pairings
  drop constraint if exists league_match_pairings_bracket_round_check;

alter table public.league_match_pairings
  add constraint league_match_pairings_bracket_round_check
  check (
    bracket_round is null
    or bracket_round in ('r1', 'semifinal', 'final')
  );

create index if not exists league_match_pairings_league_bracket_idx
  on public.league_match_pairings (league_id, bracket_round, bracket_slot);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.bracket_winner_entry_id(p_pairing public.league_match_pairings)
returns uuid
language plpgsql
stable
as $$
declare
  v_s1 int;
  v_s2 int;
begin
  if p_pairing.winner_entry_id is not null then
    return p_pairing.winner_entry_id;
  end if;
  if p_pairing.status <> 'halved' then
    return null;
  end if;
  select bracket_seed into v_s1 from public.league_entries where id = p_pairing.player_1_entry_id;
  select bracket_seed into v_s2 from public.league_entries where id = p_pairing.player_2_entry_id;
  if v_s1 is null or v_s2 is null then
    return p_pairing.player_1_entry_id;
  end if;
  if v_s1 <= v_s2 then
    return p_pairing.player_1_entry_id;
  end if;
  return p_pairing.player_2_entry_id;
end;
$$;

create or replace function public.entry_id_for_bracket_seed(p_league_id uuid, p_seed int)
returns uuid
language sql
stable
as $$
  select id from public.league_entries
  where league_id = p_league_id and bracket_seed = p_seed
  limit 1;
$$;

create or replace function public.bracket_round_all_complete(p_league_id uuid, p_round text)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1 from public.league_match_pairings p
    where p.league_id = p_league_id
      and p.bracket_round = p_round
      and p.status not in ('complete', 'halved')
  )
  and exists (
    select 1 from public.league_match_pairings p
    where p.league_id = p_league_id and p.bracket_round = p_round
  );
$$;

-- ---------------------------------------------------------------------------
-- Generate bracket (call after league create; p_seeded_user_ids = seed 1 first)
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

  if not exists (
    select 1 from public.social_groups g
    where g.id = v_league.group_id and g.created_by = v_uid
  ) then
    raise exception 'Only the group creator can generate the bracket';
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

grant execute on function public.generate_match_play_bracket(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Advance winner to next round
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
  v_r1_0 uuid;
  v_r1_1 uuid;
  v_r1_2 uuid;
  v_r1_3 uuid;
  v_w0 uuid;
  v_w1 uuid;
  v_w2 uuid;
  v_w3 uuid;
  v_s0 uuid;
  v_s1 uuid;
  v_final_id uuid;
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

  -- 3 players: R1 complete -> Final (seed 1 vs R1 winner)
  if v_n = 3 and v_pairing.bracket_round = 'r1' then
    if public.bracket_round_all_complete(v_pairing.league_id, 'r1') then
      select id into v_final_id
      from public.league_match_pairings
      where league_id = v_pairing.league_id and bracket_round = 'final'
      limit 1;
      if v_final_id is null then
        insert into public.league_match_pairings (
          league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
          bracket_round, bracket_slot, feeder_pairing_2_id
        )
        values (
          v_pairing.league_id,
          public.entry_id_for_bracket_seed(v_pairing.league_id, 1),
          v_winner,
          'scheduled',
          now(),
          'final',
          0,
          p_pairing_id
        );
        update public.leagues
        set current_bracket_round = 'final'
        where id = v_pairing.league_id;
        return jsonb_build_object('advanced', true, 'created_round', 'final');
      end if;
    end if;
    return jsonb_build_object('advanced', false);
  end if;

  -- 4 players: both R1 done -> Final
  if v_n = 4 and v_pairing.bracket_round = 'r1' then
    if public.bracket_round_all_complete(v_pairing.league_id, 'r1') then
      select id into v_final_id
      from public.league_match_pairings
      where league_id = v_pairing.league_id and bracket_round = 'final'
      limit 1;
      if v_final_id is null then
        select id into v_r1_0 from public.league_match_pairings
          where league_id = v_pairing.league_id and bracket_round = 'r1' and bracket_slot = 0;
        select id into v_r1_1 from public.league_match_pairings
          where league_id = v_pairing.league_id and bracket_round = 'r1' and bracket_slot = 1;
        v_w0 := public.bracket_winner_entry_id((select p from public.league_match_pairings p where id = v_r1_0));
        v_w1 := public.bracket_winner_entry_id((select p from public.league_match_pairings p where id = v_r1_1));
        insert into public.league_match_pairings (
          league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
          bracket_round, bracket_slot, feeder_pairing_1_id, feeder_pairing_2_id
        )
        values (v_pairing.league_id, v_w0, v_w1, 'scheduled', now(), 'final', 0, v_r1_0, v_r1_1);
        update public.leagues set current_bracket_round = 'final' where id = v_pairing.league_id;
        return jsonb_build_object('advanced', true, 'created_round', 'final');
      end if;
    end if;
    return jsonb_build_object('advanced', false);
  end if;

  -- 8 players: R1 -> Semis -> Final
  if v_n = 8 and v_pairing.bracket_round = 'r1' then
    if public.bracket_round_all_complete(v_pairing.league_id, 'r1') then
      if not exists (
        select 1 from public.league_match_pairings
        where league_id = v_pairing.league_id and bracket_round = 'semifinal'
      ) then
        select id into v_r1_0 from public.league_match_pairings where league_id = v_pairing.league_id and bracket_round = 'r1' and bracket_slot = 0;
        select id into v_r1_1 from public.league_match_pairings where league_id = v_pairing.league_id and bracket_round = 'r1' and bracket_slot = 1;
        select id into v_r1_2 from public.league_match_pairings where league_id = v_pairing.league_id and bracket_round = 'r1' and bracket_slot = 2;
        select id into v_r1_3 from public.league_match_pairings where league_id = v_pairing.league_id and bracket_round = 'r1' and bracket_slot = 3;
        v_w0 := public.bracket_winner_entry_id((select p from public.league_match_pairings p where id = v_r1_0));
        v_w1 := public.bracket_winner_entry_id((select p from public.league_match_pairings p where id = v_r1_1));
        v_w2 := public.bracket_winner_entry_id((select p from public.league_match_pairings p where id = v_r1_2));
        v_w3 := public.bracket_winner_entry_id((select p from public.league_match_pairings p where id = v_r1_3));
        insert into public.league_match_pairings (
          league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
          bracket_round, bracket_slot, feeder_pairing_1_id, feeder_pairing_2_id
        )
        values
          (v_pairing.league_id, v_w0, v_w1, 'scheduled', now(), 'semifinal', 0, v_r1_0, v_r1_1),
          (v_pairing.league_id, v_w2, v_w3, 'scheduled', now(), 'semifinal', 1, v_r1_2, v_r1_3);
        update public.leagues set current_bracket_round = 'semifinal' where id = v_pairing.league_id;
        return jsonb_build_object('advanced', true, 'created_round', 'semifinal');
      end if;
    end if;
    return jsonb_build_object('advanced', false);
  end if;

  if v_n = 8 and v_pairing.bracket_round = 'semifinal' then
    if public.bracket_round_all_complete(v_pairing.league_id, 'semifinal') then
      select id into v_final_id
      from public.league_match_pairings
      where league_id = v_pairing.league_id and bracket_round = 'final'
      limit 1;
      if v_final_id is null then
        select id into v_s0 from public.league_match_pairings where league_id = v_pairing.league_id and bracket_round = 'semifinal' and bracket_slot = 0;
        select id into v_s1 from public.league_match_pairings where league_id = v_pairing.league_id and bracket_round = 'semifinal' and bracket_slot = 1;
        v_w0 := public.bracket_winner_entry_id((select p from public.league_match_pairings p where id = v_s0));
        v_w1 := public.bracket_winner_entry_id((select p from public.league_match_pairings p where id = v_s1));
        insert into public.league_match_pairings (
          league_id, player_1_entry_id, player_2_entry_id, status, scheduled_at,
          bracket_round, bracket_slot, feeder_pairing_1_id, feeder_pairing_2_id
        )
        values (v_pairing.league_id, v_w0, v_w1, 'scheduled', now(), 'final', 0, v_s0, v_s1);
        update public.leagues set current_bracket_round = 'final' where id = v_pairing.league_id;
        return jsonb_build_object('advanced', true, 'created_round', 'final');
      end if;
    end if;
    return jsonb_build_object('advanced', false);
  end if;

  return jsonb_build_object('advanced', false, 'reason', 'no_action');
end;
$$;

grant execute on function public.advance_match_play_bracket(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Recalculate: halved -> lower seed wins bracket; no PTS; advance bracket
-- ---------------------------------------------------------------------------

create or replace function public.recalculate_match_play_pairing(p_pairing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pairing public.league_match_pairings%rowtype;
  v_league public.leagues%rowtype;
  v_old_status text;
  v_p1_round uuid;
  v_p2_round uuid;
  v_p1_entry uuid;
  v_p2_entry uuid;
  v_complete_count int;
  v_hole int;
  v_g1 int;
  v_g2 int;
  v_p1_wins int := 0;
  v_p2_wins int := 0;
  v_halved int := 0;
  v_r1 text;
  v_r2 text;
  v_winner uuid;
  v_result text;
  v_award_points boolean;
  v_is_bracket boolean;
  v_s1 int;
  v_s2 int;
  v_advance jsonb;
begin
  select * into v_pairing from public.league_match_pairings where id = p_pairing_id;
  if not found then
    raise exception 'Pairing not found';
  end if;

  select * into v_league from public.leagues where id = v_pairing.league_id;
  v_is_bracket := v_league.match_play_pairing_method = 'bracket';

  v_old_status := v_pairing.status;
  v_p1_entry := v_pairing.player_1_entry_id;
  v_p2_entry := v_pairing.player_2_entry_id;

  select count(*)::int into v_complete_count
  from public.league_match_pairing_rounds pr
  inner join public.league_rounds lr on lr.id = pr.league_round_id
  where pr.pairing_id = p_pairing_id
    and lr.hole_entry_status = 'complete';

  if v_complete_count < 2 then
    update public.league_match_pairings
    set
      status = case when v_complete_count = 1 then 'in_progress' else 'scheduled' end,
      holes_won_p1 = 0,
      holes_won_p2 = 0,
      holes_halved = 0,
      winner_entry_id = null,
      completed_at = null
    where id = p_pairing_id
      and status not in ('complete', 'halved');

    return jsonb_build_object(
      'pairing_id', p_pairing_id,
      'status', case when v_complete_count = 1 then 'in_progress' else 'scheduled' end,
      'awaiting_opponent', true,
      'complete_rounds', v_complete_count
    );
  end if;

  select pr.league_round_id into v_p1_round
  from public.league_match_pairing_rounds pr
  where pr.pairing_id = p_pairing_id and pr.submitted_by_entry_id = v_p1_entry
  limit 1;

  select pr.league_round_id into v_p2_round
  from public.league_match_pairing_rounds pr
  where pr.pairing_id = p_pairing_id and pr.submitted_by_entry_id = v_p2_entry
  limit 1;

  if v_p1_round is null or v_p2_round is null then
    raise exception 'Both players must have linked scorecards';
  end if;

  for v_hole in 1..18 loop
    select th.gross_score into v_g1
    from public.tournament_hole_scores th
    where th.league_round_id = v_p1_round and th.hole_number = v_hole;

    select th.gross_score into v_g2
    from public.tournament_hole_scores th
    where th.league_round_id = v_p2_round and th.hole_number = v_hole;

    if v_g1 is null or v_g2 is null then
      raise exception 'Both players need gross scores on all 18 holes';
    end if;

    if v_g1 < v_g2 then
      v_r1 := 'W';
      v_r2 := 'L';
      v_p1_wins := v_p1_wins + 1;
    elsif v_g2 < v_g1 then
      v_r1 := 'L';
      v_r2 := 'W';
      v_p2_wins := v_p2_wins + 1;
    else
      v_r1 := 'H';
      v_r2 := 'H';
      v_halved := v_halved + 1;
    end if;

    update public.tournament_hole_scores
    set result = v_r1, updated_at = now()
    where league_round_id = v_p1_round and hole_number = v_hole;

    update public.tournament_hole_scores
    set result = v_r2, updated_at = now()
    where league_round_id = v_p2_round and hole_number = v_hole;
  end loop;

  if v_p1_wins > v_p2_wins then
    v_winner := v_p1_entry;
    v_result := 'win';
  elsif v_p2_wins > v_p1_wins then
    v_winner := v_p2_entry;
    v_result := 'win';
  else
    v_result := 'halved';
    if v_is_bracket then
      select bracket_seed into v_s1 from public.league_entries where id = v_p1_entry;
      select bracket_seed into v_s2 from public.league_entries where id = v_p2_entry;
      if coalesce(v_s1, 999) <= coalesce(v_s2, 999) then
        v_winner := v_p1_entry;
      else
        v_winner := v_p2_entry;
      end if;
    else
      v_winner := null;
    end if;
  end if;

  v_award_points := v_old_status not in ('complete', 'halved') and not v_is_bracket;

  update public.league_match_pairings
  set
    status = case when v_result = 'halved' then 'halved' else 'complete' end,
    winner_entry_id = v_winner,
    holes_won_p1 = v_p1_wins,
    holes_won_p2 = v_p2_wins,
    holes_halved = v_halved,
    completed_at = now()
  where id = p_pairing_id;

  if v_award_points then
    if v_result = 'halved' then
      update public.league_entries set mp_halved = mp_halved + 1, points = points + 1
        where id = v_p1_entry;
      update public.league_entries set mp_halved = mp_halved + 1, points = points + 1
        where id = v_p2_entry;
    elsif v_winner = v_p1_entry then
      update public.league_entries set mp_wins = mp_wins + 1, points = points + 2
        where id = v_p1_entry;
      update public.league_entries set mp_losses = mp_losses + 1
        where id = v_p2_entry;
    else
      update public.league_entries set mp_losses = mp_losses + 1
        where id = v_p1_entry;
      update public.league_entries set mp_wins = mp_wins + 1, points = points + 2
        where id = v_p2_entry;
    end if;
  end if;

  v_advance := null;
  if v_is_bracket and v_winner is not null and v_old_status not in ('complete', 'halved') then
    v_advance := public.advance_match_play_bracket(p_pairing_id);
  end if;

  return jsonb_build_object(
    'pairing_id', p_pairing_id,
    'status', case when v_result = 'halved' then 'halved' else 'complete' end,
    'winner_entry_id', v_winner,
    'holes_won_p1', v_p1_wins,
    'holes_won_p2', v_p2_wins,
    'holes_halved', v_halved,
    'awaiting_opponent', false,
    'points_awarded', v_award_points,
    'bracket_advance', v_advance
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Apply round: only pairings in the league's current bracket round
-- ---------------------------------------------------------------------------

create or replace function public.apply_match_play_league_round(p_league_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lr public.league_rounds%rowtype;
  v_league public.leagues%rowtype;
  v_entry public.league_entries%rowtype;
  v_pairing public.league_match_pairings%rowtype;
  v_gross_count int;
  v_recalc jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_lr from public.league_rounds where id = p_league_round_id;
  if not found then
    raise exception 'League round not found';
  end if;

  if v_lr.user_id <> v_uid then
    raise exception 'Forbidden';
  end if;

  select * into v_league from public.leagues where id = v_lr.league_id;
  if not found or v_league.format <> 'match_play' then
    raise exception 'Not a match play tournament';
  end if;

  select * into v_entry
  from public.league_entries
  where league_id = v_lr.league_id and user_id = v_lr.user_id;
  if not found then
    raise exception 'Entry not found';
  end if;

  if v_lr.hole_entry_status <> 'complete' then
    raise exception 'Hole scorecard must be complete before applying to pairing';
  end if;

  select count(*)::int into v_gross_count
  from public.tournament_hole_scores
  where league_round_id = p_league_round_id and gross_score is not null;

  if v_gross_count < 18 then
    raise exception 'All 18 gross scores required';
  end if;

  if v_league.match_play_pairing_method = 'bracket' then
    select * into v_pairing
    from public.league_match_pairings p
    where p.league_id = v_lr.league_id
      and p.bracket_round = v_league.current_bracket_round
      and p.status in ('scheduled', 'in_progress')
      and (p.player_1_entry_id = v_entry.id or p.player_2_entry_id = v_entry.id)
    order by p.bracket_slot
    limit 1;
  else
    select * into v_pairing
    from public.league_match_pairings p
    where p.league_id = v_lr.league_id
      and p.status in ('scheduled', 'in_progress')
      and (p.player_1_entry_id = v_entry.id or p.player_2_entry_id = v_entry.id)
    order by p.created_at
    limit 1;
  end if;

  if not found then
    raise exception 'No active match pairing found for this player';
  end if;

  insert into public.league_match_pairing_rounds (pairing_id, league_round_id, submitted_by_entry_id)
  values (v_pairing.id, p_league_round_id, v_entry.id)
  on conflict (league_round_id) do nothing;

  v_recalc := public.recalculate_match_play_pairing(v_pairing.id);

  return v_recalc || jsonb_build_object(
    'pairing_id', v_pairing.id,
    'league_round_id', p_league_round_id
  );
end;
$$;
