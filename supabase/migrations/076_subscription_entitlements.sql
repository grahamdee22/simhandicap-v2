-- RevenueCat subscription entitlements. Client may select own rows; only the
-- service-role webhook edge function writes. No UI/gating yet.

create table if not exists public.subscription_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entitlement_id text not null default 'pro',
  is_active boolean not null default false,
  product_id text,
  store text,
  period_type text,
  will_renew boolean,
  expires_at timestamptz,
  last_event_type text,
  last_event_at timestamptz,
  raw_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entitlement_id)
);

create index if not exists subscription_entitlements_user_id_idx
  on public.subscription_entitlements (user_id);

alter table public.subscription_entitlements enable row level security;

drop policy if exists "select own entitlements" on public.subscription_entitlements;
create policy "select own entitlements"
  on public.subscription_entitlements for select
  to authenticated
  using (user_id = auth.uid());

grant select on table public.subscription_entitlements to authenticated;
grant select, insert, update, delete on table public.subscription_entitlements to service_role;
