-- Manually curated real-course aliases for disguised GSPro community names.
-- Findability only — does not change rating/slope. Add new rows via SQL insert
-- (no new migration required): look up courses.id by name, then insert.

create table if not exists public.course_aliases (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  real_course_name text not null,
  real_course_name_normalized text not null,
  source text not null
    check (source in ('manual_cross_reference', 'location_match')),
  confidence text not null default 'verified'
    check (confidence in ('verified', 'suspected')),
  notes text,
  created_at timestamptz not null default now(),
  constraint course_aliases_course_id_unique unique (course_id)
);

create index if not exists course_aliases_real_name_norm_idx
  on public.course_aliases (real_course_name_normalized);

comment on table public.course_aliases is
  'Manual map from GSPro community course → real-world course name for search findability. '
  'Not scraped; Graham inserts new rows as mappings are confirmed.';

comment on column public.course_aliases.real_course_name is
  'Display name of the real course this community row recreates (e.g. Pebble Beach Golf Links).';

comment on column public.course_aliases.source is
  'How we know: manual_cross_reference (human) or location_match (place string corroborated).';

alter table public.course_aliases enable row level security;

drop policy if exists "course_aliases_select_authenticated" on public.course_aliases;
create policy "course_aliases_select_authenticated"
  on public.course_aliases for select
  to authenticated
  using (true);

grant select on table public.course_aliases to authenticated;

-- Seed confirmed mappings (skip any name not present in community courses).
insert into public.course_aliases (
  course_id, real_course_name, real_course_name_normalized, source, confidence, notes
)
select c.id, v.real_course_name, v.real_norm, v.src, 'verified', v.notes
from (
  values
    (
      'DPC Pebble',
      'Pebble Beach Golf Links',
      'pebble beach golf links',
      'manual_cross_reference',
      'Confirmed disguised GSPro recreation'
    ),
    (
      'Georgia Golf Club',
      'Augusta National Golf Club',
      'augusta national golf club',
      'manual_cross_reference',
      'Confirmed disguised GSPro recreation'
    ),
    (
      'DPC County Down',
      'Royal County Down Golf Club',
      'royal county down golf club',
      'manual_cross_reference',
      'Confirmed disguised GSPro recreation'
    ),
    (
      'DPC Craggy Ranch',
      'TPC Craig Ranch',
      'tpc craig ranch',
      'location_match',
      'Both McKinney, TX; confirmed disguise of TPC Craig Ranch'
    ),
    (
      'Sovereignbyre Links',
      'St Andrews Old Course',
      'st andrews old course',
      'manual_cross_reference',
      'Confirmed disguised GSPro recreation'
    ),
    (
      'Pinehurst 8',
      'Pinehurst No. 8',
      'pinehurst no. 8',
      'manual_cross_reference',
      'Confirmed GSPro naming variant of Pinehurst No. 8'
    ),
    (
      'Torrey South',
      'Torrey Pines Golf Course (South Course)',
      'torrey pines golf course (south course)',
      'manual_cross_reference',
      'Confirmed disguised/short name for Torrey Pines South'
    ),
    (
      'Wentworth West Course',
      'Wentworth Club (West Course)',
      'wentworth club (west course)',
      'manual_cross_reference',
      'Confirmed GSPro naming for Wentworth West'
    ),
    (
      'Bay Hill',
      'Arnold Palmer''s Bay Hill Club & Lodge',
      'arnold palmer''s bay hill club & lodge',
      'manual_cross_reference',
      'Confirmed GSPro short name for Bay Hill'
    )
) as v(community_name, real_course_name, real_norm, src, notes)
inner join public.courses c
  on c.source = 'community'
 and c.name = v.community_name
on conflict (course_id) do nothing;
