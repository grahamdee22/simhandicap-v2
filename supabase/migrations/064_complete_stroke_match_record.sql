-- Social Match Play: when a stroke match completes, update both players' W–L–D atomically.
-- (profiles RLS only allows updating own row; abandon_match already uses a definer RPC.)

create or replace function public.complete_stroke_match(
  p_match_id uuid,
  p_player_1_net numeric,
  p_player_2_net numeric,
  p_winner_id uuid
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
  v_loser uuid;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  select * into m from public.matches where id = p_match_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Match not found');
  end if;

  if m.player_2_id is null then
    return jsonb_build_object('ok', false, 'error', 'Match has no opponent');
  end if;

  if uid is distinct from m.player_1_id and uid is distinct from m.player_2_id then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if p_winner_id is not null
     and p_winner_id is distinct from m.player_1_id
     and p_winner_id is distinct from m.player_2_id then
    return jsonb_build_object('ok', false, 'error', 'Invalid winner');
  end if;

  -- Idempotent: only the first transition from active/waiting → complete awards record.
  update public.matches
  set
    status = 'complete',
    player_1_net_score = p_player_1_net,
    player_2_net_score = p_player_2_net,
    winner_id = p_winner_id,
    player_1_finished = true,
    player_2_finished = true
  where id = p_match_id
    and status in ('active', 'waiting')
    and player_2_id is not null
    and (player_1_id = uid or player_2_id = uid);

  get diagnostics n = row_count;

  if n = 0 then
    -- Already complete (or not eligible): return current row without double-counting.
    if m.status = 'complete' then
      return jsonb_build_object('ok', true, 'already_complete', true);
    end if;
    return jsonb_build_object('ok', false, 'error', 'Match cannot be completed.');
  end if;

  if p_winner_id is null then
    update public.profiles
    set match_draws = match_draws + 1
    where id in (m.player_1_id, m.player_2_id);
  else
    v_loser := case
      when p_winner_id = m.player_1_id then m.player_2_id
      else m.player_1_id
    end;
    update public.profiles
    set match_wins = match_wins + 1
    where id = p_winner_id;
    update public.profiles
    set match_losses = match_losses + 1
    where id = v_loser;
  end if;

  return jsonb_build_object('ok', true, 'already_complete', false);
end;
$$;

comment on function public.complete_stroke_match(uuid, numeric, numeric, uuid) is
  'Participant finalizes an active/waiting stroke match: sets complete + nets + winner, increments W–L–D once.';

revoke all on function public.complete_stroke_match(uuid, numeric, numeric, uuid) from public;
grant execute on function public.complete_stroke_match(uuid, numeric, numeric, uuid) to authenticated;
