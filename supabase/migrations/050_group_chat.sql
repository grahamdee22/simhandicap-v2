-- Group chat: coordination messages per social group (separate from match_messages).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.user_is_social_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = auth.uid()
  );
$$;

revoke all on function public.user_is_social_group_member(uuid) from public;
grant execute on function public.user_is_social_group_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.social_groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) >= 1 and char_length(content) <= 500),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists group_messages_group_created_idx
  on public.group_messages (group_id, created_at desc);

comment on table public.group_messages is
  'Group-scoped chat messages; client loads last 50. Soft-delete via deleted_at.';

create table if not exists public.group_message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.group_messages (id) on delete cascade,
  reported_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists group_message_reports_message_id_idx
  on public.group_message_reports (message_id);

comment on table public.group_message_reports is
  'User-reported group chat messages (logged for App Store compliance; no review UI in v1).';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.group_messages enable row level security;
alter table public.group_message_reports enable row level security;

create policy "group_messages_select_member"
  on public.group_messages for select
  using (public.user_is_social_group_member(group_id));

create policy "group_messages_insert_own"
  on public.group_messages for insert
  with check (
    user_id = auth.uid()
    and public.user_is_social_group_member(group_id)
  );

create policy "group_messages_update_soft_delete"
  on public.group_messages for update
  using (
    public.user_is_social_group_member(group_id)
    and (
      user_id = auth.uid()
      or public.user_can_manage_social_group(group_id)
    )
  )
  with check (
    public.user_is_social_group_member(group_id)
    and (
      user_id = auth.uid()
      or public.user_can_manage_social_group(group_id)
    )
  );

create policy "group_message_reports_insert_member"
  on public.group_message_reports for insert
  with check (
    reported_by = auth.uid()
    and exists (
      select 1
      from public.group_messages gm
      where gm.id = message_id
        and public.user_is_social_group_member(gm.group_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'group_messages'
  ) then
    alter publication supabase_realtime add table public.group_messages;
  end if;
end $$;
