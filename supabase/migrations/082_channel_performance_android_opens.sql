-- Add android_opens (install-referrer event counts) to channel_performance,
-- parallel to ios_downloads. Untagged / google-play / unknown → channel 'none'.

drop view if exists public.channel_performance;

create view public.channel_performance
with (security_invoker = true)
as
with known_channels as (
  select unnest(array['kevin', 'reddit', 'email', 'homepage', 'none']) as channel
),
profile_channels as (
  select distinct coalesce(nullif(lower(trim(referral_code)), ''), 'none') as channel
  from public.profiles
  where coalesce(is_test, false) = false
),
download_channels as (
  select distinct lower(trim(campaign_token)) as channel
  from public.ios_campaign_downloads
  where nullif(trim(campaign_token), '') is not null
),
channels as (
  select channel from known_channels
  union
  select channel from profile_channels
  union
  select channel from download_channels
),
platforms as (
  select unnest(array['ios', 'android', 'web', 'unknown']) as signup_platform
),
sources as (
  select unnest(array['link', 'typed', 'unknown']) as referral_source
),
-- Map Play Install Referrer parsed_channel → reporting channel.
-- Known campaign labels stay; organic/google-play/null/other → none.
android_opens_by_channel as (
  select
    case
      when lower(trim(e.parsed_channel)) in ('kevin', 'reddit', 'email', 'homepage')
        then lower(trim(e.parsed_channel))
      else 'none'
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
        from public.profiles pr
        where coalesce(pr.is_test, false) = false
          and coalesce(nullif(lower(trim(pr.referral_code)), ''), 'none') = c.channel
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
        from public.profiles pr
        where coalesce(pr.is_test, false) = false
          and coalesce(nullif(lower(trim(pr.referral_code)), ''), 'none') = c.channel
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
            where r.user_id = pr.id
              and coalesce(r.is_active, true) = true
          )
      ),
      0
    ) as signups_with_rounds,
    coalesce(
      (
        select count(*)::bigint
        from public.rounds r
        inner join public.profiles pr on pr.id = r.user_id
        where coalesce(pr.is_test, false) = false
          and coalesce(r.is_active, true) = true
          and coalesce(nullif(lower(trim(pr.referral_code)), ''), 'none') = c.channel
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
-- Store-side buckets (one row per channel): ASC downloads + Android referrer opens.
store_rows as (
  select
    c.channel,
    null::text as signup_platform,
    null::text as referral_source,
    null::bigint as signups,
    null::bigint as signups_with_rounds,
    null::bigint as total_rounds,
    coalesce(
      (
        select sum(d.downloads)::bigint
        from public.ios_campaign_downloads d
        where lower(trim(d.campaign_token)) = c.channel
      ),
      0
    ) as ios_downloads,
    coalesce(
      (
        select a.android_opens
        from android_opens_by_channel a
        where a.channel = c.channel
      ),
      0
    ) as android_opens
  from channels c
)
select * from signup_rows
union all
select * from store_rows
order by 1, 2 nulls last, 3 nulls last;

comment on view public.channel_performance is
  'Channel performance by signup_platform and referral_source (link/typed/unknown), '
  'plus store rows (platform/source null) with ios_downloads (ASC privacy bucket) and '
  'android_opens (install-referrer events; untagged/google-play → channel none).';

revoke all on public.channel_performance from anon, authenticated;
grant select on public.channel_performance to service_role;
