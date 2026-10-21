-- App-level admin (Graham): profiles flag + shared helper.
-- Client email allowlist alone failed because login email ≠ simcapadmin@gmail.com support inbox.

alter table public.profiles
  add column if not exists is_app_admin boolean not null default false;

comment on column public.profiles.is_app_admin is
  'When true, user can use internal admin tools (custom course promote/delete/backfill).';

-- Bootstrap: anyone already signed in as the support inbox.
update public.profiles p
set is_app_admin = true
from auth.users u
where p.id = u.id
  and lower(u.email) = 'simcapadmin@gmail.com';

create or replace function public.is_simcap_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text;
  v_flag boolean;
begin
  if auth.uid() is null then
    return false;
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = auth.uid();

  if v_email = 'simcapadmin@gmail.com' then
    return true;
  end if;

  select coalesce(p.is_app_admin, false) into v_flag
  from public.profiles p
  where p.id = auth.uid();

  return coalesce(v_flag, false);
end;
$$;

revoke all on function public.is_simcap_admin() from public, anon;
grant execute on function public.is_simcap_admin() to authenticated;

-- Promote / edit custom tee (replace email-only gate).
create or replace function public.admin_update_custom_course_tee(
  p_tee_id uuid,
  p_rating numeric,
  p_slope numeric,
  p_promote_to_curated boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text;
begin
  if not public.is_simcap_admin() then
    raise exception 'not authorized';
  end if;

  if p_slope < 55 or p_slope > 155 then
    raise exception 'slope out of range';
  end if;
  if p_rating < 55 or p_rating > 85 then
    raise exception 'rating out of range';
  end if;

  v_source := case when p_promote_to_curated then 'curated' else 'user_reported' end;

  update public.course_tees t
  set
    rating = p_rating,
    slope = p_slope,
    rating_source = v_source
  from public.courses c
  where t.id = p_tee_id
    and t.course_id = c.id
    and c.source = 'custom';

  if not found then
    raise exception 'tee not found';
  end if;

  return jsonb_build_object('ok', true, 'rating_source', v_source);
end;
$$;

revoke all on function public.admin_update_custom_course_tee(uuid, numeric, numeric, boolean)
  from public, anon;
grant execute on function public.admin_update_custom_course_tee(uuid, numeric, numeric, boolean)
  to authenticated;

-- Delete a custom course (and tees via cascade). Blocks if any rounds reference it.
create or replace function public.admin_delete_custom_course(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_rounds bigint;
begin
  if not public.is_simcap_admin() then
    raise exception 'not authorized';
  end if;

  select c.name into v_name
  from public.courses c
  where c.id = p_course_id
    and c.source = 'custom';

  if v_name is null then
    raise exception 'custom course not found';
  end if;

  -- rounds.course_id is text (curated slug or community/custom uuid string).
  select count(*)::bigint into v_rounds
  from public.rounds r
  where r.course_id = p_course_id::text;

  if v_rounds > 0 then
    raise exception 'course has % round(s); refuse delete', v_rounds;
  end if;

  delete from public.courses
  where id = p_course_id
    and source = 'custom';

  return jsonb_build_object('ok', true, 'name', v_name);
end;
$$;

revoke all on function public.admin_delete_custom_course(uuid) from public, anon;
grant execute on function public.admin_delete_custom_course(uuid) to authenticated;
