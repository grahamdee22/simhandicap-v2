-- Allow the poster to delete their own open challenge before anyone accepts (no player_2 yet).

create policy "matches_delete_open_unclaimed_by_poster"
  on public.matches for delete
  using (
    player_1_id = auth.uid()
    and is_open = true
    and status = 'open'
    and player_2_id is null
  );
