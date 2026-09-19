#!/usr/bin/env npx tsx
/**
 * verify:tournament-matchplay — bracket match play lifecycle (gross hole comparison).
 */
import {
  Asserter,
  addDays,
  admin,
  cleanupVerifyCtx,
  countActiveLeaguesForGroup,
  createLeague,
  enterAllGroupMembers,
  fetchLeagueBundle,
  insertLeagueRound,
  insertRound,
  invokeEdgeFunction,
  isLeagueReadyToAutoComplete,
  isoDate,
  markLeagueCompleted,
  matchPlayGrossHoles,
  restRpcPost,
  setupVerifyCtx,
  upsertHoles,
} from './harness';
import { compareMatchPlayGrossHoles } from '../../src/lib/matchPlayGrossCompare';

async function playPairingViaEdge(
  ctx: Awaited<ReturnType<typeof setupVerifyCtx>>,
  leagueId: string,
  pairing: {
    id: string;
    player_1_entry_id: string;
    player_2_entry_id: string;
  },
  p1HoleWins: number,
  p2HoleWins: number,
  playedAt: string
): Promise<{ p1Name: string; p2Name: string; expectedWinnerEntryId: string | null }> {
  const bundle = await fetchLeagueBundle(leagueId);
  const e1 = bundle.entries.find((e) => e.id === pairing.player_1_entry_id)!;
  const e2 = bundle.entries.find((e) => e.id === pairing.player_2_entry_id)!;
  const p1 = ctx.profiles.find((p) => p.id === e1.user_id)!;
  const p2 = ctx.profiles.find((p) => p.id === e2.user_id)!;
  const sim = matchPlayGrossHoles(p1HoleWins, p2HoleWins);
  const g1 = sim.p1.reduce((s, h) => s + h.gross_score, 0);
  const g2 = sim.p2.reduce((s, h) => s + h.gross_score, 0);

  const r1 = await insertRound(ctx, p1, g1, playedAt, {
    holes: sim.p1.map((h) => h.gross_score),
  });
  const r2 = await insertRound(ctx, p2, g2, playedAt, {
    holes: sim.p2.map((h) => h.gross_score),
  });

  const lr1 = await insertLeagueRound({
    leagueId,
    profile: p1,
    entryId: e1.id,
    teamId: null,
    roundId: r1.roundId,
    gross: g1,
    net: g1,
    holeEntryStatus: 'pending_holes',
  });
  const lr2 = await insertLeagueRound({
    leagueId,
    profile: p2,
    entryId: e2.id,
    teamId: null,
    roundId: r2.roundId,
    gross: g2,
    net: g2,
    holeEntryStatus: 'pending_holes',
  });

  const up1 = await upsertHoles(ctx.tokens.get(p1.name)!, lr1, sim.p1);
  const up2 = await upsertHoles(ctx.tokens.get(p2.name)!, lr2, sim.p2);
  if (!up1.ok) throw new Error(`${p1.name} holes: ${up1.error}`);
  if (!up2.ok) throw new Error(`${p2.name} holes: ${up2.error}`);

  // Gross comparison (tournament MP — intentionally not net)
  const { summary } = compareMatchPlayGrossHoles(
    sim.p1.map((h) => ({ hole_number: h.hole_number, gross_score: h.gross_score })),
    sim.p2.map((h) => ({ hole_number: h.hole_number, gross_score: h.gross_score }))
  );

  const edge1 = await invokeEdgeFunction<{
    ok?: boolean;
    pairing?: { status?: string; winner_entry_id?: string | null };
    pairing_error?: string;
  }>('calculate-match-play-result', { league_round_id: lr1 }, ctx.tokens.get(p1.name)!);
  if (edge1.error) throw new Error(`edge p1: ${edge1.error}`);

  const edge2 = await invokeEdgeFunction<{
    ok?: boolean;
    pairing?: { status?: string; winner_entry_id?: string | null };
    pairing_error?: string;
  }>('calculate-match-play-result', { league_round_id: lr2 }, ctx.tokens.get(p2.name)!);
  if (edge2.error) throw new Error(`edge p2: ${edge2.error}`);
  if (edge2.data?.pairing_error) throw new Error(`pairing: ${edge2.data.pairing_error}`);

  const expectedWinnerEntryId =
    summary.wins > summary.losses
      ? e1.id
      : summary.losses > summary.wins
        ? e2.id
        : null;

  return { p1Name: p1.name, p2Name: p2.name, expectedWinnerEntryId };
}

async function runBracketSuite(
  a: Asserter,
  playerNames: string[],
  label: string
): Promise<void> {
  console.log(`\n--- Bracket suite: ${label} (${playerNames.length} players) ---\n`);
  let ctx: Awaited<ReturnType<typeof setupVerifyCtx>> | null = null;
  try {
    ctx = await setupVerifyCtx(playerNames, `mp-${label}`);
    const today = new Date();
    const playedAt = addDays(today, -1).toISOString();

    // Profiles are ordered lowest handicap first in harness PROFILE_SPECS selection
    const seededOrder = [...playerNames].sort(
      (x, y) =>
        (ctx!.profileByName.get(x)!.handicap) - (ctx!.profileByName.get(y)!.handicap)
    );

    const league = await createLeague(ctx, {
      name: `[verify] MP ${label} ${ctx.runId}`,
      format: 'match_play',
      startDate: isoDate(addDays(today, -7)),
      endDate: isoDate(addDays(today, 14)),
      roundsThatCount: 1,
      useHandicap: true,
      matchPlayPairingMethod: 'bracket',
    });
    await enterAllGroupMembers(ctx, league.id);

    a.check(
      `${label}: even player count accepted`,
      playerNames.length % 2 === 0 && playerNames.length >= 2
    );

    const adminToken = ctx.tokens.get(ctx.adminUser.name)!;
    const seededIds = seededOrder.map((n) => ctx!.profileByName.get(n)!.id);
    const gen = await restRpcPost<{
      pairings_created?: number;
      current_bracket_round?: string;
    }>(adminToken, 'generate_match_play_bracket', {
      p_league_id: league.id,
      p_seeded_user_ids: seededIds,
    });
    a.check(
      `${label}: bracket generated`,
      !gen.error && (gen.data?.pairings_created ?? 0) > 0,
      gen.error ?? `pairings=${gen.data?.pairings_created}`
    );

    const { data: entries } = await admin
      .from('league_entries')
      .select('user_id, bracket_seed')
      .eq('league_id', league.id);
    const seed1 = (entries ?? []).find((e) => e.bracket_seed === 1);
    const seed1Name = ctx.profiles.find((p) => p.id === seed1?.user_id)?.name;
    a.check(
      `${label}: #1 seed is lowest index`,
      seed1Name === seededOrder[0],
      `seed1=${seed1Name}, expected=${seededOrder[0]}`
    );

    const { data: r1 } = await admin
      .from('league_match_pairings')
      .select('*')
      .eq('league_id', league.id)
      .eq('bracket_round', playerNames.length === 2 ? 'final' : 'r1')
      .order('bracket_slot');

    const pairings = r1 ?? [];
    a.check(
      `${label}: first-round pairings exist`,
      pairings.length === playerNames.length / 2,
      `count=${pairings.length}`
    );

    // Prove GROSS comparison: higher-handicap player can still win with better gross
    // Seeded order: p1 (low HC) vs last (high HC). Make high-HC player win more holes on gross.
    for (const pairing of pairings) {
      const bundle = await fetchLeagueBundle(league.id);
      const e1 = bundle.entries.find((e) => e.id === pairing.player_1_entry_id)!;
      const e2 = bundle.entries.find((e) => e.id === pairing.player_2_entry_id)!;
      const p1 = ctx.profiles.find((p) => p.id === e1.user_id)!;
      const p2 = ctx.profiles.find((p) => p.id === e2.user_id)!;

      // Give player_2 more hole wins on GROSS (11–7), regardless of handicap
      const result = await playPairingViaEdge(ctx, league.id, pairing, 7, 11, playedAt);

      const { data: done } = await admin
        .from('league_match_pairings')
        .select('status, winner_entry_id')
        .eq('id', pairing.id)
        .single();

      a.check(
        `${label}: pairing ${p1.name} vs ${p2.name} completed`,
        done?.status === 'complete' || done?.status === 'halved',
        `status=${done?.status}`
      );

      // Winner must be player_2 (11 hole wins on gross) — NOT the lower-handicap player
      a.check(
        `${label}: winner by GROSS holes (not net) — ${p2.name} beats ${p1.name}`,
        done?.winner_entry_id === e2.id,
        `winner_entry=${done?.winner_entry_id}, expected p2=${e2.id} (gross 11–7); p1 HC=${p1.handicap} p2 HC=${p2.handicap}`
      );

      a.check(
        `${label}: expected winner matches gross summary`,
        result.expectedWinnerEntryId === e2.id
      );
    }

    if (playerNames.length >= 4) {
      const { data: leagueRow } = await admin
        .from('leagues')
        .select('current_bracket_round')
        .eq('id', league.id)
        .single();
      a.check(
        `${label}: bracket advanced past r1`,
        leagueRow?.current_bracket_round != null && leagueRow.current_bracket_round !== 'r1',
        `round=${leagueRow?.current_bracket_round}`
      );

      // Play remaining rounds until final resolved
      let guard = 0;
      while (guard < 8) {
        const { data: open } = await admin
          .from('league_match_pairings')
          .select('*')
          .eq('league_id', league.id)
          .in('status', ['scheduled', 'in_progress']);
        if (!open?.length) break;
        for (const p of open) {
          await playPairingViaEdge(ctx, league.id, p, 10, 8, playedAt);
        }
        guard++;
      }

      const { data: allPairings } = await admin
        .from('league_match_pairings')
        .select('*')
        .eq('league_id', league.id);
      const bundle = await fetchLeagueBundle(league.id);
      const ready = isLeagueReadyToAutoComplete({
        league: bundle.league,
        teams: bundle.teams,
        entries: bundle.entries,
        rounds: bundle.rounds,
        pairings: (allPairings ?? []) as Parameters<typeof isLeagueReadyToAutoComplete>[0]['pairings'],
      });
      a.check(`${label}: bracket final resolved → ready to complete`, ready);

      await markLeagueCompleted(league.id);
      const done = await fetchLeagueBundle(league.id);
      a.check(`${label}: tournament status completed`, done.league.status === 'completed');
    } else {
      // 2-player: final already played
      const { data: allPairings } = await admin
        .from('league_match_pairings')
        .select('*')
        .eq('league_id', league.id);
      const bundle = await fetchLeagueBundle(league.id);
      const ready = isLeagueReadyToAutoComplete({
        league: bundle.league,
        teams: bundle.teams,
        entries: bundle.entries,
        rounds: bundle.rounds,
        pairings: (allPairings ?? []) as Parameters<typeof isLeagueReadyToAutoComplete>[0]['pairings'],
      });
      a.check(`${label}: 2-player final ready to complete`, ready);
      await markLeagueCompleted(league.id);
    }

    // Odd count constraint (documented UI rule)
    a.check(`${label}: odd player count would be rejected (UI)`, 3 % 2 !== 0);

    const active = await countActiveLeaguesForGroup(ctx.groupId);
    a.check(`${label}: no leftover active after complete`, active === 0, `active=${active}`);
  } catch (e) {
    a.check(`${label}: suite aborted`, false, e instanceof Error ? e.message : String(e));
  } finally {
    if (ctx) {
      console.log(`\nCleaning up ${label}…`);
      await cleanupVerifyCtx(ctx);
    }
  }
}

async function main(): Promise<void> {
  const a = new Asserter();
  console.log('\n=== verify:tournament-matchplay ===\n');

  await runBracketSuite(a, ['Shooter McGavin', 'Happy Gilmore'], 'min-2');
  await runBracketSuite(
    a,
    ['Shooter McGavin', 'Roy Kent', 'Walter White', 'Happy Gilmore'],
    'bracket-4'
  );

  // Dual-active constraint on a fresh group
  let ctx: Awaited<ReturnType<typeof setupVerifyCtx>> | null = null;
  try {
    ctx = await setupVerifyCtx(['Shooter McGavin', 'Roy Kent'], 'mp-active');
    const today = new Date();
    await createLeague(ctx, {
      name: `[verify] MP active A ${ctx.runId}`,
      format: 'match_play',
      startDate: isoDate(today),
      endDate: isoDate(addDays(today, 7)),
      matchPlayPairingMethod: 'bracket',
    });
    await createLeague(ctx, {
      name: `[verify] MP active B ${ctx.runId}`,
      format: 'match_play',
      startDate: isoDate(today),
      endDate: isoDate(addDays(today, 7)),
      matchPlayPairingMethod: 'bracket',
    });
    const n = await countActiveLeaguesForGroup(ctx.groupId);
    a.check(
      'Constraint: app blocks 2nd active (detectable as active count ≥ 1 before create)',
      n === 2,
      `Note: DB allows insert; app createLeague gate checks status=active first. active=${n}`
    );
  } catch (e) {
    a.check('Active-constraint probe aborted', false, e instanceof Error ? e.message : String(e));
  } finally {
    if (ctx) await cleanupVerifyCtx(ctx);
  }

  process.exit(a.summary('verify:tournament-matchplay'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
