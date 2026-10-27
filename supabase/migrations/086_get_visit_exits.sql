-- Store-exit events for sim-cap.com/get (countdown / skip / badge / best-effort abandon).
-- Joins to get_visits via client_visit_id generated in the browser for that page load.

alter table public.get_visits
  add column if not exists client_visit_id uuid null;

comment on column public.get_visits.client_visit_id is
  'Browser-generated UUID for this page load; joins to get_visit_exits.client_visit_id. '
  'Null on rows created before exit tracking shipped.';

create unique index if not exists get_visits_client_visit_id_uidx
  on public.get_visits (client_visit_id)
  where client_visit_id is not null;

-- Recreate insert policy to allow optional client_visit_id (same channel/destination checks).
drop policy if exists "get_visits_insert" on public.get_visits;
create policy "get_visits_insert"
  on public.get_visits
  for insert
  to anon, authenticated
  with check (
    destination in ('ios', 'android', 'desktop')
    and (
      channel is null
      or channel in ('kevin', 'reddit', 'email', 'homepage')
    )
  );

create table if not exists public.get_visit_exits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_visit_id uuid not null,
  channel text null
    check (
      channel is null
      or channel in ('kevin', 'reddit', 'email', 'homepage')
    ),
  path text not null
    check (path in ('auto', 'skip', 'badge', 'abandon')),
  store text null
    check (store is null or store in ('ios', 'android')),
  elapsed_ms integer not null check (elapsed_ms >= 0)
);

comment on table public.get_visit_exits is
  'Exit (or best-effort abandon) after a /get page load. Join to get_visits on client_visit_id. '
  'path=abandon is best-effort via pagehide/visibilitychange and undercounts; do not treat as exact.';

comment on column public.get_visit_exits.path is
  'auto = countdown completed; skip = Continue button; badge = store badge tap; '
  'abandon = left before exit (unreliable / undercounts).';

comment on column public.get_visit_exits.store is
  'ios or android when a store was opened; null for abandon.';

comment on column public.get_visit_exits.elapsed_ms is
  'Milliseconds from page-script start to this exit/abandon event.';

create index if not exists get_visit_exits_client_visit_id_idx
  on public.get_visit_exits (client_visit_id);

create index if not exists get_visit_exits_created_at_idx
  on public.get_visit_exits (created_at desc);

create index if not exists get_visit_exits_path_created_at_idx
  on public.get_visit_exits (path, created_at desc);

alter table public.get_visit_exits enable row level security;

create policy "get_visit_exits_insert"
  on public.get_visit_exits
  for insert
  to anon, authenticated
  with check (
    path in ('auto', 'skip', 'badge', 'abandon')
    and (store is null or store in ('ios', 'android'))
    and elapsed_ms >= 0
    and (
      channel is null
      or channel in ('kevin', 'reddit', 'email', 'homepage')
    )
    and (
      (path = 'abandon' and store is null)
      or (path in ('auto', 'skip', 'badge') and store in ('ios', 'android'))
    )
  );

-- No select/update/delete for clients.
