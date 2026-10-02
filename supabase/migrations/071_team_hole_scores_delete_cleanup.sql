-- Deleting a round soft-deletes rounds and removes league_rounds, but
-- tournament_team_hole_scores only nulls source_league_round_id (on delete set null).
-- Drop those team rows first, while the source id is still known. If teammates
-- still have a round that day, the client recomputes the team score from them.

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

  -- Ownership check: only clean up league_rounds the caller's own round produced.
  if not exists (
    select 1 from public.rounds where id = p_round_id and user_id = v_uid
  ) then
    raise exception 'Round not found or not owned by caller';
  end if;

  -- Must run before the league_rounds delete: that delete sets
  -- source_league_round_id to null and the match would miss.
  delete from public.tournament_team_hole_scores
  where source_league_round_id in (
    select id
    from public.league_rounds
    where round_id = p_round_id
      and user_id = v_uid
  );

  delete from public.league_rounds
  where round_id = p_round_id
    and user_id = v_uid;
  -- tournament_hole_scores cascades away automatically (league_round_id ... on delete cascade).
end;
$$;

grant execute on function public.delete_league_rounds_for_round(uuid) to authenticated;
