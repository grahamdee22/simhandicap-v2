-- Group Challenges MVP: cross-group net stroke play (5v5), separate from intra-group leagues.
-- Handicap snapshots and verification are scoped to this feature only.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.group_challenges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  challenging_group_id uuid not null references public.social_groups (id) on delete cascade,
  challenged_group_id uuid not null references public.social_groups (id) on delete cascade,
  status text not null default 'pending'
    check (status in (
      'pending', 'declined', 'accepted', 'active', 'completed', 'canceled', 'disputed'
    )),
  course_id text not null,
  tee_name text,
  holes_per_round text not null default '18' check (holes_per_round in ('18', '9')),
  roster_size int not null default 5 check (roster_size > 0 and roster_size <= 20),
  verification_mode text not null default 'verified'
    check (verification_mode in ('verified', 'casual')),
  start_date date not null,
  end_date date not null,
  accepted_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  winner_group_id uuid references public.social_groups (id) on delete set null,
  created_by uuid not null references auth.users (id) on delete cascade,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_challenges_distinct_groups check (challenging_group_id <> challenged_group_id),
  constraint group_challenges_date_order check (start_date <= end_date)
);

create index if not exists group_challenges_challenging_idx
  on public.group_challenges (challenging_group_id, status);
create index if not exists group_challenges_challenged_idx
  on public.group_challenges (challenged_group_id, status);

comment on table public.group_challenges is
  'Cross-group net stroke challenges (Facility Cup / Group Challenges).';

create table if not exists public.group_challenge_rosters (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.group_challenges (id) on delete cascade,
  group_id uuid not null references public.social_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  handicap_snapshot numeric(5,1),
  handicap_source text check (handicap_source is null or handicap_source in ('simcap', 'ghin')),
  snapshot_context jsonb not null default '{}'::jsonb,
  eligibility_status text not null default 'eligible'
    check (eligibility_status in ('eligible', 'ineligible', 'withdrawn')),
  qualifying_rounds_count int not null default 0,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  unique (challenge_id, user_id),
  unique (challenge_id, group_id, user_id)
);

create index if not exists group_challenge_rosters_challenge_idx
  on public.group_challenge_rosters (challenge_id, group_id);

comment on column public.group_challenge_rosters.handicap_snapshot is
  'Frozen index at challenge activation; competition nets always use this, never live index.';
comment on column public.group_challenge_rosters.snapshot_context is
  'Auditable context (e.g. rounds_counted, source, snapshotted_at).';

create table if not exists public.group_challenge_rounds (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.group_challenges (id) on delete cascade,
  roster_entry_id uuid not null references public.group_challenge_rosters (id) on delete cascade,
  round_id uuid references public.rounds (id) on delete set null,
  gross_score int not null,
  net_score numeric not null,
  course_rating numeric,
  slope int,
  course_par int,
  tee_name text,
  submitted_at timestamptz not null default now(),
  evidence_path text,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected', 'disputed')),
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  verification_notes text,
  disputed_by uuid references auth.users (id) on delete set null,
  disputed_at timestamptz,
  dispute_reason text,
  created_at timestamptz not null default now(),
  unique (challenge_id, roster_entry_id)
);

create index if not exists group_challenge_rounds_challenge_idx
  on public.group_challenge_rounds (challenge_id, verification_status);

comment on table public.group_challenge_rounds is
  'One official challenge round per rostered player; not selected from prior logged rounds.';

create table if not exists public.group_challenge_results (
  challenge_id uuid not null references public.group_challenges (id) on delete cascade,
  group_id uuid not null references public.social_groups (id) on delete cascade,
  total_net numeric not null,
  final_position int not null check (final_position in (1, 2)),
  finalized_at timestamptz not null default now(),
  primary key (challenge_id, group_id)
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.user_is_group_challenge_participant(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_challenges c
    where c.id = p_challenge_id
      and (
        exists (
          select 1 from public.group_members m
          where m.group_id = c.challenging_group_id and m.user_id = auth.uid()
        )
        or exists (
          select 1 from public.group_members m
          where m.group_id = c.challenged_group_id and m.user_id = auth.uid()
        )
      )
  );
$$;

revoke all on function public.user_is_group_challenge_participant(uuid) from public;
grant execute on function public.user_is_group_challenge_participant(uuid) to authenticated;

create or replace function public.user_manages_group_challenge_side(
  p_challenge_id uuid,
  p_group_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_challenges c
    where c.id = p_challenge_id
      and p_group_id in (c.challenging_group_id, c.challenged_group_id)
      and public.user_can_manage_social_group(p_group_id)
  );
$$;

revoke all on function public.user_manages_group_challenge_side(uuid, uuid) from public;
grant execute on function public.user_manages_group_challenge_side(uuid, uuid) to authenticated;

-- Lookup opposing groups by name or UUID (limited public fields). Managers only.
create or replace function public.lookup_groups_for_challenge(p_query text)
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q text := trim(coalesce(p_query, ''));
begin
  if auth.uid() is null then
    return;
  end if;
  if not exists (
    select 1 from public.social_groups g
    where public.user_can_manage_social_group(g.id)
  ) then
    return;
  end if;
  if q = '' then
    return;
  end if;

  if q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return query
      select g.id, g.name
      from public.social_groups g
      where g.id = q::uuid
        and coalesce(g.is_active, true) = true
      limit 1;
    return;
  end if;

  return query
    select g.id, g.name
    from public.social_groups g
    where coalesce(g.is_active, true) = true
      and g.name ilike '%' || q || '%'
    order by
      case when lower(g.name) = lower(q) then 0 else 1 end,
      g.name
    limit 20;
end;
$$;

revoke all on function public.lookup_groups_for_challenge(text) from public;
grant execute on function public.lookup_groups_for_challenge(text) to authenticated;

-- Display names for challenge roster (both sides) without exposing unrelated profiles.
create or replace function public.group_challenge_roster_display_names(p_challenge_id uuid)
returns table (user_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.user_is_group_challenge_participant(p_challenge_id) then
    return;
  end if;
  return query
    select r.user_id,
      coalesce(
        nullif(trim(p.display_name), ''),
        nullif(trim(gm.display_name_snapshot), ''),
        'Player'
      ) as display_name
    from public.group_challenge_rosters r
    left join public.profiles p on p.id = r.user_id
    left join lateral (
      select m.display_name_snapshot
      from public.group_members m
      where m.group_id = r.group_id and m.user_id = r.user_id
      limit 1
    ) gm on true
    where r.challenge_id = p_challenge_id;
end;
$$;

revoke all on function public.group_challenge_roster_display_names(uuid) from public;
grant execute on function public.group_challenge_roster_display_names(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.group_challenges enable row level security;
alter table public.group_challenge_rosters enable row level security;
alter table public.group_challenge_rounds enable row level security;
alter table public.group_challenge_results enable row level security;

grant select, insert, update on table public.group_challenges to authenticated;
grant select, insert, update, delete on table public.group_challenge_rosters to authenticated;
grant select, insert, update on table public.group_challenge_rounds to authenticated;
grant select, insert on table public.group_challenge_results to authenticated;
grant all on table public.group_challenges to service_role;
grant all on table public.group_challenge_rosters to service_role;
grant all on table public.group_challenge_rounds to service_role;
grant all on table public.group_challenge_results to service_role;

create policy "group_challenges_select_participant"
  on public.group_challenges for select
  using (public.user_is_group_challenge_participant(id));

create policy "group_challenges_insert_manager"
  on public.group_challenges for insert
  with check (
    created_by = auth.uid()
    and public.user_can_manage_social_group(challenging_group_id)
    and challenging_group_id <> challenged_group_id
  );

create policy "group_challenges_update_side_manager"
  on public.group_challenges for update
  using (
    public.user_can_manage_social_group(challenging_group_id)
    or public.user_can_manage_social_group(challenged_group_id)
  )
  with check (
    public.user_can_manage_social_group(challenging_group_id)
    or public.user_can_manage_social_group(challenged_group_id)
  );

create policy "group_challenge_rosters_select_participant"
  on public.group_challenge_rosters for select
  using (public.user_is_group_challenge_participant(challenge_id));

create policy "group_challenge_rosters_insert_manager"
  on public.group_challenge_rosters for insert
  with check (
    public.user_manages_group_challenge_side(challenge_id, group_id)
    and exists (
      select 1 from public.group_members m
      where m.group_id = group_challenge_rosters.group_id
        and m.user_id = group_challenge_rosters.user_id
    )
  );

create policy "group_challenge_rosters_update_manager"
  on public.group_challenge_rosters for update
  using (public.user_manages_group_challenge_side(challenge_id, group_id))
  with check (public.user_manages_group_challenge_side(challenge_id, group_id));

create policy "group_challenge_rosters_delete_manager_pre_active"
  on public.group_challenge_rosters for delete
  using (
    public.user_manages_group_challenge_side(challenge_id, group_id)
    and exists (
      select 1 from public.group_challenges c
      where c.id = challenge_id
        and c.status in ('pending', 'accepted')
    )
  );

create policy "group_challenge_rounds_select_participant"
  on public.group_challenge_rounds for select
  using (public.user_is_group_challenge_participant(challenge_id));

create policy "group_challenge_rounds_insert_own"
  on public.group_challenge_rounds for insert
  with check (
    exists (
      select 1
      from public.group_challenge_rosters r
      join public.group_challenges c on c.id = r.challenge_id
      where r.id = roster_entry_id
        and r.challenge_id = group_challenge_rounds.challenge_id
        and r.user_id = auth.uid()
        and r.eligibility_status = 'eligible'
        and c.status = 'active'
        and current_date between c.start_date and c.end_date
    )
  );

create policy "group_challenge_rounds_update_participant_or_manager"
  on public.group_challenge_rounds for update
  using (
    public.user_is_group_challenge_participant(challenge_id)
  )
  with check (
    public.user_is_group_challenge_participant(challenge_id)
  );

create policy "group_challenge_results_select_participant"
  on public.group_challenge_results for select
  using (public.user_is_group_challenge_participant(challenge_id));

create policy "group_challenge_results_insert_manager"
  on public.group_challenge_results for insert
  with check (
    exists (
      select 1 from public.group_challenges c
      where c.id = challenge_id
        and (
          public.user_can_manage_social_group(c.challenging_group_id)
          or public.user_can_manage_social_group(c.challenged_group_id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- State transition RPCs
-- ---------------------------------------------------------------------------

create or replace function public.respond_group_challenge(
  p_challenge_id uuid,
  p_accept boolean
)
returns public.group_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.group_challenges;
begin
  select * into c from public.group_challenges where id = p_challenge_id for update;
  if not found then
    raise exception 'Challenge not found';
  end if;
  if c.status <> 'pending' then
    raise exception 'Challenge is not pending';
  end if;
  if not public.user_can_manage_social_group(c.challenged_group_id) then
    raise exception 'Only the challenged group admin can respond';
  end if;

  if p_accept then
    update public.group_challenges
    set status = 'accepted',
        accepted_at = now(),
        updated_at = now()
    where id = p_challenge_id
    returning * into c;
  else
    update public.group_challenges
    set status = 'declined',
        updated_at = now()
    where id = p_challenge_id
    returning * into c;
  end if;
  return c;
end;
$$;

revoke all on function public.respond_group_challenge(uuid, boolean) from public;
grant execute on function public.respond_group_challenge(uuid, boolean) to authenticated;

create or replace function public.cancel_group_challenge(p_challenge_id uuid)
returns public.group_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.group_challenges;
begin
  select * into c from public.group_challenges where id = p_challenge_id for update;
  if not found then
    raise exception 'Challenge not found';
  end if;
  if c.status in ('completed', 'canceled', 'declined') then
    raise exception 'Challenge cannot be canceled from status %', c.status;
  end if;
  if not (
    public.user_can_manage_social_group(c.challenging_group_id)
    or public.user_can_manage_social_group(c.challenged_group_id)
  ) then
    raise exception 'Only a side admin can cancel';
  end if;

  update public.group_challenges
  set status = 'canceled',
      canceled_at = now(),
      updated_at = now()
  where id = p_challenge_id
  returning * into c;
  return c;
end;
$$;

revoke all on function public.cancel_group_challenge(uuid) from public;
grant execute on function public.cancel_group_challenge(uuid) to authenticated;

-- SimCap index from counting rounds: last ≤20 diffs, best 8 avg × 0.96 (matches app math).
create or replace function public.simcap_index_from_user_rounds(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with counting as (
    select r.differential, r.played_at, r.id
    from public.rounds r
    where r.user_id = p_user_id
      and coalesce(r.is_active, true) = true
      and coalesce(r.excludes_from_simcap_index, false) = false
    order by r.played_at asc, r.id asc
  ),
  counted as (
    select count(*)::int as n from counting
  ),
  windowed as (
    select differential
    from (
      select differential, row_number() over (order by played_at desc, id desc) as rn
      from counting
    ) x
    where rn <= 20
  ),
  best as (
    select differential
    from windowed
    order by differential asc
    limit 8
  )
  select case
    when (select n from counted) < 3 then null
    else round((avg(differential) * 0.96)::numeric, 1)
  end
  from best;
$$;

revoke all on function public.simcap_index_from_user_rounds(uuid) from public;
grant execute on function public.simcap_index_from_user_rounds(uuid) to authenticated;

-- Activate: lock rosters + server-side handicap snapshots (auditable; no live index later).
create or replace function public.activate_group_challenge(p_challenge_id uuid)
returns public.group_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.group_challenges;
  v_challenging_count int;
  v_challenged_count int;
  rec record;
  v_index numeric;
  v_source text;
  v_rounds int;
  v_ghin numeric;
begin
  select * into c from public.group_challenges where id = p_challenge_id for update;
  if not found then
    raise exception 'Challenge not found';
  end if;
  if c.status <> 'accepted' then
    raise exception 'Challenge must be accepted before activation';
  end if;
  if current_date < c.start_date then
    raise exception 'Challenge window has not started yet';
  end if;
  if not (
    public.user_can_manage_social_group(c.challenging_group_id)
    or public.user_can_manage_social_group(c.challenged_group_id)
  ) then
    raise exception 'Only a side admin can activate';
  end if;

  select count(*) into v_challenging_count
  from public.group_challenge_rosters
  where challenge_id = p_challenge_id
    and group_id = c.challenging_group_id
    and eligibility_status = 'eligible'
    and withdrawn_at is null;

  select count(*) into v_challenged_count
  from public.group_challenge_rosters
  where challenge_id = p_challenge_id
    and group_id = c.challenged_group_id
    and eligibility_status = 'eligible'
    and withdrawn_at is null;

  if v_challenging_count <> c.roster_size or v_challenged_count <> c.roster_size then
    raise exception 'Both sides need exactly % eligible players', c.roster_size;
  end if;

  for rec in
    select r.id, r.user_id
    from public.group_challenge_rosters r
    where r.challenge_id = p_challenge_id
      and r.eligibility_status = 'eligible'
      and r.withdrawn_at is null
  loop
    select count(*)::int into v_rounds
    from public.rounds rr
    where rr.user_id = rec.user_id
      and coalesce(rr.is_active, true) = true
      and coalesce(rr.excludes_from_simcap_index, false) = false;

    if v_rounds < 5 then
      raise exception 'Player % needs at least 5 qualifying SimCap rounds', rec.user_id;
    end if;

    v_index := public.simcap_index_from_user_rounds(rec.user_id);
    if v_index is not null then
      v_source := 'simcap';
    else
      select case
        when p.ghin_index is not null and p.ghin_index >= 0 then p.ghin_index::numeric
        else null
      end
      into v_ghin
      from public.profiles p
      where p.id = rec.user_id;
      v_index := v_ghin;
      v_source := case when v_ghin is not null then 'ghin' else null end;
    end if;

    if v_index is null then
      raise exception 'Player % has no SimCap or GHIN handicap to snapshot', rec.user_id;
    end if;

    update public.group_challenge_rosters
    set handicap_snapshot = v_index,
        handicap_source = v_source,
        qualifying_rounds_count = v_rounds,
        snapshot_context = jsonb_build_object(
          'snapshotted_at', now(),
          'source', v_source,
          'qualifying_rounds_count', v_rounds,
          'min_qualifying_rounds', 5,
          'simcap_min_rounds_for_index', 3
        )
    where id = rec.id;
  end loop;

  update public.group_challenges
  set status = 'active',
      activated_at = now(),
      updated_at = now()
  where id = p_challenge_id
  returning * into c;
  return c;
end;
$$;

revoke all on function public.activate_group_challenge(uuid) from public;
grant execute on function public.activate_group_challenge(uuid) to authenticated;

create or replace function public.verify_group_challenge_round(
  p_round_id uuid,
  p_approve boolean,
  p_notes text default null
)
returns public.group_challenge_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.group_challenge_rounds;
  roster public.group_challenge_rosters;
  c public.group_challenges;
begin
  select * into r from public.group_challenge_rounds where id = p_round_id for update;
  if not found then
    raise exception 'Challenge round not found';
  end if;
  select * into roster from public.group_challenge_rosters where id = r.roster_entry_id;
  select * into c from public.group_challenges where id = r.challenge_id;

  if c.verification_mode <> 'verified' then
    raise exception 'Verification is only for verified-mode challenges';
  end if;
  if r.verification_status not in ('pending', 'disputed') then
    raise exception 'Round is not awaiting verification';
  end if;
  if roster.user_id = auth.uid() then
    raise exception 'A player cannot verify their own round';
  end if;
  if not public.user_can_manage_social_group(roster.group_id) then
    raise exception 'Only the player''s group admin can verify';
  end if;

  if p_approve then
    update public.group_challenge_rounds
    set verification_status = 'verified',
        verified_by = auth.uid(),
        verified_at = now(),
        verification_notes = p_notes,
        disputed_by = null,
        disputed_at = null,
        dispute_reason = null
    where id = p_round_id
    returning * into r;
  else
    update public.group_challenge_rounds
    set verification_status = 'rejected',
        verified_by = auth.uid(),
        verified_at = now(),
        verification_notes = p_notes
    where id = p_round_id
    returning * into r;
  end if;
  return r;
end;
$$;

revoke all on function public.verify_group_challenge_round(uuid, boolean, text) from public;
grant execute on function public.verify_group_challenge_round(uuid, boolean, text) to authenticated;

create or replace function public.dispute_group_challenge_round(
  p_round_id uuid,
  p_reason text
)
returns public.group_challenge_rounds
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.group_challenge_rounds;
  roster public.group_challenge_rosters;
  c public.group_challenges;
  v_opponent_group uuid;
begin
  select * into r from public.group_challenge_rounds where id = p_round_id for update;
  if not found then
    raise exception 'Challenge round not found';
  end if;
  select * into roster from public.group_challenge_rosters where id = r.roster_entry_id;
  select * into c from public.group_challenges where id = r.challenge_id;

  if r.verification_status <> 'verified' then
    raise exception 'Only verified rounds can be disputed';
  end if;

  v_opponent_group := case
    when roster.group_id = c.challenging_group_id then c.challenged_group_id
    else c.challenging_group_id
  end;

  if not public.user_can_manage_social_group(v_opponent_group) then
    raise exception 'Only the opposing group admin can dispute';
  end if;

  update public.group_challenge_rounds
  set verification_status = 'disputed',
      disputed_by = auth.uid(),
      disputed_at = now(),
      dispute_reason = nullif(trim(p_reason), '')
  where id = p_round_id
  returning * into r;

  update public.group_challenges
  set status = 'disputed',
      updated_at = now()
  where id = c.id
    and status = 'active';

  return r;
end;
$$;

revoke all on function public.dispute_group_challenge_round(uuid, text) from public;
grant execute on function public.dispute_group_challenge_round(uuid, text) to authenticated;

create or replace function public.finalize_group_challenge(p_challenge_id uuid)
returns public.group_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.group_challenges;
  v_need int;
  v_a_total numeric;
  v_b_total numeric;
  v_a_count int;
  v_b_count int;
  v_winner uuid;
begin
  select * into c from public.group_challenges where id = p_challenge_id for update;
  if not found then
    raise exception 'Challenge not found';
  end if;
  if c.status not in ('active', 'disputed') then
    raise exception 'Challenge is not active';
  end if;
  if exists (
    select 1 from public.group_challenge_results where challenge_id = p_challenge_id
  ) then
    raise exception 'Results already finalized';
  end if;
  if not (
    public.user_can_manage_social_group(c.challenging_group_id)
    or public.user_can_manage_social_group(c.challenged_group_id)
  ) then
    raise exception 'Only a side admin can finalize';
  end if;

  v_need := c.roster_size;

  if c.verification_mode = 'verified' then
    select count(*), coalesce(sum(gr.net_score), 0)
      into v_a_count, v_a_total
    from public.group_challenge_rounds gr
    join public.group_challenge_rosters r on r.id = gr.roster_entry_id
    where gr.challenge_id = p_challenge_id
      and r.group_id = c.challenging_group_id
      and r.eligibility_status = 'eligible'
      and r.withdrawn_at is null
      and gr.verification_status = 'verified';

    select count(*), coalesce(sum(gr.net_score), 0)
      into v_b_count, v_b_total
    from public.group_challenge_rounds gr
    join public.group_challenge_rosters r on r.id = gr.roster_entry_id
    where gr.challenge_id = p_challenge_id
      and r.group_id = c.challenged_group_id
      and r.eligibility_status = 'eligible'
      and r.withdrawn_at is null
      and gr.verification_status = 'verified';
  else
    select count(*), coalesce(sum(gr.net_score), 0)
      into v_a_count, v_a_total
    from public.group_challenge_rounds gr
    join public.group_challenge_rosters r on r.id = gr.roster_entry_id
    where gr.challenge_id = p_challenge_id
      and r.group_id = c.challenging_group_id
      and r.eligibility_status = 'eligible'
      and r.withdrawn_at is null
      and gr.verification_status in ('verified', 'pending');

    select count(*), coalesce(sum(gr.net_score), 0)
      into v_b_count, v_b_total
    from public.group_challenge_rounds gr
    join public.group_challenge_rosters r on r.id = gr.roster_entry_id
    where gr.challenge_id = p_challenge_id
      and r.group_id = c.challenged_group_id
      and r.eligibility_status = 'eligible'
      and r.withdrawn_at is null
      and gr.verification_status in ('verified', 'pending');
  end if;

  if v_a_count < v_need or v_b_count < v_need then
    raise exception 'Both sides need % counting scores before finalizing', v_need;
  end if;

  if v_a_total < v_b_total then
    v_winner := c.challenging_group_id;
  elsif v_b_total < v_a_total then
    v_winner := c.challenged_group_id;
  else
    v_winner := null; -- tie
  end if;

  insert into public.group_challenge_results (challenge_id, group_id, total_net, final_position)
  values
    (
      p_challenge_id,
      c.challenging_group_id,
      v_a_total,
      case when v_winner is null then 1
           when v_winner = c.challenging_group_id then 1 else 2 end
    ),
    (
      p_challenge_id,
      c.challenged_group_id,
      v_b_total,
      case when v_winner is null then 1
           when v_winner = c.challenged_group_id then 1 else 2 end
    );

  update public.group_challenges
  set status = 'completed',
      completed_at = now(),
      winner_group_id = v_winner,
      updated_at = now()
  where id = p_challenge_id
  returning * into c;
  return c;
end;
$$;

revoke all on function public.finalize_group_challenge(uuid) from public;
grant execute on function public.finalize_group_challenge(uuid) to authenticated;

-- Protect finalized results / completed challenges from roster edits.
create or replace function public.group_challenge_guard_finalized()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.group_challenges where id = coalesce(new.challenge_id, old.challenge_id);
  if v_status = 'completed' then
    raise exception 'Completed group challenges are locked';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists group_challenge_rosters_guard_finalized on public.group_challenge_rosters;
create trigger group_challenge_rosters_guard_finalized
  before insert or update or delete on public.group_challenge_rosters
  for each row execute function public.group_challenge_guard_finalized();

drop trigger if exists group_challenge_rounds_guard_finalized on public.group_challenge_rounds;
create trigger group_challenge_rounds_guard_finalized
  before insert or update or delete on public.group_challenge_rounds
  for each row execute function public.group_challenge_guard_finalized();

-- ---------------------------------------------------------------------------
-- Storage: evidence screenshots
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'group-challenge-scorecards',
  'group-challenge-scorecards',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path: {challenge_id}/{user_id}/scorecard.jpg
create policy "gc_scorecards_select_participant"
  on storage.objects for select
  using (
    bucket_id = 'group-challenge-scorecards'
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.user_is_group_challenge_participant(split_part(name, '/', 1)::uuid)
  );

create policy "gc_scorecards_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'group-challenge-scorecards'
    and split_part(name, '/', 2) = auth.uid()::text
    and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.user_is_group_challenge_participant(split_part(name, '/', 1)::uuid)
  );

create policy "gc_scorecards_update_own"
  on storage.objects for update
  using (
    bucket_id = 'group-challenge-scorecards'
    and split_part(name, '/', 2) = auth.uid()::text
  )
  with check (
    bucket_id = 'group-challenge-scorecards'
    and split_part(name, '/', 2) = auth.uid()::text
  );
