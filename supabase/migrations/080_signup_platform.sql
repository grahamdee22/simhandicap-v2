-- Signup platform (ios/android/web) for channel performance reporting.
-- Email/password: written by handle_new_user from raw_user_meta_data.platform.
-- OAuth: client null-only PATCH via pendingSignupPlatform (same pattern as referral_code).

alter table public.profiles
  add column if not exists signup_platform text;

alter table public.profiles
  drop constraint if exists profiles_signup_platform_check;

alter table public.profiles
  add constraint profiles_signup_platform_check
  check (
    signup_platform is null
    or signup_platform in ('ios', 'android', 'web')
  );

comment on column public.profiles.signup_platform is
  'Client platform at account creation: ios | android | web. Null for legacy rows or when unset.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_platform text;
begin
  v_platform := lower(trim(new.raw_user_meta_data ->> 'platform'));
  if v_platform is distinct from 'ios'
     and v_platform is distinct from 'android'
     and v_platform is distinct from 'web' then
    v_platform := null;
  end if;

  insert into public.profiles (id, display_name, referral_code, signup_platform)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1),
      'Golfer'
    ),
    nullif(trim(new.raw_user_meta_data ->> 'referral_code'), ''),
    v_platform
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- channel_performance: one query for channel × platform signup metrics + ASC downloads
-- ---------------------------------------------------------------------------
create or replace view public.channel_performance
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
signup_rows as (
  select
    c.channel,
    p.signup_platform,
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
      ),
      0
    ) as total_rounds,
    null::bigint as ios_downloads
  from channels c
  cross join platforms p
),
download_rows as (
  select
    c.channel,
    null::text as signup_platform,
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
    ) as ios_downloads
  from channels c
  where c.channel is distinct from 'none'
)
select * from signup_rows
union all
select * from download_rows
order by 1, 2 nulls last;

comment on view public.channel_performance is
  'Channel performance by signup_platform (ios/android/web/unknown) plus ASC ios_downloads '
  'rows (signup_platform null). channel=none = organic / null referral_code. '
  'ios_downloads is an App Store privacy bucket — not a per-user join.';

revoke all on public.channel_performance from anon, authenticated;
grant select on public.channel_performance to service_role;
