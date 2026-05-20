-- Match play: gross hole entry, server-side W/L/H when both players submit (v2.13.0)

-- ---------------------------------------------------------------------------
-- Upsert: match play uses gross only (results computed later)
-- ---------------------------------------------------------------------------

create or replace function public.upsert_tournament_hole_scores(
  p_league_round_id uuid,
  p_holes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lr public.league_rounds%rowtype;
  v_league public.leagues%rowtype;
  v_entry_id uuid;
  v_hole jsonb;
  v_n int := 0;
  v_hole_num int;
  v_gross int;
  v_result text;
  v_is_team boolean;
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
  if not found then
    raise exception 'League not found';
  end if;

  select e.id into v_entry_id
  from public.league_entries e
  where e.league_id = v_lr.league_id and e.user_id = v_uid;
  if v_entry_id is null then
    raise exception 'Not entered in this tournament';
  end if;

  if jsonb_typeof(p_holes) <> 'array' then
    raise exception 'p_holes must be a JSON array';
  end if;

  for v_hole in select * from jsonb_array_elements(p_holes)
  loop
    v_hole_num := (v_hole->>'hole_number')::int;
    if v_hole_num is null or v_hole_num < 1 or v_hole_num > 18 then
      raise exception 'Invalid hole_number';
    end if;

    v_gross := nullif(v_hole->>'gross_score', '')::int;
    v_result := nullif(trim(v_hole->>'result'), '');
    v_is_team := coalesce((v_hole->>'is_team_score')::boolean, false);

    if v_gross is null and v_result is null then
      raise exception 'Each hole requires gross_score or result';
    end if;

    if v_result is not null and v_result not in ('W', 'L', 'H') then
      raise exception 'Invalid result (use W, L, or H)';
    end if;

    if v_league.format = 'match_play' then
      if v_gross is null then
        raise exception 'Gross score required for match play';
      end if;
      v_result := null;
    end if;

    if v_league.format in ('stroke', 'best_ball', 'scramble') and v_gross is null then
      raise exception 'Gross score required for this format';
    end if;

    insert into public.tournament_hole_scores (
      league_entry_id,
      league_round_id,
      user_id,
      hole_number,
      gross_score,
      result,
      is_team_score,
      updated_at
    )
    values (
      v_entry_id,
      p_league_round_id,
      v_uid,
      v_hole_num,
      v_gross,
      v_result,
      v_is_team,
      now()
    )
    on conflict (league_round_id, hole_number) do update
    set
      gross_score = excluded.gross_score,
      result = excluded.result,
      is_team_score = excluded.is_team_score,
      updated_at = now();

    v_n := v_n + 1;
  end loop;

  if v_n < 18 then
    update public.league_rounds
    set hole_entry_status = 'pending_holes'
    where id = p_league_round_id;
  else
    update public.league_rounds
    set hole_entry_status = 'complete'
    where id = p_league_round_id;
  end if;

  return jsonb_build_object(
    'league_round_id', p_league_round_id,
    'holes_saved', v_n,
    'hole_entry_status', case when v_n < 18 then 'pending_holes' else 'complete' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Compare gross hole-by-hole and update pairing + per-player W/L/H results
-- ---------------------------------------------------------------------------

create or replace function public.recalculate_match_play_pairing(p_pairing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pairing public.league_match_pairings%rowtype;
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
  v_pts_p1 int;
  v_pts_p2 int;
  v_award_points boolean;
begin
  select * into v_pairing from public.league_match_pairings where id = p_pairing_id;
  if not found then
    raise exception 'Pairing not found';
  end if;

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
    v_winner := null;
    v_result := 'halved';
  end if;

  v_award_points := v_old_status not in ('complete', 'halved');

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

  return jsonb_build_object(
    'pairing_id', p_pairing_id,
    'status', case when v_result = 'halved' then 'halved' else 'complete' end,
    'winner_entry_id', v_winner,
    'holes_won_p1', v_p1_wins,
    'holes_won_p2', v_p2_wins,
    'holes_halved', v_halved,
    'awaiting_opponent', false,
    'points_awarded', v_award_points
  );
end;
$$;

grant execute on function public.recalculate_match_play_pairing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Link a completed scorecard; recalculate when both players have submitted
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

  select * into v_pairing
  from public.league_match_pairings p
  where p.league_id = v_lr.league_id
    and p.status in ('scheduled', 'in_progress')
    and (p.player_1_entry_id = v_entry.id or p.player_2_entry_id = v_entry.id)
  order by p.created_at
  limit 1;

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

-- ---------------------------------------------------------------------------
-- Admin-assigned pairings at tournament create
-- ---------------------------------------------------------------------------

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

  if not exists (
    select 1 from public.social_groups g
    where g.id = v_league.group_id and g.created_by = v_uid
  ) then
    raise exception 'Only the group creator can save pairings';
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

grant execute on function public.save_admin_match_play_pairings(uuid, jsonb) to authenticated;
