-- Match Play RLS: participants, open-challenge feed (authenticated), co-crew visibility for
-- completed matches (mirrors rounds_select_cogroup_peers / group_members patterns).

-- ---------------------------------------------------------------------------
-- matches
-- ---------------------------------------------------------------------------

alter table public.matches enable row level security;

create policy "matches_select_participant"
  on public.matches for select
  using (player_1_id = auth.uid() or player_2_id = auth.uid());

-- Open challenges in the Social feed: any signed-in user may read active feed rows.
create policy "matches_select_open_feed"
  on public.matches for select
  using (is_open = true and status = 'open');

-- Recent completed matches visible to members who share a crew with both players
-- (same idea as leaderboard / peer visibility on social_group_matches).
create policy "matches_select_cogroup_complete"
  on public.matches for select
  using (
    status = 'complete'
    and player_2_id is not null
    and exists (
      select 1
      from public.group_members me
      inner join public.group_members g1
        on g1.group_id = me.group_id and g1.user_id = matches.player_1_id
      inner join public.group_members g2
        on g2.group_id = me.group_id and g2.user_id = matches.player_2_id
      where me.user_id = auth.uid()
    )
  );

create policy "matches_insert_as_challenger"
  on public.matches for insert
  with check (player_1_id = auth.uid());

-- Challenger, opponent, or (open + unclaimed) accepter may update. New row must still name
-- the editor as player 1 or 2 so claim updates must set player_2_id = auth.uid().
create policy "matches_update_participants_or_claim_open"
  on public.matches for update
  using (
    player_1_id = auth.uid()
    or player_2_id = auth.uid()
    or (
      is_open = true
      and status = 'open'
      and player_2_id is null
      and player_1_id is distinct from auth.uid()
    )
  )
  with check (player_1_id = auth.uid() or player_2_id = auth.uid());

-- ---------------------------------------------------------------------------
-- match_holes
-- ---------------------------------------------------------------------------

alter table public.match_holes enable row level security;

create policy "match_holes_select_participant"
  on public.match_holes for select
  using (
    exists (
      select 1
      from public.matches m
      where m.id = match_holes.match_id
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );

create policy "match_holes_select_cogroup_complete"
  on public.match_holes for select
  using (
    exists (
      select 1
      from public.matches m
      where m.id = match_holes.match_id
        and m.status = 'complete'
        and m.player_2_id is not null
        and exists (
          select 1
          from public.group_members me
          inner join public.group_members g1
            on g1.group_id = me.group_id and g1.user_id = m.player_1_id
          inner join public.group_members g2
            on g2.group_id = me.group_id and g2.user_id = m.player_2_id
          where me.user_id = auth.uid()
        )
    )
  );

create policy "match_holes_insert_own_while_active"
  on public.match_holes for insert
  with check (
    player_id = auth.uid()
    and exists (
      select 1
      from public.matches m
      where m.id = match_holes.match_id
        and m.status in ('active', 'waiting')
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );

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
    )
  )
  with check (
    player_id = auth.uid()
    and exists (
      select 1
      from public.matches m
      where m.id = match_holes.match_id
        and m.status in ('active', 'waiting')
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );

create policy "match_holes_delete_own"
  on public.match_holes for delete
  using (
    player_id = auth.uid()
    and exists (
      select 1
      from public.matches m
      where m.id = match_holes.match_id
        and m.status in ('active', 'waiting')
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );
