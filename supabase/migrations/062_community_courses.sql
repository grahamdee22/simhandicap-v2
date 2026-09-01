-- Bulk-imported GSPro community courses (additive; COURSE_SEEDS unchanged).

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalized text not null,
  location text,
  designer text,
  source text not null default 'community' check (source = 'community'),
  confident boolean not null default false,
  gspro_difficulty numeric,
  enrichment_tier smallint check (enrichment_tier between 1 and 4),
  enrichment_source text,
  enrichment_at timestamptz,
  created_at timestamptz not null default now(),
  constraint courses_name_normalized_unique unique (name_normalized)
);

create index if not exists courses_source_idx on public.courses (source);

create table if not exists public.course_tees (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  name text not null,
  rating numeric not null,
  slope numeric not null,
  yards integer,
  created_at timestamptz not null default now(),
  constraint course_tees_course_name_unique unique (course_id, name)
);

create index if not exists course_tees_course_id_idx on public.course_tees (course_id);

alter table public.rounds
  add column if not exists handicap_source text not null default 'verified'
    check (handicap_source in ('verified', 'unverified'));

comment on column public.rounds.handicap_source is
  'Snapshot at round creation: verified (curated/confident) vs unverified (community estimate).';

alter table public.social_groups
  add column if not exists expanded_course_list_enabled boolean not null default false;

comment on column public.social_groups.expanded_course_list_enabled is
  'When true, group members see bulk-imported community courses in standalone Log a Round.';

-- Read-only for signed-in users (import/enrich scripts use service role).
alter table public.courses enable row level security;
alter table public.course_tees enable row level security;

drop policy if exists "courses_select_authenticated" on public.courses;
create policy "courses_select_authenticated"
  on public.courses for select
  to authenticated
  using (true);

drop policy if exists "course_tees_select_authenticated" on public.course_tees;
create policy "course_tees_select_authenticated"
  on public.course_tees for select
  to authenticated
  using (true);

-- Marcus pilot (NZ): flip once his group exists in production.
-- update public.social_groups
-- set expanded_course_list_enabled = true
-- where name ilike '%marcus%' or id = '<group-uuid>';
