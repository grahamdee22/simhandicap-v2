-- Bracket Match Play honors leagues.use_handicap.
-- Already-completed pairings are not recalculated: apply_match_play_league_round
-- only loads scheduled/in_progress pairings. A bracket that is already underway
-- keeps earlier scratch results; the next match finished after this ships uses strokes.
-- A pairing with a missing index or course_par stays scratch and still resolves.

create or replace function public.match_play_strokes_on_hole(
  p_course_hole integer,
  p_stroke_count integer,
  p_stroke_index integer[]
) returns integer
language plpgsql
immutable
as $$
declare
  v_left integer;
  v_lap integer := 0;
  v_got integer := 0;
  v_i integer;
begin
  if p_stroke_count is null or p_stroke_count <= 0 or p_course_hole is null then
    return 0;
  end if;
  if p_stroke_index is null or array_length(p_stroke_index, 1) is null then
    return 0;
  end if;
  v_left := p_stroke_count;
  while v_left > 0 and v_lap < 3 loop
    for v_i in
      select gs
      from generate_series(1, array_length(p_stroke_index, 1)) as gs
      order by p_stroke_index[gs], gs
    loop
      exit when v_left <= 0;
      if v_i = p_course_hole then
        v_got := v_got + 1;
      end if;
      v_left := v_left - 1;
    end loop;
    v_lap := v_lap + 1;
  end loop;
  return v_got;
end;
$$;

revoke all on function public.match_play_strokes_on_hole(integer, integer, integer[]) from public;
grant execute on function public.match_play_strokes_on_hole(integer, integer, integer[]) to authenticated;
grant execute on function public.match_play_strokes_on_hole(integer, integer, integer[]) to service_role;

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
  v_n1 int;
  v_n2 int;
  v_dots int;
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
  v_expected_holes int;
  v_use_strokes boolean := false;
  v_recv_p1 boolean := false;
  v_stroke_count int := 0;
  v_offset int := 0;
  v_si integer[] := array[9, 11, 7, 15, 3, 13, 1, 17, 5, 10, 12, 8, 16, 4, 14, 2, 18, 6];
  v_rating1 double precision;
  v_slope1 double precision;
  v_par1 integer;
  v_idx1 numeric;
  v_si1 integer[];
  v_played1 text;
  v_rating2 double precision;
  v_slope2 double precision;
  v_par2 integer;
  v_idx2 numeric;
  v_si2 integer[];
  v_played2 text;
  v_ch1 integer;
  v_ch2 integer;
begin
  select * into v_pairing from public.league_match_pairings where id = p_pairing_id;
  if not found then
    raise exception 'Pairing not found';
  end if;

  select * into v_league from public.leagues where id = v_pairing.league_id;
  v_is_bracket := v_league.match_play_pairing_method = 'bracket';
  v_expected_holes := case when coalesce(v_league.holes_per_round, '18') = '9' then 9 else 18 end;

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

  select r.course_rating, r.slope, r.course_par, r.simcap_index_at_time, r.stroke_index_by_hole, r.holes_played
    into v_rating1, v_slope1, v_par1, v_idx1, v_si1, v_played1
  from public.league_rounds lr
  inner join public.rounds r on r.id = lr.round_id
  where lr.id = v_p1_round;

  select r.course_rating, r.slope, r.course_par, r.simcap_index_at_time, r.stroke_index_by_hole, r.holes_played
    into v_rating2, v_slope2, v_par2, v_idx2, v_si2, v_played2
  from public.league_rounds lr
  inner join public.rounds r on r.id = lr.round_id
  where lr.id = v_p2_round;

  if coalesce(v_league.use_handicap, false)
     and v_idx1 is not null and v_idx2 is not null
     and v_par1 is not null and v_par2 is not null
     and v_rating1 is not null and v_rating2 is not null
     and v_slope1 is not null and v_slope2 is not null
     and v_slope1 <> 0 and v_slope2 <> 0
  then
    v_ch1 := floor(
      v_idx1::double precision * (v_slope1 / 113.0) + (v_rating1 - v_par1) + 0.5
    )::integer;
    v_ch2 := floor(
      v_idx2::double precision * (v_slope2 / 113.0) + (v_rating2 - v_par2) + 0.5
    )::integer;
    if v_ch1 > v_ch2 then
      v_recv_p1 := true;
      v_stroke_count := v_ch1 - v_ch2;
    elsif v_ch2 > v_ch1 then
      v_recv_p1 := false;
      v_stroke_count := v_ch2 - v_ch1;
    else
      v_stroke_count := 0;
    end if;
    v_use_strokes := true;
    if v_si1 is not null and cardinality(v_si1) = 18 then
      v_si := v_si1;
    elsif v_si2 is not null and cardinality(v_si2) = 18 then
      v_si := v_si2;
    end if;
    if v_expected_holes = 9
       and coalesce(v_league.match_play_nine, v_played1, v_played2) = 'back'
    then
      v_offset := 9;
    end if;
  end if;

  for v_hole in 1..v_expected_holes loop
    select th.gross_score into v_g1
    from public.tournament_hole_scores th
    where th.league_round_id = v_p1_round and th.hole_number = v_hole;

    select th.gross_score into v_g2
    from public.tournament_hole_scores th
    where th.league_round_id = v_p2_round and th.hole_number = v_hole;

    if v_g1 is null or v_g2 is null then
      raise exception 'Both players need gross scores on all % holes', v_expected_holes;
    end if;

    v_n1 := v_g1;
    v_n2 := v_g2;
    if v_use_strokes and v_stroke_count > 0 then
      v_dots := public.match_play_strokes_on_hole(v_hole + v_offset, v_stroke_count, v_si);
      if v_recv_p1 then
        v_n1 := v_g1 - v_dots;
      else
        v_n2 := v_g2 - v_dots;
      end if;
    end if;

    if v_n1 < v_n2 then
      v_r1 := 'W';
      v_r2 := 'L';
      v_p1_wins := v_p1_wins + 1;
    elsif v_n2 < v_n1 then
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
