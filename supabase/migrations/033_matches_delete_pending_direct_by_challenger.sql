-- Allow the challenger to withdraw a direct challenge they created while it is still pending
-- (opponent chosen but has not accepted yet).

create policy "matches_delete_pending_direct_by_challenger"
  on public.matches for delete
  using (
    player_1_id = auth.uid()
    and is_open = false
    and status = 'pending'
  );
