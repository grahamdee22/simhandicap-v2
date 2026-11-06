-- Deleting a personal round was cascading away tournament hole scores even after
-- the match was already complete. Nassau and Skins recompute from those rows, so
-- one deleted round left the finished match with a single scorecard.
-- Keep league_rounds that are linked to a complete or halved pairing.

create or replace function public.delete_league_rounds_for_round(p_round_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.rounds where id = p_round_id and user_id = v_uid
  ) then
    raise exception 'Round not found or not owned by caller';
  end if;

  delete from public.tournament_team_hole_scores
  where source_league_round_id in (
    select lr.id
    from public.league_rounds lr
    where lr.round_id = p_round_id
      and lr.user_id = v_uid
      and not exists (
        select 1
        from public.league_match_pairing_rounds pr
        inner join public.league_match_pairings p on p.id = pr.pairing_id
        where pr.league_round_id = lr.id
          and p.status in ('complete', 'halved')
      )
  );

  delete from public.league_rounds lr
  where lr.round_id = p_round_id
    and lr.user_id = v_uid
    and not exists (
      select 1
      from public.league_match_pairing_rounds pr
      inner join public.league_match_pairings p on p.id = pr.pairing_id
      where pr.league_round_id = lr.id
        and p.status in ('complete', 'halved')
    );
end;
$$;
