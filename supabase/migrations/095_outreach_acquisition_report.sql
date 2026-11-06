-- Outreach acquisition email: one reddit+email row per day, and app-wide iOS downloads
-- from ios_downloads_by_source (not the still-empty campaign-token table).

create or replace function public.reddit_email_acquisition_report(p_days integer default 14)
returns table (
  day date,
  channel text,
  get_redirects bigint,
  android_signups bigint,
  first_rounds_posted bigint,
  ios_downloads bigint
)
language sql
stable
security definer
set search_path = public
as $$
  -- security definer: channel_acquisition_daily joins auth.users; service_role RPC needs this.

  with redirects as (
    select
      (date_trunc('day', created_at at time zone 'utc'))::date as day,
      count(*)::bigint as get_redirects
    from public.get_visits
    where channel in ('reddit', 'email')
      and created_at >= (timezone('utc', now())::date - p_days)
    group by 1
  ),
  android_signups as (
    select
      d.day,
      sum(d.signups)::bigint as android_signups,
      sum(d.first_rounds_posted)::bigint as first_rounds_posted
    from public.channel_acquisition_daily d
    where d.channel in ('reddit', 'email')
      and d.signup_platform = 'android'
      and d.day >= (timezone('utc', now())::date - p_days)
    group by 1
  ),
  -- App-wide first-time downloads. Not filtered by source: Apple does not attribute these to reddit/email.
  ios_dl as (
    select
      d.date as day,
      sum(d.downloads)::bigint as ios_downloads
    from public.ios_downloads_by_source d
    where d.date >= (timezone('utc', now())::date - p_days)
    group by 1
  )
  select
    coalesce(r.day, a.day, i.day) as day,
    'outreach'::text as channel,
    r.get_redirects,
    a.android_signups,
    a.first_rounds_posted,
    i.ios_downloads
  from redirects r
  full outer join android_signups a on a.day = r.day
  full outer join ios_dl i on i.day = coalesce(r.day, a.day)
  order by 1 desc;
$$;

comment on function public.reddit_email_acquisition_report(integer) is
  'Trailing-N-day outreach acquisition table for the scheduled marketing email. '
  'Reddit and email are summed into one row per day. '
  'Android signups are per-user and channel-attributed. '
  'ios_downloads is the app-wide first-time App Store total that day, not outreach-attributed.';
