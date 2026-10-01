-- Live leaderboard: broadcast score and pairing changes for a tournament.
-- Filters use league_id, so UPDATE/DELETE need the full row in the change payload.

alter table public.league_rounds replica identity full;
alter table public.tournament_team_hole_scores replica identity full;
alter table public.league_match_pairings replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'league_rounds'
  ) then
    alter publication supabase_realtime add table public.league_rounds;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tournament_team_hole_scores'
  ) then
    alter publication supabase_realtime add table public.tournament_team_hole_scores;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'league_match_pairings'
  ) then
    alter publication supabase_realtime add table public.league_match_pairings;
  end if;
end $$;
