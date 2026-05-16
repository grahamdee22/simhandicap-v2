-- Optional AI scorecard verification for Match Play.

alter table public.matches
  add column if not exists verification_required boolean not null default false,
  add column if not exists p1_verified boolean not null default false,
  add column if not exists p2_verified boolean not null default false,
  add column if not exists p1_screenshot_url text,
  add column if not exists p2_screenshot_url text,
  add column if not exists p1_verification_notes text,
  add column if not exists p2_verification_notes text;

comment on column public.matches.verification_required is
  'When true, both players must submit a verified final scorecard screenshot before the match can complete.';
comment on column public.matches.p1_verified is
  'Player 1 scorecard passed AI + logged-score verification.';
comment on column public.matches.p2_verified is
  'Player 2 scorecard passed AI + logged-score verification.';
comment on column public.matches.p1_screenshot_url is
  'Signed URL for player 1 final scorecard (bucket match-scorecards).';
comment on column public.matches.p2_screenshot_url is
  'Signed URL for player 2 final scorecard (bucket match-scorecards).';
comment on column public.matches.p1_verification_notes is
  'JSON or status text from scorecard verification (pending | failed reason | AI notes).';
comment on column public.matches.p2_verification_notes is
  'JSON or status text from scorecard verification (pending | failed reason | AI notes).';

-- Data API: explicit grants for authenticated roles (required for PostgREST access).
grant select, insert, update, delete on table public.matches to authenticated;
grant select, insert, update, delete on table public.matches to service_role;

-- Private storage for final scorecard screenshots. Path: {match_id}/{user_id}/scorecard.jpg
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'match-scorecards',
  'match-scorecards',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "match_scorecards_select_participants"
  on storage.objects for select
  using (
    bucket_id = 'match-scorecards'
    and cardinality(string_to_array(nullif(trim(name), ''), '/')) >= 3
    and exists (
      select 1
      from public.matches m
      where m.id::text = split_part(name, '/', 1)
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );

create policy "match_scorecards_insert_own_slot"
  on storage.objects for insert
  with check (
    bucket_id = 'match-scorecards'
    and cardinality(string_to_array(nullif(trim(name), ''), '/')) >= 3
    and split_part(name, '/', 2) = auth.uid()::text
    and exists (
      select 1
      from public.matches m
      where m.id::text = split_part(name, '/', 1)
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
        and m.verification_required = true
        and m.status in ('active', 'waiting')
    )
  );

create policy "match_scorecards_update_own_slot"
  on storage.objects for update
  using (
    bucket_id = 'match-scorecards'
    and split_part(name, '/', 2) = auth.uid()::text
    and exists (
      select 1
      from public.matches m
      where m.id::text = split_part(name, '/', 1)
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  )
  with check (
    bucket_id = 'match-scorecards'
    and split_part(name, '/', 2) = auth.uid()::text
    and exists (
      select 1
      from public.matches m
      where m.id::text = split_part(name, '/', 1)
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );

create policy "match_scorecards_delete_own_slot"
  on storage.objects for delete
  using (
    bucket_id = 'match-scorecards'
    and split_part(name, '/', 2) = auth.uid()::text
    and exists (
      select 1
      from public.matches m
      where m.id::text = split_part(name, '/', 1)
        and (m.player_1_id = auth.uid() or m.player_2_id = auth.uid())
    )
  );
