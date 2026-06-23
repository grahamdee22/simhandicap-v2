-- Tournaments: broadcast league row changes to subscribed clients (create, status updates).

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leagues'
  ) then
    alter publication supabase_realtime add table public.leagues;
  end if;
end $$;
