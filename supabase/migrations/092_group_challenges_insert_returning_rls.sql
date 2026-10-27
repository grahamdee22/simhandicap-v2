-- Fix Group Challenges create hang / silent failure.
--
-- INSERT … RETURNING (PostgREST Prefer: return=representation / supabase
-- .insert().select()) applies SELECT policies to the new row. The previous
-- SELECT policy called user_is_group_challenge_participant(id), which
-- re-queries group_challenges and fails to see the in-statement row — so
-- RETURNING raises 42501, the insert rolls back, and the client never gets a
-- challenge id (UI looks hung / stuck on Send).
--
-- SELECT using membership against the row's own group_id columns (no self
-- subquery) works for INSERT RETURNING and for normal reads.

drop policy if exists "group_challenges_select_participant" on public.group_challenges;

create policy "group_challenges_select_participant"
  on public.group_challenges for select
  using (
    created_by = auth.uid()
    or exists (
      select 1
      from public.group_members m
      where m.user_id = auth.uid()
        and m.group_id in (
          group_challenges.challenging_group_id,
          group_challenges.challenged_group_id
        )
    )
  );

-- Keep the helper accurate for storage policies / RPCs (same membership rule,
-- still security definer so it can read the challenge row after commit).
create or replace function public.user_is_group_challenge_participant(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_challenges c
    where c.id = p_challenge_id
      and (
        c.created_by = auth.uid()
        or exists (
          select 1 from public.group_members m
          where m.group_id = c.challenging_group_id and m.user_id = auth.uid()
        )
        or exists (
          select 1 from public.group_members m
          where m.group_id = c.challenged_group_id and m.user_id = auth.uid()
        )
      )
  );
$$;
