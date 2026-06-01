-- Soft-active flag for social groups (e.g. hide inactive crews without deleting).

alter table public.social_groups
  add column if not exists is_active boolean not null default true;

comment on column public.social_groups.is_active is
  'When false, the group may be hidden from listings; defaults to true for existing and new groups.';
