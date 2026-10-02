-- Snapshot the course par and stroke index used for team-net math at log time,
-- the same way course_rating and slope are stored on the round.

alter table public.rounds
  add column if not exists course_par integer null;

alter table public.rounds
  add column if not exists stroke_index_by_hole integer[] null;

comment on column public.rounds.course_par is
  'Course par for the holes played, snapshotted at log time. Null on rounds logged before this column.';

comment on column public.rounds.stroke_index_by_hole is
  '18 stroke-index values (1 = hardest), snapshotted at log time. Null when the course has no saved index.';
