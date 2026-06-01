-- Flag test / seed data so it can be excluded from production metrics and reports.

alter table public.profiles
  add column if not exists is_test boolean not null default false;

alter table public.rounds
  add column if not exists is_test boolean not null default false;

alter table public.social_groups
  add column if not exists is_test boolean not null default false;

alter table public.leagues
  add column if not exists is_test boolean not null default false;

alter table public.league_teams
  add column if not exists is_test boolean not null default false;

alter table public.matches
  add column if not exists is_test boolean not null default false;

alter table public.tournament_hole_scores
  add column if not exists is_test boolean not null default false;

alter table public.tournament_team_hole_scores
  add column if not exists is_test boolean not null default false;

comment on column public.profiles.is_test is
  'When true, row is test/seed data and may be excluded from analytics.';

comment on column public.rounds.is_test is
  'When true, row is test/seed data and may be excluded from analytics.';

comment on column public.social_groups.is_test is
  'When true, row is test/seed data and may be excluded from analytics.';

comment on column public.leagues.is_test is
  'When true, row is test/seed data and may be excluded from analytics.';

comment on column public.league_teams.is_test is
  'When true, row is test/seed data and may be excluded from analytics.';

comment on column public.matches.is_test is
  'When true, row is test/seed data and may be excluded from analytics.';

comment on column public.tournament_hole_scores.is_test is
  'When true, row is test/seed data and may be excluded from analytics.';

comment on column public.tournament_team_hole_scores.is_test is
  'When true, row is test/seed data and may be excluded from analytics.';
