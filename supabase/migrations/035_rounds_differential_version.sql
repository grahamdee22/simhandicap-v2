-- Track which handicap differential formula version was used when each round was logged.
-- Historical rounds keep their existing stored differential and are marked as version 1.

alter table public.rounds
  add column if not exists differential_version integer not null default 1;

comment on column public.rounds.differential_version is
  'Version of the handicap differential formula used to compute `differential` for this round.';
