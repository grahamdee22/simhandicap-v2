-- Custom / unrated course support for Log a Round.
-- courses.source gains 'custom'; course_tees get rating_source + par;
-- rounds snapshot tee_rating_source for history badges.

-- ---------------------------------------------------------------------------
-- courses: allow custom + creator
-- ---------------------------------------------------------------------------
alter table public.courses drop constraint if exists courses_source_check;
alter table public.courses
  add constraint courses_source_check
  check (source in ('community', 'custom'));

alter table public.courses
  add column if not exists created_by uuid references auth.users (id) on delete set null;

comment on column public.courses.created_by is
  'auth.users.id for source=custom rows; null for community imports.';

-- ---------------------------------------------------------------------------
-- course_tees: rating_source + par
-- ---------------------------------------------------------------------------
alter table public.course_tees
  add column if not exists rating_source text;

alter table public.course_tees
  add column if not exists par integer;

update public.course_tees
set rating_source = 'community'
where rating_source is null;

alter table public.course_tees
  alter column rating_source set default 'community';

alter table public.course_tees
  alter column rating_source set not null;

alter table public.course_tees
  drop constraint if exists course_tees_rating_source_check;

alter table public.course_tees
  add constraint course_tees_rating_source_check
  check (rating_source in ('curated', 'community', 'user_reported', 'default_unrated'));

alter table public.course_tees
  drop constraint if exists course_tees_par_check;

alter table public.course_tees
  add constraint course_tees_par_check
  check (par is null or (par >= 27 and par <= 90));

comment on column public.course_tees.rating_source is
  'curated | community | user_reported (user entered CR/Slope) | default_unrated (Par/113 WHS default).';

comment on column public.course_tees.par is
  'Total par for the tee (used as Course Rating when rating_source=default_unrated).';

-- ---------------------------------------------------------------------------
-- rounds: snapshot tee rating source for badges
-- ---------------------------------------------------------------------------
alter table public.rounds
  add column if not exists tee_rating_source text;

alter table public.rounds
  drop constraint if exists rounds_tee_rating_source_check;

alter table public.rounds
  add constraint rounds_tee_rating_source_check
  check (
    tee_rating_source is null
    or tee_rating_source in ('curated', 'community', 'user_reported', 'default_unrated')
  );

comment on column public.rounds.tee_rating_source is
  'Snapshot of course_tees.rating_source (or curated) at log time. '
  'user_reported / default_unrated → show Unrated course badge; still counts in index.';

-- ---------------------------------------------------------------------------
-- RLS: authenticated users can insert/select custom courses + tees they create;
--      anyone authenticated can select all (for shared custom reuse).
-- ---------------------------------------------------------------------------
drop policy if exists "courses_insert_custom" on public.courses;
create policy "courses_insert_custom"
  on public.courses for insert
  to authenticated
  with check (
    source = 'custom'
    and created_by = auth.uid()
  );

-- Any authenticated user may add a tee to an existing custom course
-- (e.g. a tee that wasn't entered yet when the course was first created).
drop policy if exists "course_tees_insert_custom" on public.course_tees;
create policy "course_tees_insert_custom"
  on public.course_tees for insert
  to authenticated
  with check (
    exists (
      select 1 from public.courses c
      where c.id = course_id
        and c.source = 'custom'
    )
  );

-- Admin (Graham) can update custom tee rating/slope/source via email check.
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
  v_email text;
  v_source text;
begin
  select lower(u.email) into v_email
  from auth.users u
  where u.id = auth.uid();

  if v_email is distinct from 'simcapadmin@gmail.com' then
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
  from public, anon, authenticated;
grant execute on function public.admin_update_custom_course_tee(uuid, numeric, numeric, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill signal: custom courses grouped by normalized name
-- ---------------------------------------------------------------------------
create or replace view public.custom_course_backfill_candidates
with (security_invoker = true)
as
select
  c.name_normalized,
  min(c.name) as sample_name,
  count(distinct c.id)::bigint as course_count,
  count(distinct c.created_by)::bigint as creator_count,
  count(t.id)::bigint as tee_count,
  count(t.id) filter (where t.rating_source = 'default_unrated')::bigint as default_unrated_tees,
  count(t.id) filter (where t.rating_source = 'user_reported')::bigint as user_reported_tees,
  min(c.created_at) as first_created_at,
  max(c.created_at) as last_created_at
from public.courses c
left join public.course_tees t on t.course_id = c.id
where c.source = 'custom'
group by c.name_normalized
having count(distinct c.id) >= 1;

comment on view public.custom_course_backfill_candidates is
  'Internal: custom courses grouped by name_normalized to prioritize sourcing real CR/Slope.';

revoke all on public.custom_course_backfill_candidates from anon, authenticated;
grant select on public.custom_course_backfill_candidates to service_role;
-- Graham can read via authenticated if email matches — optional; service_role/SQL editor is enough.
grant select on public.custom_course_backfill_candidates to authenticated;
