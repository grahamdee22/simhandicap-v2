-- Hole reactions: emoji locked once per player per hole on opponent's score row.

alter table public.match_holes
  add column if not exists player_1_reaction text null,
  add column if not exists player_2_reaction text null;

comment on column public.match_holes.player_1_reaction is
  'When player_id is player 2, emoji sent by player 1 reacting to player 2''s hole score.';
comment on column public.match_holes.player_2_reaction is
  'When player_id is player 1, emoji sent by player 2 reacting to player 1''s hole score.';

create or replace function public.set_match_hole_reaction(
  p_match_id uuid,
  p_hole_number integer,
  p_emoji text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  m public.matches%rowtype;
  n int;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  if p_emoji is null or trim(p_emoji) = '' then
    return jsonb_build_object('ok', false, 'error', 'Invalid reaction');
  end if;

  if p_emoji not in ('🔥', '💀', '😤', '🫡', '😂', '💩') then
    return jsonb_build_object('ok', false, 'error', 'Invalid reaction');
  end if;

  select * into m from public.matches where id = p_match_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Match not found');
  end if;

  if m.player_2_id is null then
    return jsonb_build_object('ok', false, 'error', 'Match has no opponent');
  end if;

  if m.status not in ('active', 'waiting') then
    return jsonb_build_object('ok', false, 'error', 'Match is not open for reactions');
  end if;

  if uid <> m.player_1_id and uid <> m.player_2_id then
    return jsonb_build_object('ok', false, 'error', 'Not a participant');
  end if;

  if p_hole_number < 1 or p_hole_number > 18 then
    return jsonb_build_object('ok', false, 'error', 'Invalid hole');
  end if;

  if uid = m.player_1_id then
    update public.match_holes mh
    set player_1_reaction = p_emoji
    where mh.match_id = p_match_id
      and mh.player_id = m.player_2_id
      and mh.hole_number = p_hole_number
      and mh.player_1_reaction is null;

    get diagnostics n = row_count;
  else
    update public.match_holes mh
    set player_2_reaction = p_emoji
    where mh.match_id = p_match_id
      and mh.player_id = m.player_1_id
      and mh.hole_number = p_hole_number
      and mh.player_2_reaction is null;

    get diagnostics n = row_count;
  end if;

  if n = 0 then
    return jsonb_build_object(
      'ok',
      false,
      'error',
      'Cannot react — opponent''s score may not be saved yet, or you already reacted.'
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.set_match_hole_reaction(uuid, integer, text) is
  'Participant sets one locked emoji reaction on the opponent''s hole row after that opponent has posted a gross score (active/waiting matches only).';

revoke all on function public.set_match_hole_reaction(uuid, integer, text) from public;
grant execute on function public.set_match_hole_reaction(uuid, integer, text) to authenticated;
