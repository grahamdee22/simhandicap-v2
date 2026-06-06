-- Allow authenticated users to upload/read GS Pro scorecard images for round-log parsing.
-- Path: log/{user_id}/scorecard.jpg in bucket match-scorecards.

create policy "match_scorecards_insert_log_parse"
  on storage.objects for insert
  with check (
    bucket_id = 'match-scorecards'
    and split_part(name, '/', 1) = 'log'
    and split_part(name, '/', 2) = auth.uid()::text
  );

create policy "match_scorecards_update_log_parse"
  on storage.objects for update
  using (
    bucket_id = 'match-scorecards'
    and split_part(name, '/', 1) = 'log'
    and split_part(name, '/', 2) = auth.uid()::text
  )
  with check (
    bucket_id = 'match-scorecards'
    and split_part(name, '/', 1) = 'log'
    and split_part(name, '/', 2) = auth.uid()::text
  );

create policy "match_scorecards_select_log_parse"
  on storage.objects for select
  using (
    bucket_id = 'match-scorecards'
    and split_part(name, '/', 1) = 'log'
    and split_part(name, '/', 2) = auth.uid()::text
  );

create policy "match_scorecards_delete_log_parse"
  on storage.objects for delete
  using (
    bucket_id = 'match-scorecards'
    and split_part(name, '/', 1) = 'log'
    and split_part(name, '/', 2) = auth.uid()::text
  );
