-- Optional attribution tag captured at signup (e.g. a partner's referral code).
alter table public.profiles
  add column if not exists referral_code text;

comment on column public.profiles.referral_code is
  'Optional code entered at signup to attribute this account to a specific partner/referrer. Null for organic signups.';

-- Preserve existing display_name coalescing from 001_profiles.sql; add referral_code from meta.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, referral_code)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1),
      'Golfer'
    ),
    nullif(trim(new.raw_user_meta_data ->> 'referral_code'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
