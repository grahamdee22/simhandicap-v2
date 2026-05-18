-- Optional tournament notes / rules visible to group members.

alter table public.leagues
  add column if not exists notes text;
