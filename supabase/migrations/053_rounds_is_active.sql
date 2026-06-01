-- Soft-delete for logged sim rounds (hide from index and listings without removing rows).

alter table public.rounds
  add column if not exists is_active boolean not null default true;

comment on column public.rounds.is_active is
  'When false, the round is soft-deleted and excluded from handicap math and listings.';

create index if not exists rounds_user_active_played_at_idx
  on public.rounds (user_id, played_at asc)
  where is_active = true;
