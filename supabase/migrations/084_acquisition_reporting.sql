-- Daily acquisition reporting + honest predates_tracking / untracked labels.
-- Additive views only. Does not change tracking URLs or Install Referrer behavior.
--
-- Attribution tracking start (UTC): day channel attribution + signup_platform shipped.
-- Profiles created before this with no known channel → 'predates_tracking'.
-- Profiles created on/after with no known channel → 'untracked' (not "organic").
-- Known channels: kevin, reddit, email, homepage.

drop view if exists public.channel_acquisition_daily;
drop view if exists public.channel_performance;

-- ---------------------------------------------------------------------------
-- Lifetime channel_performance (updated labels; ios_downloads vs android_opens stay separate)
-- ---------------------------------------------------------------------------
create view public.channel_performance
with (security_invoker = true)
as
with known_channels as (
  select unnest(array[
    'kevin', 'reddit', 'email', 'homepage',
    'predates_tracking', 'untracked'
  ]) as channel
),
attribution_started as (
  select timestamptz '2026-10-18 00:00:00+00' as ts
),
profile_channel_norm as (
  select
    case
      when lower(trim(pr.referral_code)) in ('kevin', 'reddit', 'email', 'homepage')
        then lower(trim(pr.referral_code))
      when u.created_at < (select ts from attribution_started)
        then 'predates_tracking'
      else 'untracked'
    end as channel,
    pr.signup_platform,
    pr.referral_source,
    pr.id as profile_id,
    pr.is_test,
    u.created_at as signed_up_at
  from public.profiles pr
  inner join auth.users u on u.id = pr.id
),
download_channels as (
  select distinct lower(trim(campaign_token)) as channel
  from public.ios_campaign_downloads
  where nullif(trim(campaign_token), '') is not null
    and lower(trim(campaign_token)) in ('kevin', 'reddit', 'email', 'homepage')
),
channels as (
  select channel from known_channels
  union
  select distinct channel from profile_channel_norm where coalesce(is_test, false) = false
  union
  select channel from download_channels
),
platforms as (
  select unnest(array['ios', 'android', 'web', 'unknown']) as signup_platform
),
sources as (
  select unnest(array['link', 'typed', 'unknown']) as referral_source
),
-- Android install-referrer opens: known campaign or untracked (never predates_tracking —
-- these are post-instrumentation events).
android_opens_by_channel as (
  select
    case
      when lower(trim(e.parsed_channel)) in ('kevin', 'reddit', 'email', 'homepage')
        then lower(trim(e.parsed_channel))
      else 'untracked'
    end as channel,
    count(*)::bigint as android_opens
  from public.android_install_referrer_events e
  group by 1
),
signup_rows as (
  select
    c.channel,
    p.signup_platform,
    s.referral_source,
    coalesce(
      (
        select count(*)::bigint
        from profile_channel_norm pr
        where coalesce(pr.is_test, false) = false
          and pr.channel = c.channel
          and case
            when pr.signup_platform in ('ios', 'android', 'web') then pr.signup_platform
            else 'unknown'
          end = p.signup_platform
          and case
            when pr.referral_source in ('link', 'typed') then pr.referral_source
            else 'unknown'
          end = s.referral_source
      ),
      0
    ) as signups,
    coalesce(
      (
        select count(*)::bigint
        from profile_channel_norm pr
        where coalesce(pr.is_test, false) = false
          and pr.channel = c.channel
          and case
            when pr.signup_platform in ('ios', 'android', 'web') then pr.signup_platform
            else 'unknown'
          end = p.signup_platform
          and case
            when pr.referral_source in ('link', 'typed') then pr.referral_source
            else 'unknown'
          end = s.referral_source
          and exists (
            select 1
            from public.rounds r
            where r.user_id = pr.profile_id
              and coalesce(r.is_active, true) = true
          )
      ),
      0
    ) as signups_with_rounds,
    coalesce(
      (
        select count(*)::bigint
        from public.rounds r
        inner join profile_channel_norm pr on pr.profile_id = r.user_id
        where coalesce(pr.is_test, false) = false
          and coalesce(r.is_active, true) = true
          and pr.channel = c.channel
          and case
            when pr.signup_platform in ('ios', 'android', 'web') then pr.signup_platform
            else 'unknown'
          end = p.signup_platform
          and case
            when pr.referral_source in ('link', 'typed') then pr.referral_source
            else 'unknown'
          end = s.referral_source
      ),
      0
    ) as total_rounds,
    null::bigint as ios_downloads,
    null::bigint as android_opens
  from channels c
  cross join platforms p
  cross join sources s
),
-- Store-side rows ONLY. Do not blend these with per-user signup counts into a conversion rate.
store_rows as (
  select
    c.channel,
    null::text as signup_platform,
    null::text as referral_source,
    null::bigint as signups,
    null::bigint as signups_with_rounds,
    null::bigint as total_rounds,
    -- iOS ONLY: App Store Connect Analytics privacy bucket (not a per-user join).
    coalesce(
      (
        select sum(d.downloads)::bigint
        from public.ios_campaign_downloads d
        where lower(trim(d.campaign_token)) = c.channel
      ),
      0
    ) as ios_downloads,
    -- Android ONLY: Play Install Referrer event opens (not App Store downloads).
    coalesce(
      (
        select a.android_opens
        from android_opens_by_channel a
        where a.channel = c.channel
      ),
      0
    ) as android_opens
  from channels c
  where c.channel in ('kevin', 'reddit', 'email', 'homepage', 'untracked')
)
select * from signup_rows
union all
select * from store_rows
order by 1, 2 nulls last, 3 nulls last;

comment on view public.channel_performance is
  'Lifetime channel metrics. Signup rows are per-user (channel × platform × source). '
  'Store rows (platform/source null) expose TWO SEPARATE store signals that must not be blended into one CPS: '
  'ios_downloads = App Store Analytics privacy bucket (iOS only); '
  'android_opens = Play Install Referrer events (Android only). '
  'Channels: kevin/reddit/email/homepage, predates_tracking (signed up before 2026-10-18 UTC), '
  'untracked (signed up on/after with no known channel — not "organic").';

revoke all on public.channel_performance from anon, authenticated;
grant select on public.channel_performance to service_role;

-- ---------------------------------------------------------------------------
-- Daily acquisition (per-user only — no iOS ASC / Android referrer blending)
-- ---------------------------------------------------------------------------
create view public.channel_acquisition_daily
with (security_invoker = true)
as
with attribution_started as (
  select timestamptz '2026-10-18 00:00:00+00' as ts
),
profile_norm as (
  select
    pr.id as profile_id,
    case
      when lower(trim(pr.referral_code)) in ('kevin', 'reddit', 'email', 'homepage')
        then lower(trim(pr.referral_code))
      when u.created_at < (select ts from attribution_started)
        then 'predates_tracking'
      else 'untracked'
    end as channel,
    case
      when pr.signup_platform in ('ios', 'android', 'web') then pr.signup_platform
      else 'unknown'
    end as signup_platform,
    (u.created_at at time zone 'utc')::date as signup_day,
    u.created_at as signed_up_at
  from public.profiles pr
  inner join auth.users u on u.id = pr.id
  where coalesce(pr.is_test, false) = false
),
first_round as (
  select
    r.user_id as profile_id,
    min(r.created_at) as first_round_at,
    (min(r.created_at) at time zone 'utc')::date as first_round_day
  from public.rounds r
  where coalesce(r.is_active, true) = true
  group by r.user_id
),
days as (
  select distinct signup_day as day from profile_norm
  union
  select distinct first_round_day from first_round
),
dims as (
  select
    d.day,
    c.channel,
    p.signup_platform
  from days d
  cross join (
    select unnest(array[
      'kevin', 'reddit', 'email', 'homepage',
      'predates_tracking', 'untracked'
    ]) as channel
  ) c
  cross join (
    select unnest(array['ios', 'android', 'web', 'unknown']) as signup_platform
  ) p
)
select
  dims.day,
  dims.channel,
  dims.signup_platform,
  -- Per-user signups on this UTC day (Android/iOS/web from signup_platform — not ASC downloads).
  coalesce(
    (
      select count(*)::bigint
      from profile_norm pr
      where pr.signup_day = dims.day
        and pr.channel = dims.channel
        and pr.signup_platform = dims.signup_platform
    ),
    0
  ) as signups,
  -- Users whose first active round landed on this UTC day (attributed to their signup channel/platform).
  coalesce(
    (
      select count(*)::bigint
      from first_round fr
      inner join profile_norm pr on pr.profile_id = fr.profile_id
      where fr.first_round_day = dims.day
        and pr.channel = dims.channel
        and pr.signup_platform = dims.signup_platform
    ),
    0
  ) as first_rounds_posted
from dims
where
  coalesce(
    (
      select count(*)::bigint
      from profile_norm pr
      where pr.signup_day = dims.day
        and pr.channel = dims.channel
        and pr.signup_platform = dims.signup_platform
    ),
    0
  ) > 0
  or coalesce(
    (
      select count(*)::bigint
      from first_round fr
      inner join profile_norm pr on pr.profile_id = fr.profile_id
      where fr.first_round_day = dims.day
        and pr.channel = dims.channel
        and pr.signup_platform = dims.signup_platform
    ),
    0
  ) > 0
order by dims.day desc, dims.channel, dims.signup_platform;

comment on view public.channel_acquisition_daily is
  'Daily per-user acquisition only (UTC). Columns: signups, first_rounds_posted by channel × signup_platform. '
  'Does NOT include iOS App Store download buckets or Android install-referrer opens — those live on '
  'channel_performance store rows and must not be combined with these counts into a blended conversion rate. '
  'Channels include predates_tracking (before 2026-10-18 UTC) and untracked (on/after, no known channel).';

comment on column public.channel_acquisition_daily.signups is
  'Count of non-test users whose auth.users.created_at falls on this UTC day.';
comment on column public.channel_acquisition_daily.first_rounds_posted is
  'Count of non-test users whose first active round was posted on this UTC day.';
comment on column public.channel_acquisition_daily.signup_platform is
  'Per-user signup_platform (ios/android/web/unknown). Not App Store or Play store aggregate metrics.';

revoke all on public.channel_acquisition_daily from anon, authenticated;
grant select on public.channel_acquisition_daily to service_role;
