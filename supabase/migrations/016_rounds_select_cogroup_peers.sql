-- Read peers' rounds for handicap / leaderboards when you share a crew.
-- Uses public.crew_peer_user_ids_for_request() (migration 015). INSERT/UPDATE/DELETE stay own-row only.
-- ---------------------------------------------------------------------------

drop policy if exists "rounds_select_cogroup_peers" on public.rounds;

create policy "rounds_select_cogroup_peers"
  on public.rounds for select
  using (
    user_id in (select public.crew_peer_user_ids_for_request())
  );
