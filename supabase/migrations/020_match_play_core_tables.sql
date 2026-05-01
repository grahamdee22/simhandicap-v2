-- Match Play (v1): core tables + profile counters. RLS, storage, and realtime in later migrations.

-- ---------------------------------------------------------------------------
-- profiles: per-user match record (updated when matches complete / forfeit)
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists match_wins integer not null default 0,
  add column if not exists match_losses integer not null default 0,
  add column if not exists match_draws integer not null default 0,
  add column if not exists match_forfeits integer not null default 0;

comment on column public.profiles.match_wins is
  'Completed stroke-play matches won (excludes opponent forfeit wins).';
comment on column public.profiles.match_losses is
  'Completed stroke-play matches lost, plus losses from abandoning a match.';
comment on column public.profiles.match_draws is
  'Completed stroke-play matches tied on net score.';
comment on column public.profiles.match_forfeits is
  'Matches this user abandoned; subset of losses for display.';

-- ---------------------------------------------------------------------------
-- matches: two-player remote stroke-play rounds (direct or open challenge)
-- ---------------------------------------------------------------------------

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  player_1_id uuid not null references public.profiles (id) on delete cascade,
  player_2_id uuid references public.profiles (id) on delete cascade,
  is_open boolean not null,

  course_name text not null,

  player_1_course_rating numeric not null,
  player_1_course_slope integer not null,
  player_1_tee text not null,

  player_2_course_rating numeric,
  player_2_course_slope integer,
  player_2_tee text,

  putting_mode text not null,
  pin_placement text not null,
  wind text not null,
  mulligans text not null,

  format text not null default 'stroke',
  holes integer not null check (holes in (9, 18)),
  nine_selection text,

  status text not null
    check (
      status in (
        'pending',
        'open',
        'active',
        'waiting',
        'complete',
        'abandoned',
        'declined'
      )
    ),

  winner_id uuid references public.profiles (id) on delete set null,
  abandoned_by_id uuid references public.profiles (id) on delete set null,

  player_1_net_score numeric,
  player_2_net_score numeric,

  player_1_finished boolean not null default false,
  player_2_finished boolean not null default false,

  player_1_settings_photo_url text,
  player_2_settings_photo_url text,

  constraint matches_holes_nine_consistency check (
    (holes = 18 and nine_selection is null)
    or (holes = 9 and nine_selection in ('front', 'back'))
  ),
  constraint matches_format_v1_stroke check (format = 'stroke'),
  constraint matches_kind_status check (
    (is_open = true and status in ('open', 'active', 'waiting', 'complete', 'abandoned'))
    or (
      is_open = false
      and status in ('pending', 'active', 'waiting', 'complete', 'abandoned', 'declined')
    )
  )
);

comment on table public.matches is
  'SimCap Match Play v1: two-player stroke-play matches; direct or open challenge.';
comment on column public.matches.player_2_id is
  'Opponent; null until a direct challenge is accepted or an open challenge is claimed.';
comment on column public.matches.is_open is
  'True when posted to the open challenge feed; false for direct group challenges.';
comment on column public.matches.nine_selection is
  'front | back for 9-hole rounds; null for 18 holes.';
comment on column public.matches.status is
  'pending | open | active | waiting | complete | abandoned | declined';

create index if not exists matches_player_1_id_created_at_idx
  on public.matches (player_1_id, created_at desc);

create index if not exists matches_player_2_id_created_at_idx
  on public.matches (player_2_id, created_at desc)
  where player_2_id is not null;

create index if not exists matches_open_feed_idx
  on public.matches (created_at desc)
  where is_open = true and status = 'open';

-- ---------------------------------------------------------------------------
-- match_holes: per-player gross scores per hole (real hole number 1–18)
-- ---------------------------------------------------------------------------

create table if not exists public.match_holes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  player_id uuid not null references public.profiles (id) on delete cascade,
  hole_number integer not null,
  gross_score integer not null,
  created_at timestamptz not null default now(),

  constraint match_holes_hole_number_range check (hole_number >= 1 and hole_number <= 18),
  constraint match_holes_gross_positive check (gross_score >= 1)
);

comment on table public.match_holes is
  'Hole-by-hole gross scores for Match Play; net totals derived in app from tee + index.';

create unique index if not exists match_holes_match_player_hole_uidx
  on public.match_holes (match_id, player_id, hole_number);

create index if not exists match_holes_match_id_idx
  on public.match_holes (match_id);
