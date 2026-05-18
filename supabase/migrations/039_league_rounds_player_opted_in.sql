-- Player must opt in when logging a round; legacy auto-applied rows are excluded from standings.

alter table public.league_rounds
  add column if not exists player_opted_in boolean not null default false;

comment on column public.league_rounds.player_opted_in is
  'True when the player explicitly applied this round to the tournament at log time.';

-- Exclude rounds that were auto-applied before opt-in existed.
update public.league_rounds
set player_opted_in = false
where player_opted_in is distinct from true;
