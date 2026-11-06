-- Attribution dashboard sync tables.
-- iOS source totals are filled by the existing ASC job.
-- Play and Reddit tables are filled by their sync functions once secrets exist.

create table if not exists public.ios_downloads_by_source (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  source_type text not null,
  source_info text not null default '',
  downloads integer not null default 0 check (downloads >= 0),
  synced_at timestamptz not null default now(),
  unique (date, source_type, source_info)
);

comment on table public.ios_downloads_by_source is
  'Daily first-time iOS downloads by App Store Source Type (and Source Info when Apple fills it). '
  'Same ASC detailed downloads report as ios_campaign_downloads. Privacy-bucketed, not a per-user join.';

create index if not exists ios_downloads_by_source_date_idx
  on public.ios_downloads_by_source (date desc, source_type);

alter table public.ios_downloads_by_source enable row level security;

create table if not exists public.android_store_acquisitions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  package_name text not null default '',
  traffic_source text not null,
  search_term text not null default '',
  utm_source text not null default '',
  utm_campaign text not null default '',
  store_listing_acquisitions integer not null default 0 check (store_listing_acquisitions >= 0),
  store_listing_visitors integer not null default 0 check (store_listing_visitors >= 0),
  store_listing_conversion_rate numeric null,
  synced_at timestamptz not null default now(),
  unique (date, traffic_source, search_term, utm_source, utm_campaign)
);

comment on table public.android_store_acquisitions is
  'Play Console store_performance traffic_source CSV (bucket export). '
  'Separate from android_install_referrer_events, which remains the per-user path.';

create index if not exists android_store_acquisitions_date_idx
  on public.android_store_acquisitions (date desc, traffic_source);

alter table public.android_store_acquisitions enable row level security;

create table if not exists public.reddit_ads_daily (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  campaign_id text not null,
  impressions integer not null default 0 check (impressions >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  spend_micros bigint not null default 0,
  spend numeric not null default 0,
  ctr numeric null,
  cpc numeric null,
  synced_at timestamptz not null default now(),
  unique (date, campaign_id)
);

comment on table public.reddit_ads_daily is
  'Reddit Ads API daily campaign metrics. spend and cpc are currency units (micro-units / 1e6).';

create index if not exists reddit_ads_daily_date_idx
  on public.reddit_ads_daily (date desc, campaign_id);

alter table public.reddit_ads_daily enable row level security;
