-- Per-channel link attribution: iOS ASC download buckets + Android install-referrer events + reporting view.
-- iOS downloads are a separate privacy-bucketed count (not a per-user join to signups).
-- Android referrer feeds existing profiles.referral_code via pendingReferralCode (null-only).

-- ---------------------------------------------------------------------------
-- iOS: App Store Connect Analytics campaign download sync (service-role only)
-- ---------------------------------------------------------------------------
create table if not exists public.ios_campaign_downloads (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  campaign_token text not null,
  downloads integer not null default 0 check (downloads >= 0),
  product_page_views integer null check (product_page_views is null or product_page_views >= 0),
  synced_at timestamptz not null default now(),
  unique (date, campaign_token)
);

comment on table public.ios_campaign_downloads is
  'Daily iOS App Store campaign download totals synced from ASC Analytics Reports API. '
  'Bucketed counts (privacy threshold), NOT a per-user join to profiles.';

comment on column public.ios_campaign_downloads.campaign_token is
  'App Store campaign ct= token; same lowercase label as Android utm_source / profiles.referral_code.';

create index if not exists ios_campaign_downloads_token_date_idx
  on public.ios_campaign_downloads (campaign_token, date desc);

alter table public.ios_campaign_downloads enable row level security;
-- No client policies: only service_role (edge sync) reads/writes.

-- ---------------------------------------------------------------------------
-- Android: first-open install referrer log (append-only; not gated on signup)
-- ---------------------------------------------------------------------------
create table if not exists public.android_install_referrer_events (
  id uuid primary key default gen_random_uuid(),
  referrer_raw text not null,
  parsed_channel text null,
  platform text not null default 'android' check (platform = 'android'),
  received_at timestamptz not null default now()
);

comment on table public.android_install_referrer_events is
  'One row per Android first-open where Play Install Referrer returned a value. '
  'Independent of whether the user completes signup — use for install counts.';

comment on column public.android_install_referrer_events.parsed_channel is
  'utm_source from the referrer string, normalized (trim+lower). Null if absent/unparseable.';

create index if not exists android_install_referrer_events_channel_idx
  on public.android_install_referrer_events (parsed_channel)
  where parsed_channel is not null;

create index if not exists android_install_referrer_events_received_at_idx
  on public.android_install_referrer_events (received_at desc);

alter table public.android_install_referrer_events enable row level security;

-- First-open may happen before auth; allow anon/authenticated insert only.
create policy "android_install_referrer_events_insert"
  on public.android_install_referrer_events
  for insert
  to anon, authenticated
  with check (true);

-- No select/update/delete for clients (reporting via service_role / SQL editor).

-- ---------------------------------------------------------------------------
-- Reporting view: per-channel side-by-side buckets
-- ---------------------------------------------------------------------------
create or replace view public.channel_attribution_report
with (security_invoker = true)
as
with channels as (
  select distinct lower(trim(campaign_token)) as channel
  from public.ios_campaign_downloads
  where nullif(trim(campaign_token), '') is not null
  union
  select distinct lower(trim(parsed_channel))
  from public.android_install_referrer_events
  where nullif(trim(parsed_channel), '') is not null
  union
  select distinct lower(trim(referral_code))
  from public.profiles
  where nullif(trim(referral_code), '') is not null
)
select
  c.channel,
  -- DISTINCT COLUMN: ASC privacy bucket — do NOT treat as a join to signups.
  coalesce(
    (
      select sum(d.downloads)::bigint
      from public.ios_campaign_downloads d
      where lower(trim(d.campaign_token)) = c.channel
    ),
    0
  ) as ios_downloads_asc_bucket_not_a_user_join,
  coalesce(
    (
      select count(*)::bigint
      from public.android_install_referrer_events e
      where e.parsed_channel is not null
        and lower(trim(e.parsed_channel)) = c.channel
    ),
    0
  ) as android_installs,
  coalesce(
    (
      select count(*)::bigint
      from public.profiles p
      where p.referral_code is not null
        and lower(trim(p.referral_code)) = c.channel
        and coalesce(p.is_test, false) = false
    ),
    0
  ) as signups,
  coalesce(
    (
      select count(*)::bigint
      from public.rounds r
      inner join public.profiles p on p.id = r.user_id
      where p.referral_code is not null
        and lower(trim(p.referral_code)) = c.channel
        and coalesce(p.is_test, false) = false
        and coalesce(r.is_active, true) = true
    ),
    0
  ) as rounds_posted
from channels c
order by c.channel;

comment on view public.channel_attribution_report is
  'Per-channel attribution. Column ios_downloads_asc_bucket_not_a_user_join is an App Store '
  'Analytics privacy bucket synced from ASC — NOT a per-user join. android_installs / signups / '
  'rounds_posted are real counts (Android referrer events + profiles.referral_code).';

revoke all on public.channel_attribution_report from anon, authenticated;
grant select on public.channel_attribution_report to service_role;
