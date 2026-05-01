-- Private storage for Match Play sim-settings screenshots. Path layout (app contract):
--   {match_id}/{user_id}/{filename}
-- where user_id must equal auth.uid() for writes; both match participants may read any object
-- under that match_id prefix.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'match-settings',
  'match-settings',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path helpers: require match_id (segment 1), uploader (segment 2), and a non-empty filename (segment 3+).
-- Compare match id as text to avoid cast errors on malformed paths.

create policy "match_settings_select_participants"
  on storage.objects for select
  using (
    bucket_id = 'match-settings'
    and cardinality(string_to_array(nullif(trim(name), ''), '/')) >= 3
    and exists (
      select 1
      from public.matches m
      where m.id::text = split_part(name, '/', 1)
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );

create policy "match_settings_insert_own_slot"
  on storage.objects for insert
  with check (
    bucket_id = 'match-settings'
    and cardinality(string_to_array(nullif(trim(name), ''), '/')) >= 3
    and split_part(name, '/', 2) = auth.uid()::text
    and exists (
      select 1
      from public.matches m
      where m.id::text = split_part(name, '/', 1)
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );

create policy "match_settings_update_own_slot"
  on storage.objects for update
  using (
    bucket_id = 'match-settings'
    and split_part(name, '/', 2) = auth.uid()::text
    and exists (
      select 1
      from public.matches m
      where m.id::text = split_part(name, '/', 1)
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  )
  with check (
    bucket_id = 'match-settings'
    and split_part(name, '/', 2) = auth.uid()::text
    and exists (
      select 1
      from public.matches m
      where m.id::text = split_part(name, '/', 1)
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );

create policy "match_settings_delete_own_slot"
  on storage.objects for delete
  using (
    bucket_id = 'match-settings'
    and split_part(name, '/', 2) = auth.uid()::text
    and exists (
      select 1
      from public.matches m
      where m.id::text = split_part(name, '/', 1)
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );

comment on column public.matches.player_1_settings_photo_url is
  'Challenger settings screenshot (private bucket match-settings; path {match_id}/{user_id}/{file}).';
comment on column public.matches.player_2_settings_photo_url is
  'Opponent settings screenshot (private bucket match-settings; path {match_id}/{user_id}/{file}).';
