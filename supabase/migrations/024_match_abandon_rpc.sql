-- Match Play: atomic abandon — match row + abandoner profile counters only (opponent unchanged).

create or replace function public.abandon_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  update public.matches
  set
    status = 'abandoned',
    abandoned_by_id = uid
  where id = p_match_id
    and status in ('active', 'waiting')
    and player_2_id is not null
    and (player_1_id = uid or player_2_id = uid)
    and abandoned_by_id is null;

  get diagnostics n = row_count;

  if n = 0 then
    return jsonb_build_object('ok', false, 'error', 'Match cannot be abandoned.');
  end if;

  update public.profiles
  set
    match_losses = match_losses + 1,
    match_forfeits = match_forfeits + 1
  where id = uid;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.abandon_match(uuid) is
  'Participant abandons an active/waiting stroke match: sets abandoned, increments abandoner match_losses + match_forfeits only.';

revoke all on function public.abandon_match(uuid) from public;
grant execute on function public.abandon_match(uuid) to authenticated;
