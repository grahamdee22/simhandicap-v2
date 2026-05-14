-- Add a human-readable SimCap ID to every profile.

create sequence if not exists public.simcap_id_seq
  as bigint
  start with 100000
  increment by 1
  minvalue 100000;

alter table public.profiles
  add column if not exists simcap_id text;

alter table public.profiles
  alter column simcap_id set default lpad(nextval('public.simcap_id_seq')::text, 6, '0');

update public.profiles
set simcap_id = lpad(nextval('public.simcap_id_seq')::text, 6, '0')
where simcap_id is null;

alter table public.profiles
  alter column simcap_id set not null;

create unique index if not exists profiles_simcap_id_idx
  on public.profiles (simcap_id);

comment on column public.profiles.simcap_id is
  'Human-readable unique SimCap player identifier. Stored as text to preserve leading zeros.';
