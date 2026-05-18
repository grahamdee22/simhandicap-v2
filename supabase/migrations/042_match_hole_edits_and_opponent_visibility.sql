-- Match hole edits: server-side upsert with verification reset, scoring lock, and
-- opponent hole visibility (per-hole hidden until match complete; gross total via RPC).

-- ---------------------------------------------------------------------------
-- RLS: participants see own holes always; opponent per-hole only when complete
-- ---------------------------------------------------------------------------

drop policy if exists "match_holes_select_participant" on public.match_holes;

create policy "match_holes_select_own"
  on public.match_holes for select
  using (player_id = auth.uid());

create policy "match_holes_select_opponent_when_complete"
  on public.match_holes for select
  using (
    player_id is distinct from auth.uid()
    and exists (
      select 1
      from public.matches m
      where m.id = match_holes.match_id
        and m.status = 'complete'
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );

drop policy if exists "match_holes_update_own" on public.match_holes;

create policy "match_holes_update_own"
  on public.match_holes for update
  using (
    player_id = auth.uid()
    and exists (
      select 1
      from public.matches m
      where m.id = match_holes.match_id
        and m.status in ('active', 'waiting')
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
        and not (
          m.status = 'complete'
          or (m.verification_required and m.p1_verified and m.p2_verified)
        )
    )
  )
  with check (player_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Helper: expected hole count for a match row
-- ---------------------------------------------------------------------------

create or replace function public.match_holes_expected(p_match public.matches)
returns integer
language sql
immutable
as $$
  select case
    when p_match.holes = 18 then 18
    when p_match.nine_selection = 'front' then 9
    else 9
  end;
$$;

-- ---------------------------------------------------------------------------
-- Opponent scoring summary (aggregate only — no per-hole leak while in progress)
-- ---------------------------------------------------------------------------

create or replace function public.get_match_opponent_scoring_summary(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  m public.matches%rowtype;
  v_opp_id uuid;
  v_expected int;
  v_my_count int;
  v_opp_count int;
  v_opp_gross int;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  select * into m from public.matches where id = p_match_id;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;

  if m.player_1_id = v_uid then
    v_opp_id := m.player_2_id;
  elsif m.player_2_id = v_uid then
    v_opp_id := m.player_1_id;
  else
    return jsonb_build_object('error', 'not_participant');
  end if;

  if v_opp_id is null then
    return jsonb_build_object('error', 'no_opponent');
  end if;

  v_expected := public.match_holes_expected(m);

  select count(distinct hole_number)::int
  into v_opp_count
  from public.match_holes
  where match_id = p_match_id and player_id = v_opp_id;

  select count(distinct hole_number)::int
  into v_my_count
  from public.match_holes
  where match_id = p_match_id and player_id = v_uid;

  if v_my_count < v_expected or v_opp_count < v_expected then
    return jsonb_build_object(
      'opponent_holes_played', v_opp_count,
      'both_finished_holes', false,
      'opponent_gross_total', null
    );
  end if;

  select coalesce(sum(gross_score), 0)::int
  into v_opp_gross
  from public.match_holes
  where match_id = p_match_id and player_id = v_opp_id;

  return jsonb_build_object(
    'opponent_holes_played', v_opp_count,
    'both_finished_holes', true,
    'opponent_gross_total', v_opp_gross
  );
end;
$$;

revoke all on function public.get_match_opponent_scoring_summary(uuid) from public;
grant execute on function public.get_match_opponent_scoring_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Upsert own hole score; reset verification when editing after verify
-- ---------------------------------------------------------------------------

create or replace function public.upsert_match_hole_score(
  p_match_id uuid,
  p_hole_number integer,
  p_gross_score integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  m public.matches%rowtype;
  v_existing_id uuid;
  v_was_verified boolean;
  v_row public.match_holes%rowtype;
  v_verification_reset boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_hole_number < 1 or p_hole_number > 18 or p_gross_score < 1 then
    raise exception 'Invalid hole or score';
  end if;

  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found';
  end if;

  if m.player_1_id is distinct from v_uid and m.player_2_id is distinct from v_uid then
    raise exception 'Not a participant';
  end if;

  if m.status = 'complete' then
    raise exception 'Match is locked — scores cannot be edited';
  end if;

  if m.verification_required and m.p1_verified and m.p2_verified then
    raise exception 'Match is locked — both players are verified';
  end if;

  if m.status not in ('active', 'waiting') then
    raise exception 'Match is not open for scoring';
  end if;

  if v_uid = m.player_1_id then
    v_was_verified := coalesce(m.p1_verified, false);
  else
    v_was_verified := coalesce(m.p2_verified, false);
  end if;

  select id into v_existing_id
  from public.match_holes
  where match_id = p_match_id
    and player_id = v_uid
    and hole_number = p_hole_number;

  if v_existing_id is not null then
    update public.match_holes
    set gross_score = p_gross_score
    where id = v_existing_id
    returning * into v_row;

    if v_was_verified then
      v_verification_reset := true;
      if v_uid = m.player_1_id then
        update public.matches
        set
          p1_verified = false,
          p1_screenshot_url = null,
          p1_verification_notes = null,
          updated_at = now()
        where id = p_match_id;
      else
        update public.matches
        set
          p2_verified = false,
          p2_screenshot_url = null,
          p2_verification_notes = null,
          updated_at = now()
        where id = p_match_id;
      end if;
    end if;
  else
    insert into public.match_holes (match_id, player_id, hole_number, gross_score)
    values (p_match_id, v_uid, p_hole_number, p_gross_score)
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'hole', to_jsonb(v_row),
    'verification_reset', v_verification_reset
  );
end;
$$;

revoke all on function public.upsert_match_hole_score(uuid, integer, integer) from public;
grant execute on function public.upsert_match_hole_score(uuid, integer, integer) to authenticated;
