-- League / tournament management inside social groups.

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.social_groups (id) on delete cascade,
  name text not null,
  format text not null check (format in ('stroke', 'match_play', 'scramble', 'best_ball')),
  scoring_method text not null default 'stroke',
  start_date date not null,
  end_date date not null,
  rounds_that_count integer not null default 4 check (rounds_that_count between 1 and 10),
  use_handicap boolean not null default true,
  created_by uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leagues_date_range check (end_date >= start_date)
);

create index if not exists leagues_group_id_status_idx on public.leagues (group_id, status, end_date desc);

create table if not exists public.league_teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists league_teams_league_id_idx on public.league_teams (league_id);

create table if not exists public.league_team_members (
  id uuid primary key default gen_random_uuid(),
  league_team_id uuid not null references public.league_teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  unique (league_team_id, user_id)
);

create index if not exists league_team_members_user_id_idx on public.league_team_members (user_id);

create table if not exists public.league_entries (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  league_team_id uuid references public.league_teams (id) on delete set null,
  rounds_played integer not null default 0,
  points numeric not null default 0,
  net_score numeric,
  position integer,
  unique (league_id, user_id)
);

create index if not exists league_entries_league_id_idx on public.league_entries (league_id);

create table if not exists public.league_rounds (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  league_team_id uuid references public.league_teams (id) on delete set null,
  round_id uuid not null references public.rounds (id) on delete cascade,
  gross_score integer not null,
  net_score numeric not null,
  counted boolean not null default true,
  created_at timestamptz not null default now(),
  unique (league_id, round_id)
);

create index if not exists league_rounds_league_user_idx on public.league_rounds (league_id, user_id);

alter table public.leagues enable row level security;
alter table public.league_teams enable row level security;
alter table public.league_team_members enable row level security;
alter table public.league_entries enable row level security;
alter table public.league_rounds enable row level security;

-- Group members can read leagues for their crews.
create policy "leagues_select_group_member"
  on public.leagues for select
  using (
    exists (
      select 1 from public.group_members gm
      where gm.group_id = leagues.group_id and gm.user_id = auth.uid()
    )
  );

create policy "leagues_insert_group_creator"
  on public.leagues for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.social_groups g
      where g.id = leagues.group_id and g.created_by = auth.uid()
    )
  );

create policy "leagues_update_group_creator"
  on public.leagues for update
  using (
    exists (
      select 1 from public.social_groups g
      where g.id = leagues.group_id and g.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.social_groups g
      where g.id = leagues.group_id and g.created_by = auth.uid()
    )
  );

create policy "leagues_delete_group_creator"
  on public.leagues for delete
  using (
    exists (
      select 1 from public.social_groups g
      where g.id = leagues.group_id and g.created_by = auth.uid()
    )
  );

-- league_teams
create policy "league_teams_select_member"
  on public.league_teams for select
  using (
    exists (
      select 1
      from public.leagues l
      inner join public.group_members gm on gm.group_id = l.group_id
      where l.id = league_teams.league_id and gm.user_id = auth.uid()
    )
  );

create policy "league_teams_mutate_creator"
  on public.league_teams for all
  using (
    exists (
      select 1
      from public.leagues l
      inner join public.social_groups g on g.id = l.group_id
      where l.id = league_teams.league_id and g.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.leagues l
      inner join public.social_groups g on g.id = l.group_id
      where l.id = league_teams.league_id and g.created_by = auth.uid()
    )
  );

-- league_team_members
create policy "league_team_members_select_member"
  on public.league_team_members for select
  using (
    exists (
      select 1
      from public.league_teams t
      inner join public.leagues l on l.id = t.league_id
      inner join public.group_members gm on gm.group_id = l.group_id
      where t.id = league_team_members.league_team_id and gm.user_id = auth.uid()
    )
  );

create policy "league_team_members_mutate_creator"
  on public.league_team_members for all
  using (
    exists (
      select 1
      from public.league_teams t
      inner join public.leagues l on l.id = t.league_id
      inner join public.social_groups g on g.id = l.group_id
      where t.id = league_team_members.league_team_id and g.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.league_teams t
      inner join public.leagues l on l.id = t.league_id
      inner join public.social_groups g on g.id = l.group_id
      where t.id = league_team_members.league_team_id and g.created_by = auth.uid()
    )
  );

-- league_entries
create policy "league_entries_select_member"
  on public.league_entries for select
  using (
    exists (
      select 1
      from public.leagues l
      inner join public.group_members gm on gm.group_id = l.group_id
      where l.id = league_entries.league_id and gm.user_id = auth.uid()
    )
  );

create policy "league_entries_insert_creator"
  on public.league_entries for insert
  with check (
    exists (
      select 1
      from public.leagues l
      inner join public.social_groups g on g.id = l.group_id
      where l.id = league_entries.league_id and g.created_by = auth.uid()
    )
  );

create policy "league_entries_update_creator"
  on public.league_entries for update
  using (
    exists (
      select 1
      from public.leagues l
      inner join public.social_groups g on g.id = l.group_id
      where l.id = league_entries.league_id and g.created_by = auth.uid()
    )
  );

-- league_rounds
create policy "league_rounds_select_member"
  on public.league_rounds for select
  using (
    exists (
      select 1
      from public.leagues l
      inner join public.group_members gm on gm.group_id = l.group_id
      where l.id = league_rounds.league_id and gm.user_id = auth.uid()
    )
  );

create policy "league_rounds_insert_own"
  on public.league_rounds for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.leagues l
      inner join public.group_members gm on gm.group_id = l.group_id
      where l.id = league_rounds.league_id
        and gm.user_id = auth.uid()
        and l.status = 'active'
        and current_date between l.start_date and l.end_date
    )
  );

grant select, insert, update, delete on table public.leagues to authenticated;
grant select, insert, update, delete on table public.leagues to service_role;
grant select, insert, update, delete on table public.league_teams to authenticated;
grant select, insert, update, delete on table public.league_teams to service_role;
grant select, insert, update, delete on table public.league_team_members to authenticated;
grant select, insert, update, delete on table public.league_team_members to service_role;
grant select, insert, update, delete on table public.league_entries to authenticated;
grant select, insert, update, delete on table public.league_entries to service_role;
grant select, insert, update, delete on table public.league_rounds to authenticated;
grant select, insert, update, delete on table public.league_rounds to service_role;
