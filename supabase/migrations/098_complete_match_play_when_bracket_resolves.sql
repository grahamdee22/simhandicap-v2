-- Match Play was only marked completed when a group manager opened the
-- tournament after the bracket was already done. Season standings read
-- leagues.status, so an early final stayed "active" and earned no points.
-- Close the league in the database as soon as the deciding match is stored.

create or replace function public.mark_match_play_league_completed_if_resolved(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_league public.leagues%rowtype;
  v_resolved boolean := false;
begin
  select * into v_league from public.leagues where id = p_league_id;
  if not found then
    return;
  end if;
  if v_league.format <> 'match_play' or v_league.status <> 'active' then
    return;
  end if;

  if v_league.match_play_pairing_method = 'bracket' then
    select exists (
      select 1
      from public.league_match_pairings p
      where p.league_id = p_league_id
        and p.bracket_round = 'final'
        and p.status in ('complete', 'halved')
        and p.winner_entry_id is not null
    ) into v_resolved;
  else
    select
      exists (select 1 from public.league_match_pairings p where p.league_id = p_league_id)
      and not exists (
        select 1
        from public.league_match_pairings p
        where p.league_id = p_league_id
          and p.status not in ('complete', 'halved')
      )
    into v_resolved;
  end if;

  if v_resolved then
    update public.leagues
    set status = 'completed', updated_at = now()
    where id = p_league_id
      and status = 'active';
  end if;
end;
$$;

create or replace function public.trg_complete_match_play_league()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mark_match_play_league_completed_if_resolved(new.league_id);
  return new;
end;
$$;

drop trigger if exists league_match_pairings_complete_league on public.league_match_pairings;
create trigger league_match_pairings_complete_league
  after insert or update of status, winner_entry_id
  on public.league_match_pairings
  for each row
  when (new.status in ('complete', 'halved'))
  execute function public.trg_complete_match_play_league();

-- Tournaments whose final was already decided stay active until this runs.
update public.leagues l
set status = 'completed', updated_at = now()
where l.status = 'active'
  and l.format = 'match_play'
  and (
    (
      l.match_play_pairing_method = 'bracket'
      and exists (
        select 1
        from public.league_match_pairings p
        where p.league_id = l.id
          and p.bracket_round = 'final'
          and p.status in ('complete', 'halved')
          and p.winner_entry_id is not null
      )
    )
    or (
      coalesce(l.match_play_pairing_method, '') <> 'bracket'
      and exists (
        select 1 from public.league_match_pairings p where p.league_id = l.id
      )
      and not exists (
        select 1
        from public.league_match_pairings p
        where p.league_id = l.id
          and p.status not in ('complete', 'halved')
      )
    )
  );
