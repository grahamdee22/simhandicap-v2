-- Stop double-counted Android install logs from inflating download totals.
-- installation_id is null on the original rows. is_duplicate flags the later
-- row of each seconds-apart identical pair without deleting the audit trail.

alter table public.android_install_referrer_events
  add column if not exists installation_id text,
  add column if not exists is_duplicate boolean not null default false;

comment on column public.android_install_referrer_events.installation_id is
  'Stable id generated on first launch and stored on the device. A repeat log for the same install conflicts and is ignored.';

comment on column public.android_install_referrer_events.is_duplicate is
  'True for a second log of the same install. Reporting counts rows where this is false.';

create unique index if not exists android_install_referrer_events_installation_id_uidx
  on public.android_install_referrer_events (installation_id)
  where installation_id is not null;

-- Later row of each pair identified in the Nov 2026 audit.
update public.android_install_referrer_events
set is_duplicate = true
where id in (
  '0dd3a91e-1d75-4073-aa22-c07aa54a5670',
  'f117f348-c1ae-49cf-b190-f599e976aeb0',
  'c0633c92-b132-43d0-b0a9-339013bbb3e8'
);

-- Partial unique index needs the WHERE predicate in ON CONFLICT, which PostgREST
-- does not send. This function is the insert path for new app builds.
create or replace function public.insert_android_install_referrer_event(
  p_referrer_raw text,
  p_parsed_channel text,
  p_installation_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(p_referrer_raw), '') is null then
    return;
  end if;
  if nullif(trim(p_installation_id), '') is null then
    return;
  end if;

  insert into public.android_install_referrer_events (
    referrer_raw,
    parsed_channel,
    platform,
    installation_id
  ) values (
    left(trim(p_referrer_raw), 4000),
    nullif(left(trim(coalesce(p_parsed_channel, '')), 200), ''),
    'android',
    left(trim(p_installation_id), 200)
  )
  on conflict (installation_id) where installation_id is not null do nothing;
end;
$$;

revoke all on function public.insert_android_install_referrer_event(text, text, text) from public, anon, authenticated;
grant execute on function public.insert_android_install_referrer_event(text, text, text) to anon, authenticated;

-- Return type gains android_downloads and total_downloads.
drop function if exists public.reddit_email_acquisition_report(integer);

create function public.reddit_email_acquisition_report(p_days integer default 14)
returns table (
  day date,
  channel text,
  get_redirects bigint,
  android_signups bigint,
  first_rounds_posted bigint,
  android_downloads bigint,
  ios_downloads bigint,
  total_downloads bigint
)
language sql
stable
security definer
set search_path = public
as $$
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
  android_dl as (
    select
      (e.received_at at time zone 'utc')::date as day,
      count(*)::bigint as android_downloads
    from public.android_install_referrer_events e
    where e.is_duplicate = false
      and e.received_at >= (timezone('utc', now())::date - p_days)
    group by 1
  ),
  ios_dl as (
    select
      d.date as day,
      sum(d.downloads)::bigint as ios_downloads
    from public.ios_downloads_by_source d
    where d.date >= (timezone('utc', now())::date - p_days)
    group by 1
  )
  select
    coalesce(r.day, a.day, ad.day, i.day) as day,
    'outreach'::text as channel,
    r.get_redirects,
    a.android_signups,
    a.first_rounds_posted,
    ad.android_downloads,
    i.ios_downloads,
    case
      when ad.android_downloads is null and i.ios_downloads is null then null
      else coalesce(ad.android_downloads, 0) + coalesce(i.ios_downloads, 0)
    end as total_downloads
  from redirects r
  full outer join android_signups a on a.day = r.day
  full outer join android_dl ad on ad.day = coalesce(r.day, a.day)
  full outer join ios_dl i on i.day = coalesce(r.day, a.day, ad.day)
  order by 1 desc;
$$;

comment on function public.reddit_email_acquisition_report(integer) is
  'Trailing-N-day outreach acquisition table for the scheduled marketing email. '
  'Reddit and email are summed into one row per day. '
  'Android signups are per-user and channel-attributed. '
  'android_downloads counts non-duplicate install-referrer events across every channel. '
  'ios_downloads is the app-wide first-time App Store total. '
  'total_downloads sums those two, treating a missing side as zero.';

revoke all on function public.reddit_email_acquisition_report(integer) from public, anon, authenticated;
grant execute on function public.reddit_email_acquisition_report(integer) to service_role;

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
  where is_duplicate = false
    and nullif(trim(parsed_channel), '') is not null
  union
  select distinct lower(trim(referral_code))
  from public.profiles
  where nullif(trim(referral_code), '') is not null
)
select
  c.channel,
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
      where e.is_duplicate = false
        and e.parsed_channel is not null
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
  'Per-channel attribution. android_installs excludes rows flagged is_duplicate.';

revoke all on public.channel_attribution_report from anon, authenticated;
grant select on public.channel_attribution_report to service_role;

-- Keep the lifetime android_opens count on the same filter without rewriting the rest of the view.
do $body$
declare
  def text;
  needle text := E'FROM android_install_referrer_events e\n';
begin
  def := pg_get_viewdef('public.channel_performance'::regclass, true);
  if position('is_duplicate' in def) > 0 then
    return;
  end if;
  if position(needle in def) = 0 then
    raise exception 'channel_performance view text did not contain the expected referrer FROM clause';
  end if;
  def := replace(
    def,
    needle,
    E'FROM android_install_referrer_events e\n         WHERE e.is_duplicate = false\n'
  );
  execute 'create or replace view public.channel_performance with (security_invoker = true) as ' || def;
end
$body$;
