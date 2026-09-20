-- 9-hole logged rounds for SimCap index (Front 9 / Back 9).
-- Rating/slope used for the differential are stored on the round as usual;
-- nine_hole_source records whether that CR was derived (18÷2) or real per-nine data.

alter table public.rounds
  add column if not exists holes_played text not null default '18'
    check (holes_played in ('18', 'front', 'back'));

alter table public.rounds
  add column if not exists nine_hole_source text null
    check (nine_hole_source is null or nine_hole_source in ('derived', 'real'));

comment on column public.rounds.holes_played is
  '18 = full round; front/back = 9-hole score counting as one SimCap differential.';

comment on column public.rounds.nine_hole_source is
  'For 9-hole rounds: derived = 18-hole CR÷2 same slope; real = sourced Front/Back 9 CR/slope. Null for 18-hole rounds.';

-- Stroke Play nets a rounded course handicap off gross and averages against 18-hole
-- peers, so a 9-hole gross would distort standings. Scramble/Best Ball hole cards are
-- hardcoded to 18 with no shorter path. Reject associating any 9-hole round with a tournament.
create or replace function public.reject_nine_hole_league_round()
returns trigger
language plpgsql
as $$
declare
  v_holes text;
begin
  if new.round_id is null then
    return new;
  end if;
  select r.holes_played into v_holes
  from public.rounds r
  where r.id = new.round_id;
  if v_holes is not null and v_holes <> '18' then
    raise exception
      'Nine-hole rounds cannot be applied to tournaments (holes_played=%)',
      v_holes
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists league_rounds_reject_nine_hole on public.league_rounds;
create trigger league_rounds_reject_nine_hole
  before insert or update of round_id on public.league_rounds
  for each row
  execute procedure public.reject_nine_hole_league_round();
