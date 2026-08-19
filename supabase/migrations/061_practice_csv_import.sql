-- Practice Analyzer CSV import (replaces the photo-based flow).
-- Pairing codes + CSV storage. Never writes to public.rounds / handicap math.
-- Idempotent: safe to re-run in SQL Editor if a previous apply was partial.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'practice-analysis-csvs',
  'practice-analysis-csvs',
  false,
  4194304,
  array['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.practice_analyses
  alter column image_path drop not null;

alter table public.practice_analyses
  add column if not exists source text not null default 'csv',
  add column if not exists csv_path text,
  add column if not exists platform text,
  add column if not exists session_played_at timestamptz,
  add column if not exists status text not null default 'ready',
  add column if not exists error_message text,
  add column if not exists original_filename text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'practice_analyses_source_check'
      and conrelid = 'public.practice_analyses'::regclass
  ) then
    alter table public.practice_analyses
      add constraint practice_analyses_source_check
      check (source in ('csv', 'image'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'practice_analyses_status_check'
      and conrelid = 'public.practice_analyses'::regclass
  ) then
    alter table public.practice_analyses
      add constraint practice_analyses_status_check
      check (status in ('processing', 'ready', 'failed'));
  end if;
end $$;

comment on table public.practice_analyses is
  'Practice Analyzer sessions from CSV import (coaching only — not part of handicap index).';

create table if not exists public.practice_import_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending',
  consumed_at timestamptz,
  analysis_id uuid references public.practice_analyses (id) on delete set null,
  constraint practice_import_codes_code_digits check (code ~ '^[0-9]{6}$'),
  constraint practice_import_codes_status_check check (status in ('pending', 'consumed', 'expired'))
);

create unique index if not exists practice_import_codes_pending_code_uidx
  on public.practice_import_codes (code)
  where status = 'pending';

create index if not exists practice_import_codes_user_id_created_at_idx
  on public.practice_import_codes (user_id, created_at desc);

create index if not exists practice_import_codes_analysis_id_idx
  on public.practice_import_codes (analysis_id)
  where analysis_id is not null;

alter table public.practice_import_codes enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'practice_import_codes'
      and policyname = 'practice_import_codes_select_own'
  ) then
    create policy "practice_import_codes_select_own"
      on public.practice_import_codes for select
      using (user_id = auth.uid());
  end if;
end $$;

create table if not exists public.practice_import_rate_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  user_id uuid,
  ip_hash text,
  created_at timestamptz not null default now(),
  constraint practice_import_rate_events_kind_check check (kind in ('generate', 'upload'))
);

create index if not exists practice_import_rate_events_generate_user_idx
  on public.practice_import_rate_events (user_id, created_at desc)
  where kind = 'generate';

create index if not exists practice_import_rate_events_upload_ip_idx
  on public.practice_import_rate_events (ip_hash, created_at desc)
  where kind = 'upload';

alter table public.practice_import_rate_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'practice_analysis_csvs_select_own'
  ) then
    create policy "practice_analysis_csvs_select_own"
      on storage.objects for select
      using (
        bucket_id = 'practice-analysis-csvs'
        and split_part(name, '/', 1) = auth.uid()::text
      );
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'practice_analysis_csvs_delete_own'
  ) then
    create policy "practice_analysis_csvs_delete_own"
      on storage.objects for delete
      using (
        bucket_id = 'practice-analysis-csvs'
        and split_part(name, '/', 1) = auth.uid()::text
      );
  end if;
end $$;

create or replace function public.consume_practice_import_code(p_code text)
returns table (
  id uuid,
  user_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.practice_import_codes c
  set
    status = 'consumed',
    consumed_at = now()
  where c.code = p_code
    and c.status = 'pending'
    and c.expires_at > now()
  returning c.id, c.user_id, c.expires_at;
end;
$$;

revoke all on function public.consume_practice_import_code(text) from public, anon, authenticated;
grant execute on function public.consume_practice_import_code(text) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'practice_analyses'
  ) then
    alter publication supabase_realtime add table public.practice_analyses;
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'practice_import_codes'
  ) then
    alter publication supabase_realtime add table public.practice_import_codes;
  end if;
end $$;
