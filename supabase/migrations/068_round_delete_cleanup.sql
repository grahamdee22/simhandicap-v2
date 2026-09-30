-- Soft-deleting a round (rounds.is_active = false) does not fire the
-- league_rounds.round_id ON DELETE CASCADE, so tournament scorecards stay
-- behind and keep showing the "Complete your tournament scorecard" banner.
-- This RPC removes those league_rounds when the caller deletes their round.
-- Pending-list and hole-score writes also ignore inactive rounds so an
-- already-orphaned row cannot be shown or counted.

create or replace function public.delete_league_rounds_for_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Ownership check: only clean up league_rounds the caller's own round produced.
  if not exists (
    select 1 from public.rounds where id = p_round_id and user_id = v_uid
  ) then
    raise exception 'Round not found or not owned by caller';
  end if;

  delete from public.league_rounds
  where round_id = p_round_id
    and user_id = v_uid;
  -- tournament_hole_scores cascades away automatically (league_round_id ... on delete cascade).
end;
$$;

grant execute on function public.delete_league_rounds_for_round(uuid) to authenticated;

create or replace function public.list_pending_tournament_hole_rounds()
returns table (
  league_round_id uuid,
  league_id uuid,
  league_name text,
  round_id uuid,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    lr.id as league_round_id,
    l.id as league_id,
    l.name as league_name,
    lr.round_id,
    lr.created_at
  from public.league_rounds lr
  inner join public.leagues l on l.id = lr.league_id
  inner join public.rounds r on r.id = lr.round_id
  where lr.user_id = auth.uid()
    and lr.hole_entry_status = 'pending_holes'
    and lr.player_opted_in = true
    and r.is_active = true
    and l.format in ('match_play', 'scramble', 'best_ball')
  order by lr.created_at desc;
$$;

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

  if not exists (select 1 from public.rounds where id = v_lr.round_id and is_active = true) then
    raise exception 'This round has been deleted and can no longer record tournament scores';
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
