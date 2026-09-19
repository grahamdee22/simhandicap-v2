-- Durable flag so scramble-only (and similar) rounds stay excluded from SimCap index after sync.
-- App wiring (roundToDbInsert / dbRowToSimRound / index filters) ships in a follow-up client build.

alter table public.rounds
  add column if not exists excludes_from_simcap_index boolean not null default false;

comment on column public.rounds.excludes_from_simcap_index is
  'When true, this round is omitted from SimCap handicap index math (e.g. scramble-only tournament rounds).';

create index if not exists rounds_user_active_index_counting_idx
  on public.rounds (user_id, played_at asc)
  where is_active = true and excludes_from_simcap_index = false;
