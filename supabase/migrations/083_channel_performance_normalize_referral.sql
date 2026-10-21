-- Normalize profiles.referral_code in channel_performance the same way as
-- android_opens: only kevin/reddit/email/homepage stay; everything else → none.
-- Prevents junk/typo typed codes from creating stray channel buckets.

drop view if exists public.channel_performance;

create view public.channel_performance
with (security_invoker = true)
as
with known_channels as (
  select unnest(array['kevin', 'reddit', 'email', 'homepage', 'none']) as channel
),
-- Map stored referral_code → reporting channel (known labels only).
profile_channel_norm as (
  select
    case
      when lower(trim(pr.referral_code)) in ('kevin', 'reddit', 'email', 'homepage')
        then lower(trim(pr.referral_code))
      else 'none'
    end as channel,
    pr.signup_platform,
    pr.referral_source,
    pr.id as profile_id,
    pr.is_test
  from public.profiles pr
),
download_channels as (
  select distinct lower(trim(campaign_token)) as channel
  from public.ios_campaign_downloads
  where nullif(trim(campaign_token), '') is not null
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
  'plus store rows with ios_downloads and android_opens. '
  'profiles.referral_code and android parsed_channel normalize to kevin/reddit/email/homepage or none.';

revoke all on public.channel_performance from anon, authenticated;
grant select on public.channel_performance to service_role;
