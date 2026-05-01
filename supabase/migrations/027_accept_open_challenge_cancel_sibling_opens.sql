-- When an open challenge is claimed, remove the poster's other unclaimed open listings (same transaction).

create or replace function public.accept_open_challenge(
  p_match_id uuid,
  p_player_2_tee text,
  p_player_2_course_rating numeric,
  p_player_2_course_slope integer,
  p_player_2_settings_photo_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n int;
  st text;
  op boolean;
  p2 uuid;
  p1 uuid;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  update public.matches
  set
    player_2_id = uid,
    player_2_tee = p_player_2_tee,
    player_2_course_rating = p_player_2_course_rating,
    player_2_course_slope = p_player_2_course_slope,
    player_2_settings_photo_url = nullif(trim(p_player_2_settings_photo_url), ''),
    status = 'active'
  where id = p_match_id
    and is_open = true
    and status = 'open'
    and player_2_id is null
    and player_1_id is distinct from uid;

  get diagnostics n = row_count;

  if n > 0 then
    delete from public.matches
    where is_open = true
      and status = 'open'
      and player_2_id is null
      and id <> p_match_id
      and player_1_id = (select m.player_1_id from public.matches m where m.id = p_match_id);

    return jsonb_build_object('ok', true);
  end if;

  select m.status, m.is_open, m.player_2_id, m.player_1_id
    into st, op, p2, p1
  from public.matches m
  where m.id = p_match_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Match not found.');
  end if;

  if p1 = uid then
    return jsonb_build_object('ok', false, 'error', 'You cannot accept your own challenge.');
  end if;

  if op and st = 'open' and p2 is not null then
    return jsonb_build_object('ok', false, 'error', 'Challenge already taken.');
  end if;

  return jsonb_build_object('ok', false, 'error', 'This challenge is no longer available.');
end;
$$;

comment on function public.accept_open_challenge(uuid, text, numeric, integer, text) is
  'Claims an open stroke challenge (first acceptor wins). On success, deletes the poster''s other unclaimed open challenges in the same transaction.';
