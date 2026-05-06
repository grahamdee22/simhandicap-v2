-- Optional metadata on match rows for Social open-feed filtering (poster snapshot at post time).
alter table public.matches
  add column if not exists player_1_ghin_index_at_post double precision,
  add column if not exists player_1_platform text;

comment on column public.matches.player_1_ghin_index_at_post is
  'Challenger handicap index snapshot when the row was created (open-feed handicap filter).';
comment on column public.matches.player_1_platform is
  'Challenger sim platform id when the row was created (e.g. GSPro, Trackman).';
