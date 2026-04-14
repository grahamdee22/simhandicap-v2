-- group_members SELECT cannot safely subquery group_members (RLS re-enters the same policy).
-- Mirror (user_id, group_id) in user_group_membership, maintained by trigger; SELECT policy
-- only references the mirror table.
-- ---------------------------------------------------------------------------

create table if not exists public.user_group_membership (
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid not null references public.social_groups (id) on delete cascade,
  primary key (user_id, group_id)
);

create index if not exists user_group_membership_group_id_idx
  on public.user_group_membership (group_id);

alter table public.user_group_membership enable row level security;

drop policy if exists "user_group_membership_select_own" on public.user_group_membership;
create policy "user_group_membership_select_own"
  on public.user_group_membership for select
  using (user_id = auth.uid());

revoke insert, update, delete on public.user_group_membership from public;
revoke insert, update, delete on public.user_group_membership from authenticated;

grant select on public.user_group_membership to authenticated;

create or replace function public.sync_user_group_membership_from_group_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.user_group_membership (user_id, group_id)
    values (new.user_id, new.group_id)
    on conflict (user_id, group_id) do nothing;
    return new;
  elsif tg_op = 'DELETE' then
    delete from public.user_group_membership
    where user_id = old.user_id and group_id = old.group_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_group_members_sync_user_membership on public.group_members;
create trigger trg_group_members_sync_user_membership
  after insert or delete on public.group_members
  for each row
  execute procedure public.sync_user_group_membership_from_group_members();

insert into public.user_group_membership (user_id, group_id)
select gm.user_id, gm.group_id
from public.group_members gm
on conflict (user_id, group_id) do nothing;

drop policy if exists "group_members_select_same_group" on public.group_members;

create policy "group_members_select_same_group"
  on public.group_members for select
  using (
    user_id = auth.uid()
    or group_id in (
      select ugm.group_id
      from public.user_group_membership ugm
      where ugm.user_id = auth.uid()
    )
  );
