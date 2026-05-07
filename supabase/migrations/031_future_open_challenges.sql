-- Future Open Challenges: scheduling + lifecycle status + server-side status transitions.

alter table public.matches
  add column if not exists scheduled_for timestamptz null,
  add column if not exists challenge_status text null
    check (challenge_status in ('scheduled', 'awaiting_photo', 'active', 'expired'));

comment on column public.matches.scheduled_for is
  'When an open challenge is scheduled to go live (Future Open Challenge), nullable otherwise.';
comment on column public.matches.challenge_status is
  'Open challenge lifecycle state: scheduled | awaiting_photo | active | expired.';

create index if not exists matches_open_challenge_status_idx
  on public.matches (challenge_status, scheduled_for)
  where is_open = true and status = 'open';

-- Legacy open rows and newly-posted regular opens should read as active when null.
update public.matches
set challenge_status = 'active'
where is_open = true
  and status = 'open'
  and challenge_status is null;

-- Open-feed visibility should include only active and scheduled rows.
drop policy if exists "matches_select_open_feed" on public.matches;
create policy "matches_select_open_feed"
  on public.matches for select
  using (
    is_open = true
    and status = 'open'
    and coalesce(challenge_status, 'active') in ('active', 'scheduled')
  );

-- Due scheduler:
-- - scheduled -> awaiting_photo when scheduled_for <= now()
-- - awaiting_photo -> expired when 2h pass without photo
create or replace function public.process_future_open_challenges()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  activated_count int := 0;
  expired_count int := 0;
  purged_count int := 0;
  ready_for_uid int := 0;
begin
  with due as (
    update public.matches
    set challenge_status = 'awaiting_photo'
    where is_open = true
      and status = 'open'
      and challenge_status = 'scheduled'
      and scheduled_for is not null
      and scheduled_for <= now()
    returning player_1_id
  )
  select count(*), count(*) filter (where player_1_id = uid)
    into activated_count, ready_for_uid
  from due;

  with expired as (
    update public.matches
    set challenge_status = 'expired'
    where is_open = true
      and status = 'open'
      and challenge_status = 'awaiting_photo'
      and scheduled_for is not null
      and scheduled_for <= now() - interval '2 hours'
    returning id
  )
  select count(*) into expired_count from expired;

  with purged as (
    delete from public.matches
    where is_open = true
      and status = 'open'
      and challenge_status = 'expired'
      and scheduled_for is not null
      and scheduled_for <= now() - interval '1 day'
    returning id
  )
  select count(*) into purged_count from purged;

  return jsonb_build_object(
    'ok', true,
    'activated_count', activated_count,
    'expired_count', expired_count,
    'purged_count', purged_count,
    'ready_for_uid', ready_for_uid > 0
  );
end;
$$;

comment on function public.process_future_open_challenges() is
  'Promotes due scheduled open challenges to awaiting_photo and expires awaiting_photo rows older than 2 hours.';

revoke all on function public.process_future_open_challenges() from public;
grant execute on function public.process_future_open_challenges() to authenticated;
