-- Soft-remove tournament participants without deleting historical league_rounds.
-- Stroke Play roster edit: removed players keep standings credit for rounds already
-- applied; they stop appearing in Log a Round "Active Tournaments" eligibility.

alter table public.league_entries
  add column if not exists removed_at timestamptz null;

comment on column public.league_entries.removed_at is
  'When set, player is off the active roster (cannot apply new rounds) but prior league_rounds still count in standings.';

create index if not exists league_entries_league_active_idx
  on public.league_entries (league_id)
  where removed_at is null;
