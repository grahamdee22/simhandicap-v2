-- Snapshot of sim handicap index at the moment the round was saved (matches home-screen index calc).

alter table public.rounds
  add column if not exists simcap_index_at_time numeric;

comment on column public.rounds.simcap_index_at_time is
  'User sim handicap index (best 8 of 20 × 0.96) immediately before persisting this round; null for legacy rows.';
