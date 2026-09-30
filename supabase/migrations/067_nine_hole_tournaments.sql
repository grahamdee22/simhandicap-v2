-- 9-hole tournaments (Stroke Play + Match Play only). Scramble/Best Ball stay
-- hardcoded to 18 holes — their team-hole-score aggregation path isn't touched.

alter table public.leagues
  add column if not exists holes_per_round text not null default '18'
    check (holes_per_round in ('18', '9'));

alter table public.leagues
  add column if not exists match_play_nine text null
    check (match_play_nine is null or match_play_nine in ('front', 'back'));

comment on column public.leagues.holes_per_round is
  'Tournament-wide round length, fixed at creation. No mixing 9- and 18-hole rounds within one tournament''s standings.';
comment on column public.leagues.match_play_nine is
  'Match Play + holes_per_round=9 only: front or back, fixed for the whole bracket so opponents always compare the same physical holes.';

alter table public.leagues
  drop constraint if exists leagues_nine_hole_format_check;
alter table public.leagues
  add constraint leagues_nine_hole_format_check
  check (holes_per_round = '18' or format in ('stroke', 'match_play'));

alter table public.leagues
  drop constraint if exists leagues_match_play_nine_required_check;
alter table public.leagues
  add constraint leagues_match_play_nine_required_check
  check (
    holes_per_round <> '9'
    or format <> 'match_play'
    or match_play_nine is not null
  );

-- Replace the blanket "no 9-hole round can join any tournament" check with a
-- per-league compatibility check. Trigger name is unchanged.
create or replace function public.reject_nine_hole_league_round()
returns trigger
language plpgsql
as $$
declare
  v_round_holes text;
  v_league_holes_per_round text;
  v_league_format text;
  v_league_nine text;
begin
  if new.round_id is null or new.league_id is null then
    return new;
  end if;

  select r.holes_played into v_round_holes
  from public.rounds r
  where r.id = new.round_id;

  select l.holes_per_round, l.format, l.match_play_nine
    into v_league_holes_per_round, v_league_format, v_league_nine
  from public.leagues l
  where l.id = new.league_id;

  if v_league_holes_per_round is null then
    v_league_holes_per_round := '18';
  end if;

  if v_league_holes_per_round = '18' then
    if v_round_holes is not null and v_round_holes <> '18' then
      raise exception
        'This tournament requires 18-hole rounds (holes_played=%)', v_round_holes
        using errcode = 'check_violation';
    end if;
  else
    if v_round_holes is null or v_round_holes = '18' then
      raise exception
        'This is a 9-hole tournament; log a Front 9 or Back 9 round instead'
        using errcode = 'check_violation';
    end if;

    if v_league_format = 'match_play' and v_league_nine is not null
       and v_round_holes <> v_league_nine then
      raise exception
        'This Match Play tournament plays % 9 only (holes_played=%)',
        v_league_nine, v_round_holes
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists league_rounds_reject_nine_hole on public.league_rounds;
create trigger league_rounds_reject_nine_hole
  before insert or update of round_id on public.league_rounds
  for each row
  execute procedure public.reject_nine_hole_league_round();

-- Match play + hole-scorecard RPCs: expected hole count follows the league.
-- Match play still stores gross only; W/L/H is computed when both cards exist
-- (same as 046/047). Bracket halved-seed and advance logic is preserved from 047.

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
  v_expected_holes int;
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

  v_expected_holes := case
    when v_league.format in ('scramble', 'best_ball') then 18
    when coalesce(v_league.holes_per_round, '18') = '9' then 9
    else 18
  end;

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
    if v_hole_num is null or v_hole_num < 1 or v_hole_num > v_expected_holes then
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

  if v_n < v_expected_holes then
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
    'holes_expected', v_expected_holes,
    'hole_entry_status', case when v_n < v_expected_holes then 'pending_holes' else 'complete' end
  );
end;
$$;


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
  v_expected_holes int;
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
  v_expected_holes int;
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

  v_expected_holes := case when coalesce(v_league.holes_per_round, '18') = '9' then 9 else 18 end;

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

  if v_gross_count < v_expected_holes then
    raise exception 'All % gross scores required', v_expected_holes;
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
