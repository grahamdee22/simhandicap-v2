-- Practice Analyzer: private screenshots + per-user analysis history.
-- Path contract for bucket practice-analysis-images:
--   {user_id}/{unique}.jpg
-- where user_id must equal auth.uid() for all storage CRUD.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'practice-analysis-images',
  'practice-analysis-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.practice_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  image_path text not null,
  detected_system text,
  session_notes text,
  extracted_stats jsonb not null default '{}'::jsonb,
  takeaways jsonb not null default '[]'::jsonb,
  tips jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists practice_analyses_user_id_created_at_idx
  on public.practice_analyses (user_id, created_at desc);

alter table public.practice_analyses enable row level security;

create policy "practice_analyses_select_own"
  on public.practice_analyses for select
  using (user_id = auth.uid());

create policy "practice_analyses_insert_own"
  on public.practice_analyses for insert
  with check (user_id = auth.uid());

create policy "practice_analyses_update_own"
  on public.practice_analyses for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "practice_analyses_delete_own"
  on public.practice_analyses for delete
  using (user_id = auth.uid());

create policy "practice_analysis_images_select_own"
  on storage.objects for select
  using (
    bucket_id = 'practice-analysis-images'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "practice_analysis_images_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'practice-analysis-images'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "practice_analysis_images_update_own"
  on storage.objects for update
  using (
    bucket_id = 'practice-analysis-images'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'practice-analysis-images'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "practice_analysis_images_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'practice-analysis-images'
    and split_part(name, '/', 1) = auth.uid()::text
  );

comment on table public.practice_analyses is
  'Practice Analyzer sessions: vision-extracted range/stats insights (not part of handicap index).';
