#!/usr/bin/env npx tsx
/**
 * verify:match-completion — Social 1v1 Match Play W–L–D via complete_stroke_match RPC.
 * Separate from tournament bracket Match Play (verify:tournament-matchplay).
 */
import {
  Asserter,
  admin,
  cleanupVerifyCtx,
  restRpcPost,
  setupVerifyCtx,
  type LoadedProfile,
  type VerifyCtx,
} from './harness';

type MatchRecord = {
  match_wins: number;
  match_losses: number;
  match_draws: number;
  match_forfeits: number;
};

async function fetchRecord(userId: string): Promise<MatchRecord> {
  const { data, error } = await admin
    .from('profiles')
    .select('match_wins, match_losses, match_draws, match_forfeits')
    .eq('id', userId)
    .single();
  if (error || !data) throw new Error(`profile record: ${error?.message}`);
  return {
    match_wins: Number(data.match_wins) || 0,
    match_losses: Number(data.match_losses) || 0,
    match_draws: Number(data.match_draws) || 0,
    match_forfeits: Number(data.match_forfeits) || 0,
  };
}

async function restoreRecord(userId: string, r: MatchRecord): Promise<void> {
  const { error } = await admin
    .from('profiles')
    .update({
      match_wins: r.match_wins,
      match_losses: r.match_losses,
      match_draws: r.match_draws,
      match_forfeits: r.match_forfeits,
    })
    .eq('id', userId);
  if (error) throw new Error(`restore record: ${error.message}`);
}

async function createActiveDirectMatch(
  p1: LoadedProfile,
  p2: LoadedProfile,
  createdMatchIds: string[]
): Promise<string> {
  const { data, error } = await admin
    .from('matches')
    .insert({
      player_1_id: p1.id,
      player_2_id: p2.id,
      is_open: false,
      course_name: 'Pebble Beach Golf Links',
      player_1_course_rating: 72.1,
      player_1_course_slope: 128,
      player_1_tee: 'White',
      player_2_course_rating: 72.1,
      player_2_course_slope: 128,
      player_2_tee: 'White',
      putting_mode: 'auto_2putt',
      pin_placement: 'sat',
      wind: 'off',
      mulligans: 'none',
      format: 'stroke',
      holes: 18,
      nine_selection: null,
      status: 'active',
      verification_required: false,
      player_1_finished: false,
      player_2_finished: false,
      is_test: true,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`match insert: ${error?.message}`);
  createdMatchIds.push(data.id);
  return data.id as string;
}

async function completeViaRpc(
  token: string,
  matchId: string,
  params: { p1Net: number; p2Net: number; winnerId: string | null }
): Promise<{ ok: boolean; already_complete?: boolean; error?: string }> {
  const { data, error } = await restRpcPost<{
    ok?: boolean;
    already_complete?: boolean;
    error?: string;
  }>(token, 'complete_stroke_match', {
    p_match_id: matchId,
    p_player_1_net: params.p1Net,
    p_player_2_net: params.p2Net,
    p_winner_id: params.winnerId,
  });
  if (error) return { ok: false, error };
  return {
    ok: !!data?.ok,
    already_complete: data?.already_complete,
    error: data?.error,
  };
}

async function abandonViaRpc(
  token: string,
  matchId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await restRpcPost<{ ok?: boolean; error?: string }>(
    token,
    'abandon_match',
    { p_match_id: matchId }
  );
  if (error) return { ok: false, error };
  return { ok: !!data?.ok, error: data?.error };
}

function delta(
  before: MatchRecord,
  after: MatchRecord
): { wins: number; losses: number; draws: number; forfeits: number } {
  return {
    wins: after.match_wins - before.match_wins,
    losses: after.match_losses - before.match_losses,
    draws: after.match_draws - before.match_draws,
    forfeits: after.match_forfeits - before.match_forfeits,
  };
}

async function main(): Promise<void> {
  const a = new Asserter();
  console.log('\n=== verify:match-completion (Social 1v1) ===\n');

  let ctx: VerifyCtx | null = null;
  const createdMatchIds: string[] = [];
  let snapP1: MatchRecord | null = null;
  let snapP2: MatchRecord | null = null;

  try {
    // Shared group (direct challenges require crewmates in the app; we still create one for realism)
    ctx = await setupVerifyCtx(['Shooter McGavin', 'Happy Gilmore'], 'match-completion');
    const p1 = ctx.profileByName.get('Shooter McGavin')!;
    const p2 = ctx.profileByName.get('Happy Gilmore')!;
    const tok1 = ctx.tokens.get(p1.name)!;
    const tok2 = ctx.tokens.get(p2.name)!;

    a.check('Setup: throwaway group + 2 seed accounts', !!ctx.groupId, ctx.groupName);

    snapP1 = await fetchRecord(p1.id);
    snapP2 = await fetchRecord(p2.id);
    a.check(
      'Snapshot: baseline W–L–D loaded',
      true,
      `p1=${snapP1.match_wins}-${snapP1.match_losses}-${snapP1.match_draws}, p2=${snapP2.match_wins}-${snapP2.match_losses}-${snapP2.match_draws}`
    );

    // --- Win for player 1 ---
    const winMatch = await createActiveDirectMatch(p1, p2, createdMatchIds);
    const beforeWin1 = await fetchRecord(p1.id);
    const beforeWin2 = await fetchRecord(p2.id);
    const winRes = await completeViaRpc(tok1, winMatch, {
      p1Net: 70,
      p2Net: 75,
      winnerId: p1.id,
    });
    a.check('Win: complete_stroke_match ok', winRes.ok && !winRes.already_complete, winRes.error);

    const afterWin1 = await fetchRecord(p1.id);
    const afterWin2 = await fetchRecord(p2.id);
    const dWin1 = delta(beforeWin1, afterWin1);
    const dWin2 = delta(beforeWin2, afterWin2);
    a.check('Win: winner match_wins +1', dWin1.wins === 1, `Δwins=${dWin1.wins}`);
    a.check('Win: winner losses/draws unchanged', dWin1.losses === 0 && dWin1.draws === 0);
    a.check('Win: loser match_losses +1', dWin2.losses === 1, `Δlosses=${dWin2.losses}`);
    a.check('Win: loser wins/draws unchanged', dWin2.wins === 0 && dWin2.draws === 0);

    const { data: winRow } = await admin
      .from('matches')
      .select('status, winner_id, player_1_net_score, player_2_net_score')
      .eq('id', winMatch)
      .single();
    a.check(
      'Win: match row complete with winner + nets',
      winRow?.status === 'complete' &&
        winRow.winner_id === p1.id &&
        Number(winRow.player_1_net_score) === 70 &&
        Number(winRow.player_2_net_score) === 75,
      `status=${winRow?.status} winner=${winRow?.winner_id}`
    );

    // Idempotent re-complete
    const again = await completeViaRpc(tok2, winMatch, {
      p1Net: 70,
      p2Net: 75,
      winnerId: p1.id,
    });
    const afterAgain1 = await fetchRecord(p1.id);
    const afterAgain2 = await fetchRecord(p2.id);
    a.check(
      'Idempotent: second complete returns ok (already_complete)',
      again.ok && again.already_complete === true,
      JSON.stringify(again)
    );
    a.check(
      'Idempotent: no double-count on W–L–D',
      afterAgain1.match_wins === afterWin1.match_wins &&
        afterAgain2.match_losses === afterWin2.match_losses
    );

    // --- Draw ---
    const drawMatch = await createActiveDirectMatch(p1, p2, createdMatchIds);
    const beforeDraw1 = await fetchRecord(p1.id);
    const beforeDraw2 = await fetchRecord(p2.id);
    const drawRes = await completeViaRpc(tok2, drawMatch, {
      p1Net: 72,
      p2Net: 72,
      winnerId: null,
    });
    a.check('Draw: complete_stroke_match ok', drawRes.ok, drawRes.error);
    const afterDraw1 = await fetchRecord(p1.id);
    const afterDraw2 = await fetchRecord(p2.id);
    a.check('Draw: player1 match_draws +1', delta(beforeDraw1, afterDraw1).draws === 1);
    a.check('Draw: player2 match_draws +1', delta(beforeDraw2, afterDraw2).draws === 1);
    a.check(
      'Draw: wins/losses unchanged for both',
      delta(beforeDraw1, afterDraw1).wins === 0 &&
        delta(beforeDraw1, afterDraw1).losses === 0 &&
        delta(beforeDraw2, afterDraw2).wins === 0 &&
        delta(beforeDraw2, afterDraw2).losses === 0
    );
    const { data: drawRow } = await admin
      .from('matches')
      .select('status, winner_id')
      .eq('id', drawMatch)
      .single();
    a.check(
      'Draw: match row complete with null winner',
      drawRow?.status === 'complete' && drawRow.winner_id == null
    );

    // --- Win for player 2 ---
    const win2Match = await createActiveDirectMatch(p1, p2, createdMatchIds);
    const beforeP2Win1 = await fetchRecord(p1.id);
    const beforeP2Win2 = await fetchRecord(p2.id);
    const win2Res = await completeViaRpc(tok1, win2Match, {
      p1Net: 80,
      p2Net: 71,
      winnerId: p2.id,
    });
    a.check('P2 win: complete_stroke_match ok', win2Res.ok, win2Res.error);
    a.check('P2 win: p2 match_wins +1', delta(beforeP2Win2, await fetchRecord(p2.id)).wins === 1);
    a.check('P2 win: p1 match_losses +1', delta(beforeP2Win1, await fetchRecord(p1.id)).losses === 1);

    // --- Abandon / forfeit (separate path) ---
    const abandonMatchId = await createActiveDirectMatch(p1, p2, createdMatchIds);
    const beforeAb1 = await fetchRecord(p1.id);
    const beforeAb2 = await fetchRecord(p2.id);
    const abRes = await abandonViaRpc(tok1, abandonMatchId);
    a.check('Abandon: abandon_match ok', abRes.ok, abRes.error);
    const afterAb1 = await fetchRecord(p1.id);
    const afterAb2 = await fetchRecord(p2.id);
    const dAb1 = delta(beforeAb1, afterAb1);
    const dAb2 = delta(beforeAb2, afterAb2);
    a.check(
      'Abandon: abandoner losses +1 and forfeits +1',
      dAb1.losses === 1 && dAb1.forfeits === 1,
      `Δlosses=${dAb1.losses} Δforfeits=${dAb1.forfeits}`
    );
    a.check(
      'Abandon: opponent record unchanged',
      dAb2.wins === 0 && dAb2.losses === 0 && dAb2.draws === 0 && dAb2.forfeits === 0
    );
    a.check(
      'Abandon: does not increment match_wins for opponent',
      dAb2.wins === 0
    );

    // Sanity: Social path ≠ tournament bracket (no league_match_pairings involved)
    a.check(
      'Scope: exercised complete_stroke_match on matches table (Social 1v1), not league pairings',
      true
    );
  } catch (e) {
    a.check('Suite aborted', false, e instanceof Error ? e.message : String(e));
  } finally {
    // Restore seed profile counters so reruns stay clean
    if (ctx && snapP1 && snapP2) {
      const p1 = ctx.profileByName.get('Shooter McGavin')!;
      const p2 = ctx.profileByName.get('Happy Gilmore')!;
      try {
        await restoreRecord(p1.id, snapP1);
        await restoreRecord(p2.id, snapP2);
        a.check('Cleanup: restored baseline W–L–D on seed profiles', true);
      } catch (e) {
        a.check(
          'Cleanup: restore W–L–D',
          false,
          e instanceof Error ? e.message : String(e)
        );
      }
    }
    if (createdMatchIds.length > 0) {
      const { error } = await admin.from('matches').delete().in('id', createdMatchIds);
      a.check(
        'Cleanup: deleted test matches',
        !error,
        error?.message ?? `${createdMatchIds.length} matches`
      );
    }
    if (ctx) {
      await cleanupVerifyCtx(ctx);
      a.check('Cleanup: throwaway group removed', true);
    }
  }

  process.exit(a.summary('verify:match-completion'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
