-- Match Play + open feed: read display names for opponents and open-challenge posters
-- without sharing a crew (profiles_select_groupmates alone is insufficient).

create policy "profiles_select_match_context"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.matches m
      where (m.player_1_id = auth.uid() and m.player_2_id = profiles.id)
         or (m.player_2_id = auth.uid() and m.player_1_id = profiles.id)
    )
    or exists (
      select 1
      from public.matches m
      where m.is_open = true
        and m.status = 'open'
        and m.player_2_id is null
        and m.player_1_id = profiles.id
    )
  );
