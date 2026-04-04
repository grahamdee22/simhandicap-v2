-- Social / Groups: crews the user created or joined, members, H2H matches, invites.
-- RLS: only members see group data; only authenticated users create groups they own.

create table if not exists public.social_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.social_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name_snapshot text,
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists public.social_group_matches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.social_groups (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  course_name text not null,
  played_at timestamptz not null,
  left_name text not null,
  left_gross int not null,
  left_net numeric,
  left_won boolean not null default false,
  right_name text not null,
  right_gross int,
  right_net numeric,
  right_won boolean not null default false,
  conditions_line text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.social_group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.social_groups (id) on delete cascade,
  email text not null,
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists group_members_user_id_idx on public.group_members (user_id);
create index if not exists group_members_group_id_idx on public.group_members (group_id);
create index if not exists social_group_matches_group_id_idx on public.social_group_matches (group_id);

alter table public.social_groups enable row level security;
alter table public.group_members enable row level security;
alter table public.social_group_matches enable row level security;
alter table public.social_group_invites enable row level security;

create policy "social_groups_select_member"
  on public.social_groups for select
  using (
    exists (
      select 1 from public.group_members m
      where m.group_id = social_groups.id and m.user_id = auth.uid()
    )
  );

create policy "social_groups_insert_owner"
  on public.social_groups for insert
  with check (created_by = auth.uid());

-- Creator can remove a group if membership insert fails after group insert (client rollback).
create policy "social_groups_delete_creator"
  on public.social_groups for delete
  using (created_by = auth.uid());

create policy "group_members_select_same_group"
  on public.group_members for select
  using (
    exists (
      select 1 from public.group_members m
      where m.group_id = group_members.group_id and m.user_id = auth.uid()
    )
  );

create policy "group_members_insert_creator"
  on public.group_members for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.social_groups g
      where g.id = group_id and g.created_by = auth.uid()
    )
  );

create policy "social_group_matches_select_member"
  on public.social_group_matches for select
  using (
    exists (
      select 1 from public.group_members m
      where m.group_id = social_group_matches.group_id and m.user_id = auth.uid()
    )
  );

create policy "social_group_matches_insert_member"
  on public.social_group_matches for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.group_members m
      where m.group_id = social_group_matches.group_id and m.user_id = auth.uid()
    )
  );

create policy "social_group_invites_select_inviter_or_creator"
  on public.social_group_invites for select
  using (
    invited_by = auth.uid()
    or exists (
      select 1 from public.social_groups g
      where g.id = group_id and g.created_by = auth.uid()
    )
  );

create policy "social_group_invites_insert_member"
  on public.social_group_invites for insert
  with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.group_members m
      where m.group_id = social_group_invites.group_id and m.user_id = auth.uid()
    )
  );

-- Let members see basic profile fields for people in the same crews (leaderboard names / indexes).
create policy "profiles_select_groupmates"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.group_members m1
      inner join public.group_members m2 on m1.group_id = m2.group_id
      where m1.user_id = auth.uid() and m2.user_id = profiles.id
    )
  );
