-- Match play tournament pairings (Phase 4). See docs/PHASE4_MATCH_PLAY_PAIRINGS.md

-- ---------------------------------------------------------------------------
-- Pairing tables
-- ---------------------------------------------------------------------------

create table if not exists public.league_match_pairings (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  player_1_entry_id uuid not null references public.league_entries (id) on delete cascade,
  player_2_entry_id uuid not null references public.league_entries (id) on delete cascade,
  status text not null default 'scheduled' check (
    status in ('scheduled', 'in_progress', 'complete', 'halved')
  ),
  winner_entry_id uuid references public.league_entries (id) on delete set null,
  holes_won_p1 integer not null default 0 check (holes_won_p1 >= 0),
  holes_won_p2 integer not null default 0 check (holes_won_p2 >= 0),
  holes_halved integer not null default 0 check (holes_halved >= 0),
  scheduled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint league_match_pairings_distinct_players check (player_1_entry_id <> player_2_entry_id)
);

create index if not exists league_match_pairings_league_id_idx
  on public.league_match_pairings (league_id, status);

create index if not exists league_match_pairings_p1_idx
  on public.league_match_pairings (player_1_entry_id);

create index if not exists league_match_pairings_p2_idx
  on public.league_match_pairings (player_2_entry_id);

create table if not exists public.league_match_pairing_rounds (
  id uuid primary key default gen_random_uuid(),
  pairing_id uuid not null references public.league_match_pairings (id) on delete cascade,
  league_round_id uuid not null references public.league_rounds (id) on delete cascade,
  submitted_by_entry_id uuid not null references public.league_entries (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (league_round_id)
);

create index if not exists league_match_pairing_rounds_pairing_idx
  on public.league_match_pairing_rounds (pairing_id);

-- Match-play season stats on entries (denormalized for standings UI)
alter table public.league_entries
  add column if not exists mp_wins integer not null default 0,
  add column if not exists mp_losses integer not null default 0,
  add column if not exists mp_halved integer not null default 0;

comment on table public.league_match_pairings is
  '1v1 match play pairings within a match-play tournament (not Social matches).';
comment on column public.league_entries.mp_wins is
  'Match play tournament: completed pairing wins (2 pts each).';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.league_match_pairings enable row level security;
alter table public.league_match_pairing_rounds enable row level security;

create policy "league_match_pairings_select_member"
  on public.league_match_pairings for select
  using (public.user_is_league_group_member(league_id));

create policy "league_match_pairings_mutate_creator"
  on public.league_match_pairings for all
  using (
    exists (
      select 1 from public.leagues l
      inner join public.social_groups g on g.id = l.group_id
      where l.id = league_match_pairings.league_id and g.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.leagues l
      inner join public.social_groups g on g.id = l.group_id
      where l.id = league_match_pairings.league_id and g.created_by = auth.uid()
    )
  );

create policy "league_match_pairing_rounds_select_member"
  on public.league_match_pairing_rounds for select
  using (
    exists (
      select 1 from public.league_match_pairings p
      where p.id = league_match_pairing_rounds.pairing_id
        and public.user_is_league_group_member(p.league_id)
    )
  );

create policy "league_match_pairing_rounds_insert_own"
  on public.league_match_pairing_rounds for insert
  with check (
    exists (
      select 1 from public.league_entries e
      where e.id = league_match_pairing_rounds.submitted_by_entry_id
        and e.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Generate random pairings for a match-play league
-- ---------------------------------------------------------------------------

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

  if not exists (
    select 1 from public.social_groups g
    where g.id = v_league.group_id and g.created_by = v_uid
  ) then
    raise exception 'Only the group creator can generate pairings';
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

grant execute on function public.generate_match_play_pairings(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Apply a completed league round (18 W/L/H holes) to a pairing + update standings
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
  v_is_p1 boolean;
  v_wins int := 0;
  v_losses int := 0;
  v_halved int := 0;
  v_hole record;
  v_p1_wins int;
  v_p2_wins int;
  v_winner uuid;
  v_result text;
  v_pts_p1 int;
  v_pts_p2 int;
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

  v_is_p1 := v_pairing.player_1_entry_id = v_entry.id;

  for v_hole in
    select result from public.tournament_hole_scores
    where league_round_id = p_league_round_id
    order by hole_number
  loop
    if v_hole.result = 'W' then
      v_wins := v_wins + 1;
    elsif v_hole.result = 'L' then
      v_losses := v_losses + 1;
    elsif v_hole.result = 'H' then
      v_halved := v_halved + 1;
    end if;
  end loop;

  if v_wins + v_losses + v_halved < 18 then
    raise exception 'All 18 hole results required';
  end if;

  insert into public.league_match_pairing_rounds (pairing_id, league_round_id, submitted_by_entry_id)
  values (v_pairing.id, p_league_round_id, v_entry.id)
  on conflict (league_round_id) do nothing;

  if v_is_p1 then
    v_p1_wins := v_wins;
    v_p2_wins := v_losses;
  else
    v_p1_wins := v_losses;
    v_p2_wins := v_wins;
  end if;

  update public.league_match_pairings
  set
    status = 'in_progress',
    holes_won_p1 = v_p1_wins,
    holes_won_p2 = v_p2_wins,
    holes_halved = v_halved
  where id = v_pairing.id;

  if v_p1_wins > v_p2_wins then
    v_winner := v_pairing.player_1_entry_id;
    v_result := 'win';
  elsif v_p2_wins > v_p1_wins then
    v_winner := v_pairing.player_2_entry_id;
    v_result := 'win';
  else
    v_winner := null;
    v_result := 'halved';
  end if;

  update public.league_match_pairings
  set
    status = case when v_result = 'halved' then 'halved' else 'complete' end,
    winner_entry_id = v_winner,
    completed_at = now()
  where id = v_pairing.id;

  -- Points: 2 win, 1 halve, 0 loss
  if v_result = 'halved' then
    v_pts_p1 := 1;
    v_pts_p2 := 1;
    update public.league_entries set mp_halved = mp_halved + 1, points = points + 1
      where id = v_pairing.player_1_entry_id;
    update public.league_entries set mp_halved = mp_halved + 1, points = points + 1
      where id = v_pairing.player_2_entry_id;
  elsif v_winner = v_pairing.player_1_entry_id then
    v_pts_p1 := 2;
    v_pts_p2 := 0;
    update public.league_entries set mp_wins = mp_wins + 1, points = points + 2
      where id = v_pairing.player_1_entry_id;
    update public.league_entries set mp_losses = mp_losses + 1
      where id = v_pairing.player_2_entry_id;
  else
    v_pts_p1 := 0;
    v_pts_p2 := 2;
    update public.league_entries set mp_losses = mp_losses + 1
      where id = v_pairing.player_1_entry_id;
    update public.league_entries set mp_wins = mp_wins + 1, points = points + 2
      where id = v_pairing.player_2_entry_id;
  end if;

  return jsonb_build_object(
    'pairing_id', v_pairing.id,
    'status', case when v_result = 'halved' then 'halved' else 'complete' end,
    'winner_entry_id', v_winner,
    'holes_won_p1', v_p1_wins,
    'holes_won_p2', v_p2_wins,
    'holes_halved', v_halved,
    'submitter_net_holes', v_wins - v_losses
  );
end;
$$;

grant execute on function public.apply_match_play_league_round(uuid) to authenticated;

grant select on table public.league_match_pairings to authenticated;
grant select, insert, update, delete on table public.league_match_pairings to service_role;
grant select on table public.league_match_pairing_rounds to authenticated;
grant select, insert, update, delete on table public.league_match_pairing_rounds to service_role;
