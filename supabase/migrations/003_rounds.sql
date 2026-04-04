-- Logged sim rounds per user (source of truth when signed in).

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id text not null,
  course_name text not null,
  platform text not null,
  gross_score int not null,
  hole_scores jsonb not null default '[]'::jsonb,
  putting_mode text not null,
  pin_placement text not null,
  wind text not null,
  mulligans text not null,
  difficulty_modifier double precision not null,
  -- Adjusted differential (used for handicap index: best 8 of 20 × 0.96).
  differential double precision not null,
  raw_differential double precision,
  course_rating double precision not null,
  slope double precision not null,
  tee_name text,
  played_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Optional head-to-head context (IDs may be local or Supabase UUIDs).
  h2h_group_id text,
  h2h_opponent_member_id text,
  h2h_opponent_display_name text
);

create index if not exists rounds_user_id_played_at_idx on public.rounds (user_id, played_at asc);

alter table public.rounds enable row level security;

create policy "rounds_select_own"
  on public.rounds for select
  using (user_id = auth.uid());

create policy "rounds_insert_own"
  on public.rounds for insert
  with check (user_id = auth.uid());

create policy "rounds_update_own"
  on public.rounds for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "rounds_delete_own"
  on public.rounds for delete
  using (user_id = auth.uid());
