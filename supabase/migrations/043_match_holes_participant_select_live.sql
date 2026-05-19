-- Participants may read all hole scores for their match (live + complete).
-- Scorecard verification prevents manipulation; live visibility enables reactions and finalization.

drop policy if exists "match_holes_select_own" on public.match_holes;
drop policy if exists "match_holes_select_opponent_when_complete" on public.match_holes;

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
