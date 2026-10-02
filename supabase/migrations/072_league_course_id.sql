-- New tournaments can require one curated course. Null leaves older tournaments
-- accepting any course, the same as before this column existed.

alter table public.leagues
  add column if not exists course_id text null;

comment on column public.leagues.course_id is
  'Curated course id for this tournament. Null means any course (tournaments created before the lock).';
