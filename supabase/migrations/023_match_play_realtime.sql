-- Match Play: broadcast row changes to subscribed clients (hole scores, match status, etc.).
-- Mirrors migration 005 (group_members / group_pending_invites).

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table public.matches;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'match_holes'
  ) then
    alter publication supabase_realtime add table public.match_holes;
  end if;
end $$;
