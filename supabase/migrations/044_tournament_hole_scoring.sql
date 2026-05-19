-- Tournament hole-by-hole scoring (Match Play, Scramble, Best Ball).
-- Pairing-level match play aggregation: see docs/PHASE4_MATCH_PLAY_PAIRINGS.md (Phase 4).

-- ---------------------------------------------------------------------------
-- League / team configuration
-- ---------------------------------------------------------------------------

alter table public.leagues
  add column if not exists match_play_pairing_method text,
  add column if not exists match_play_matches_that_count integer,
  add column if not exists scramble_handicap_override numeric;

alter table public.leagues
  drop constraint if exists leagues_match_play_pairing_method_check;

alter table public.leagues
  add constraint leagues_match_play_pairing_method_check
  check (
    match_play_pairing_method is null
    or match_play_pairing_method in ('random', 'admin')
  );

alter table public.leagues
  drop constraint if exists leagues_match_play_matches_that_count_check;

alter table public.leagues
  add constraint leagues_match_play_matches_that_count_check
  check (
    match_play_matches_that_count is null
    or match_play_matches_that_count between 1 and 10
  );

comment on column public.leagues.match_play_pairing_method is
  'Match play tournaments only: random draw or admin-assigned pairings (Phase 4 UI).';
comment on column public.leagues.match_play_matches_that_count is
  'Match play tournaments only: how many completed 1v1 matches count toward standings (e.g. best 3 of 5).';
comment on column public.leagues.scramble_handicap_override is
  'Optional admin override for scramble team playing handicap.';

alter table public.league_teams
  add column if not exists designated_scorer_id uuid references public.profiles (id) on delete set null;

comment on column public.league_teams.designated_scorer_id is
  'Scramble only: sole player allowed to log the team round (PRD §6.2).';

-- ---------------------------------------------------------------------------
-- League round hole-entry lifecycle
-- ---------------------------------------------------------------------------

alter table public.league_rounds
  add column if not exists hole_entry_status text not null default 'complete';

alter table public.league_rounds
  drop constraint if exists league_rounds_hole_entry_status_check;

alter table public.league_rounds
  add constraint league_rounds_hole_entry_status_check
  check (hole_entry_status in ('complete', 'pending_holes'));

comment on column public.league_rounds.hole_entry_status is
  'pending_holes: main round saved; tournament hole scorecard not finished. Excluded from standings until complete.';

update public.league_rounds
set hole_entry_status = 'complete'
where hole_entry_status is distinct from 'complete';

create index if not exists league_rounds_pending_holes_idx
  on public.league_rounds (user_id, hole_entry_status)
  where hole_entry_status = 'pending_holes';

-- ---------------------------------------------------------------------------
-- Individual hole scores (all formats)
-- ---------------------------------------------------------------------------

create table if not exists public.tournament_hole_scores (
  id uuid primary key default gen_random_uuid(),
  league_entry_id uuid not null references public.league_entries (id) on delete cascade,
  league_round_id uuid not null references public.league_rounds (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  hole_number integer not null check (hole_number between 1 and 18),
  gross_score integer check (gross_score is null or gross_score between 1 and 20),
  result text check (result is null or result in ('W', 'L', 'H')),
  is_team_score boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_round_id, hole_number),
  constraint tournament_hole_scores_value check (
    gross_score is not null or result is not null
  )
);

create index if not exists tournament_hole_scores_entry_idx
  on public.tournament_hole_scores (league_entry_id);

create index if not exists tournament_hole_scores_user_idx
  on public.tournament_hole_scores (user_id);

comment on table public.tournament_hole_scores is
  'Per-hole tournament scores: gross (stroke/scramble/best ball) or W/L/H (match play).';
comment on column public.tournament_hole_scores.is_team_score is
  'True when this row is the shared team gross for one hole (scramble designated scorer).';

-- ---------------------------------------------------------------------------
-- Resolved team scores per hole (scramble / best ball)
-- ---------------------------------------------------------------------------

create table if not exists public.tournament_team_hole_scores (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  league_team_id uuid not null references public.league_teams (id) on delete cascade,
  round_date date not null,
  hole_number integer not null check (hole_number between 1 and 18),
  team_score integer not null check (team_score between 1 and 20),
  team_net_score numeric,
  is_partial boolean not null default false,
  source_league_round_id uuid references public.league_rounds (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_team_id, round_date, hole_number)
);

create index if not exists tournament_team_hole_scores_league_idx
  on public.tournament_team_hole_scores (league_id, round_date);

comment on table public.tournament_team_hole_scores is
  'Best ball: min player gross/net per hole. Scramble: designated scorer team gross per hole.';
comment on column public.tournament_team_hole_scores.is_partial is
  'True when not all team members have submitted hole scores for this round_date.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.user_is_league_group_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.leagues l
    inner join public.group_members gm on gm.group_id = l.group_id
    where l.id = p_league_id and gm.user_id = auth.uid()
  );
$$;

create or replace function public.league_round_belongs_to_user(p_league_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.league_rounds lr
    where lr.id = p_league_round_id and lr.user_id = auth.uid()
  );
$$;

grant execute on function public.user_is_league_group_member(uuid) to authenticated;
grant execute on function public.league_round_belongs_to_user(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.tournament_hole_scores enable row level security;
alter table public.tournament_team_hole_scores enable row level security;

create policy "tournament_hole_scores_select_member"
  on public.tournament_hole_scores for select
  using (
    exists (
      select 1
      from public.league_rounds lr
      inner join public.leagues l on l.id = lr.league_id
      inner join public.group_members gm on gm.group_id = l.group_id
      where lr.id = tournament_hole_scores.league_round_id
        and gm.user_id = auth.uid()
    )
  );

create policy "tournament_hole_scores_insert_own"
  on public.tournament_hole_scores for insert
  with check (
    user_id = auth.uid()
    and public.league_round_belongs_to_user(league_round_id)
  );

create policy "tournament_hole_scores_update_own"
  on public.tournament_hole_scores for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.league_round_belongs_to_user(league_round_id)
  );

create policy "tournament_hole_scores_delete_own"
  on public.tournament_hole_scores for delete
  using (user_id = auth.uid());

create policy "tournament_team_hole_scores_select_member"
  on public.tournament_team_hole_scores for select
  using (public.user_is_league_group_member(league_id));

-- Writes via service role / edge functions only
create policy "tournament_team_hole_scores_service_write"
  on public.tournament_team_hole_scores for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "league_rounds_update_own"
  on public.league_rounds for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RPC: upsert hole scores + finalize league round
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

    if v_league.format = 'match_play' and v_result is null then
      raise exception 'Match play requires W/L/H per hole';
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

comment on function public.upsert_tournament_hole_scores(uuid, jsonb) is
  'Batch upsert hole scores for the caller’s league round. Sets pending_holes until 18 holes present.';

grant execute on function public.upsert_tournament_hole_scores(uuid, jsonb) to authenticated;

-- List pending hole entry for current user (global banner, MVP 1+)
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
  where lr.user_id = auth.uid()
    and lr.hole_entry_status = 'pending_holes'
    and lr.player_opted_in = true
    and l.format in ('match_play', 'scramble', 'best_ball')
  order by lr.created_at desc;
$$;

grant execute on function public.list_pending_tournament_hole_rounds() to authenticated;

grant select, insert, update, delete on table public.tournament_hole_scores to authenticated;
grant select, insert, update, delete on table public.tournament_hole_scores to service_role;
grant select, insert, update, delete on table public.tournament_team_hole_scores to authenticated;
grant select, insert, update, delete on table public.tournament_team_hole_scores to service_role;
