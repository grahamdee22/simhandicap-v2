-- Seasons group sequential tournaments and award place points. Additive:
-- leagues.season_id stays null for every existing tournament.

create table if not exists public.league_seasons (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.social_groups (id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date null,
  events_that_count integer null check (events_that_count is null or events_that_count between 1 and 52),
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint league_seasons_date_range check (end_date is null or end_date >= start_date)
);

create index if not exists league_seasons_group_id_idx
  on public.league_seasons (group_id, status, created_at desc);

create unique index if not exists league_seasons_one_active_per_group
  on public.league_seasons (group_id)
  where status = 'active';

alter table public.leagues
  add column if not exists season_id uuid null references public.league_seasons (id) on delete set null;

create index if not exists leagues_season_id_idx on public.leagues (season_id);

alter table public.league_seasons enable row level security;

drop policy if exists "league_seasons_select_member" on public.league_seasons;
create policy "league_seasons_select_member"
  on public.league_seasons for select
  using (public.user_is_social_group_member(group_id));

drop policy if exists "league_seasons_insert_manager" on public.league_seasons;
create policy "league_seasons_insert_manager"
  on public.league_seasons for insert
  with check (
    created_by = auth.uid()
    and public.user_can_manage_social_group(group_id)
  );

drop policy if exists "league_seasons_update_manager" on public.league_seasons;
create policy "league_seasons_update_manager"
  on public.league_seasons for update
  using (public.user_can_manage_social_group(group_id))
  with check (public.user_can_manage_social_group(group_id));

grant select, insert, update on table public.league_seasons to authenticated;
grant select, insert, update, delete on table public.league_seasons to service_role;
