-- Lightweight /get?channel=… visit log for the marketing site redirect.
-- Append-only, no PII. Landing page posts via anon insert; no client SELECT.

create table if not exists public.get_visits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  channel text null
    check (
      channel is null
      or channel in ('kevin', 'reddit', 'email', 'homepage')
    ),
  destination text not null
    check (destination in ('ios', 'android', 'desktop'))
);

comment on table public.get_visits is
  'One row per hit to sim-cap.com/get. Independent of store installs / ad platform reports. '
  'No cookies, device IDs, or IP columns — infra logs may still record IP separately.';

comment on column public.get_visits.channel is
  'Whitelisted channel query param, or null when missing/invalid (still logged).';

comment on column public.get_visits.destination is
  'Observed redirect path: ios / android store, or desktop (dual-badge fallback).';

create index if not exists get_visits_created_at_idx
  on public.get_visits (created_at desc);

create index if not exists get_visits_channel_created_at_idx
  on public.get_visits (channel, created_at desc);

alter table public.get_visits enable row level security;

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

-- No select/update/delete for clients (reporting via service_role / SQL editor).
