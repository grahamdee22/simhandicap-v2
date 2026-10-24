-- Facility demo + test accounts: when a profile is is_test, new owned rows inherit is_test.
-- Acquisition reporting already joins profiles.is_test; daily-report excludes by profile id.
-- Rounds/leagues/groups still have their own is_test columns — without this trigger, app
-- inserts default them to false even for test users.

create or replace function public.propagate_is_test_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_flag boolean;
begin
  if TG_TABLE_NAME = 'rounds' then
    v_uid := NEW.user_id;
  elsif TG_TABLE_NAME = 'social_groups' then
    v_uid := NEW.created_by;
  elsif TG_TABLE_NAME = 'leagues' then
    v_uid := NEW.created_by;
  elsif TG_TABLE_NAME = 'matches' then
    v_uid := NEW.created_by;
  else
    return NEW;
  end if;

  if v_uid is null then
    return NEW;
  end if;

  select coalesce(p.is_test, false) into v_flag
  from public.profiles p
  where p.id = v_uid;

  if coalesce(v_flag, false) then
    NEW.is_test := true;
  end if;

  return NEW;
end;
$$;

drop trigger if exists rounds_propagate_is_test on public.rounds;
create trigger rounds_propagate_is_test
  before insert on public.rounds
  for each row
  execute function public.propagate_is_test_from_profile();

drop trigger if exists social_groups_propagate_is_test on public.social_groups;
create trigger social_groups_propagate_is_test
  before insert on public.social_groups
  for each row
  execute function public.propagate_is_test_from_profile();

drop trigger if exists leagues_propagate_is_test on public.leagues;
create trigger leagues_propagate_is_test
  before insert on public.leagues
  for each row
  execute function public.propagate_is_test_from_profile();

-- matches.created_by exists on open/challenge matches
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'matches' and column_name = 'created_by'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'matches' and column_name = 'is_test'
  ) then
    drop trigger if exists matches_propagate_is_test on public.matches;
    create trigger matches_propagate_is_test
      before insert on public.matches
      for each row
      execute function public.propagate_is_test_from_profile();
  end if;
end $$;

comment on function public.propagate_is_test_from_profile() is
  'BEFORE INSERT: copy profiles.is_test onto rounds/social_groups/leagues/matches so test accounts stay out of analytics even when the client omits is_test.';
