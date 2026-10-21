-- SQL helper for the reddit/email daily acquisition email.
-- Trailing N days; full outer join of get redirects + Android signups + iOS ASC downloads.

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
      channel,
      count(*)::bigint as get_redirects
    from public.get_visits
    where channel in ('reddit', 'email')
      and created_at >= (timezone('utc', now())::date - p_days)
    group by 1, 2
  ),
  android_signups as (
    select
      d.day,
      d.channel,
      d.signups as android_signups,
      d.first_rounds_posted
    from public.channel_acquisition_daily d
    where d.channel in ('reddit', 'email')
      and d.signup_platform = 'android'
      and d.day >= (timezone('utc', now())::date - p_days)
  ),
  ios_dl as (
    select
      d.date as day,
      d.campaign_token as channel,
      d.downloads::bigint as ios_downloads
    from public.ios_campaign_downloads d
    where d.campaign_token in ('reddit', 'email')
      and d.date >= (timezone('utc', now())::date - p_days)
  )
  select
    coalesce(r.day, a.day, i.day) as day,
    coalesce(r.channel, a.channel, i.channel) as channel,
    r.get_redirects,
    a.android_signups,
    a.first_rounds_posted,
    i.ios_downloads
  from redirects r
  full outer join android_signups a
    on a.day = r.day and a.channel = r.channel
  full outer join ios_dl i
    on i.day = coalesce(r.day, a.day)
    and i.channel = coalesce(r.channel, a.channel)
  order by 1 desc, 2;
$$;

comment on function public.reddit_email_acquisition_report(integer) is
  'Trailing-N-day reddit/email acquisition table for the scheduled marketing email. '
  'Android signups and iOS downloads are separate non-comparable metrics.';

revoke all on function public.reddit_email_acquisition_report(integer) from public, anon, authenticated;
grant execute on function public.reddit_email_acquisition_report(integer) to service_role;
