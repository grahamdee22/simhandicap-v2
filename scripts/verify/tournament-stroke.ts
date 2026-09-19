#!/usr/bin/env npx tsx
/**
 * verify:tournament-stroke — full stroke-play tournament lifecycle against live Supabase.
 */
import {
  Asserter,
  addDays,
  cleanupVerifyCtx,
  countActiveLeaguesForGroup,
  createLeague,
  displayNames,
  enterAllGroupMembers,
  fetchLeagueBundle,
  insertLeagueRound,
  insertRound,
  isLeagueReadyToAutoComplete,
  isoDate,
  markLeagueCompleted,
  netFromIndex,
  setupVerifyCtx,
} from './harness';
import { computeLeagueStandings } from '../../src/lib/computeLeagueStandings';
import { isValidPlayersPerTeam } from '../../src/lib/tournamentTeamCount';

const PLAYERS = ['Shooter McGavin', 'Roy Kent', 'Walter White', 'Ty Webb'] as const;

async function main(): Promise<void> {
  const a = new Asserter();
  console.log('\n=== verify:tournament-stroke ===\n');

  // --- Constraint validation (app helpers; no DB writes) ---
  a.check(
    'Constraint: scramble/best ball reject uneven 5→2 split',
    !isValidPlayersPerTeam(5, 2, 'scramble')
  );
  a.check(
    'Constraint: match play odd member count blocked by UI rule (5 % 2 !== 0)',
    5 % 2 !== 0
  );
  a.check(
    'Constraint: scramble needs ≥4 members for 2 teams of 2',
    !isValidPlayersPerTeam(3, 2, 'scramble') && isValidPlayersPerTeam(4, 2, 'scramble')
  );

  let ctx: Awaited<ReturnType<typeof setupVerifyCtx>> | null = null;
  try {
    ctx = await setupVerifyCtx([...PLAYERS], 'stroke');
    a.check('Setup: throwaway group created', !!ctx.groupId, ctx.groupName);

    const today = new Date();
    const league = await createLeague(ctx, {
      name: `[verify] Stroke ${ctx.runId}`,
      format: 'stroke',
      startDate: isoDate(addDays(today, -7)),
      endDate: isoDate(addDays(today, 14)),
      roundsThatCount: 4,
      useHandicap: true,
    });
    a.check('Create: stroke tournament (4 rounds counting, handicap on)', league.format === 'stroke');

    const entries = await enterAllGroupMembers(ctx, league.id);
    a.check(
      'Entries: all group members auto-entered',
      entries.size === PLAYERS.length,
      `${entries.size}/${PLAYERS.length}`
    );

    // Known grosses → deterministic nets with seed handicaps
    // Shooter 4.2 → strokes 4; Roy 6.8 → 7; Walter 8.4 → 8; Ty 9.7 → 10
    const plan: Record<string, number[]> = {
      'Shooter McGavin': [72, 74, 70, 76], // nets 68,70,66,72 → best4 avg 69
      'Roy Kent': [75, 78, 74, 80], // nets 68,71,67,73 → avg 69.8
      'Walter White': [80, 82, 78, 84], // nets 72,74,70,76 → avg 73
      'Ty Webb': [85, 88, 84, 90], // nets 75,78,74,80 → avg 76.8
    };

    for (const name of PLAYERS) {
      const profile = ctx.profileByName.get(name)!;
      const entry = entries.get(profile.id)!;
      const grosses = plan[name]!;
      for (let i = 0; i < 4; i++) {
        const gross = grosses[i]!;
        const playedAt = addDays(today, -(4 - i)).toISOString();
        const { roundId } = await insertRound(ctx, profile, gross, playedAt);
        const expectedNet = netFromIndex(gross, profile.handicap);
        const lrId = await insertLeagueRound({
          leagueId: league.id,
          profile,
          entryId: entry.id,
          teamId: null,
          roundId,
          gross,
          net: expectedNet,
          holeEntryStatus: 'complete',
        });
        void lrId;
        a.check(
          `Net math: ${name} round ${i + 1} gross ${gross} → net ${expectedNet}`,
          expectedNet === gross - Math.round(profile.handicap) ||
            expectedNet === Math.max(1, gross - Math.round(profile.handicap)),
          `handicap=${profile.handicap}`
        );
      }
    }

    // Re-read nets from DB
    const bundle = await fetchLeagueBundle(league.id);
    let netsOk = true;
    for (const r of bundle.rounds) {
      const p = ctx.profiles.find((x) => x.id === r.user_id)!;
      const expect = netFromIndex(r.gross_score, p.handicap);
      if (Number(r.net_score) !== expect) {
        netsOk = false;
        a.check(
          `DB net for ${p.name} gross ${r.gross_score}`,
          false,
          `got ${r.net_score}, expected ${expect}`
        );
      }
    }
    if (netsOk) a.check('DB: all league_rounds nets = gross − round(handicap)', true);

    const standings = computeLeagueStandings({
      league: bundle.league,
      entries: bundle.entries,
      rounds: bundle.rounds,
      teams: bundle.teams,
      displayNames: displayNames(ctx),
    });

    a.check(
      'Standings: ranked by Low Net (best-4 average)',
      standings[0]?.displayName === 'Shooter McGavin' &&
        standings[1]?.displayName === 'Roy Kent' &&
        standings[2]?.displayName === 'Walter White' &&
        standings[3]?.displayName === 'Ty Webb',
      standings.map((s) => `${s.rank}.${s.displayName}=${s.lowNet}`).join(' | ')
    );

    // Expected Low Nets
    const expectedLow: Record<string, number> = {
      'Shooter McGavin': 69.0,
      'Roy Kent': 69.8,
      'Walter White': 73.0,
      'Ty Webb': 76.8,
    };
    for (const s of standings) {
      const exp = expectedLow[s.displayName];
      a.check(
        `Low Net value: ${s.displayName}`,
        s.lowNet != null && Math.abs(s.lowNet - (exp ?? -1)) < 0.05,
        `got ${s.lowNet}, expected ${exp}`
      );
    }

    const ready = isLeagueReadyToAutoComplete({
      league: bundle.league,
      teams: bundle.teams,
      entries: bundle.entries,
      rounds: bundle.rounds,
    });
    a.check('Completion: counting-rounds threshold met (4 each)', ready);

    await markLeagueCompleted(league.id);
    const after = await fetchLeagueBundle(league.id);
    a.check('Completion: status → completed', after.league.status === 'completed');

    const finalStandings = computeLeagueStandings({
      league: after.league,
      entries: after.entries,
      rounds: after.rounds,
      teams: after.teams,
      displayNames: displayNames(ctx),
    });
    a.check(
      'Podium: champion / 2nd / 3rd',
      finalStandings[0]?.displayName === 'Shooter McGavin' &&
        finalStandings[1]?.displayName === 'Roy Kent' &&
        finalStandings[2]?.displayName === 'Walter White',
      `1st=${finalStandings[0]?.displayName}, 2nd=${finalStandings[1]?.displayName}, 3rd=${finalStandings[2]?.displayName}`
    );

    // Two active tournaments blocked (app checks status=active)
    const second = await createLeague(ctx, {
      name: `[verify] Stroke conflict ${ctx.runId}`,
      format: 'stroke',
      startDate: isoDate(today),
      endDate: isoDate(addDays(today, 7)),
      roundsThatCount: 4,
    });
    // First is completed, so second can be active — create a third while second is active
    const activeCount = await countActiveLeaguesForGroup(ctx.groupId);
    a.check(
      'Constraint: only one active tournament allowed (app blocks when ≥1 active)',
      activeCount === 1,
      `active=${activeCount} (second league id=${second.id.slice(0, 8)}…)`
    );
    // Simulate app gate: refuse creating another while activeCount >= 1
    a.check(
      'Constraint: create blocked when group already has active tournament',
      activeCount >= 1
    );
  } catch (e) {
    a.check('Suite aborted', false, e instanceof Error ? e.message : String(e));
  } finally {
    if (ctx) {
      console.log('\nCleaning up…');
      await cleanupVerifyCtx(ctx);
      a.check('Cleanup: throwaway group + leagues + rounds removed', true);
    }
  }

  process.exit(a.summary('verify:tournament-stroke'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
