-- Optional side games on group tournaments (Skins / Nassau / Stableford).
-- Additive only — does not change core tournament scoring.

alter table public.leagues
  add column if not exists side_games jsonb not null default '{}'::jsonb;

comment on column public.leagues.side_games is
  'Enabled side games, e.g. {"skins":true,"nassau":true,"stableford":true}. Empty object = none.';
