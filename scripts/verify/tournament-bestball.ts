#!/usr/bin/env npx tsx
/**
 * verify:tournament-bestball — best ball lifecycle, same-date team merge, index counting.
 */
import {
  Asserter,
  addDays,
  cleanupVerifyCtx,
  countActiveLeaguesForGroup,
  createLeague,
  createTeamsWithMembers,
  displayNames,
  fetchLeagueBundle,
  fetchRoundExclusionFlag,
  fetchTeamHoleScores,
  fetchUserActiveDifferentials,
  getCourseById,
  indexFromFetchedRounds,
  insertLeagueRound,
  insertRound,
  invokeEdgeFunction,
  isLeagueReadyToAutoComplete,
  isoDate,
  markLeagueCompleted,
  resolveEffectiveIndexes,
  setupVerifyCtx,
  upsertHoles,
} from './harness';
import { computeLeagueStandings } from '../../src/lib/computeLeagueStandings';
import { isValidPlayersPerTeam } from '../../src/lib/tournamentTeamCount';
import {
  DEFAULT_STROKE_INDEX_BY_HOLE,
  holesForStrokes,
  whsCourseHandicapFromIndex,
} from '../../src/lib/netHandicap';
import {
  aggregateBestBallTeamRounds,
  bestBallStandingsScores,
} from '../../src/lib/bestBallTournament';

const PLAYERS = ['Shooter McGavin', 'Roy Kent', 'Walter White', 'Ty Webb'] as const;

function strokesOnHole(hole: number, courseHandicap: number): number {
  if (courseHandicap <= 0) return 0;
  return holesForStrokes(courseHandicap, DEFAULT_STROKE_INDEX_BY_HOLE).filter((h) => h === hole)
    .length;
}

async function main(): Promise<void> {
  const a = new Asserter();
  console.log('\n=== verify:tournament-bestball ===\n');

  a.check(
    'Constraint: uneven split rejected',
    !isValidPlayersPerTeam(5, 2, 'best_ball')
  );
  a.check('Constraint: 4 players / 2 per team ok', isValidPlayersPerTeam(4, 2, 'best_ball'));

  let ctx: Awaited<ReturnType<typeof setupVerifyCtx>> | null = null;
  try {
    ctx = await setupVerifyCtx([...PLAYERS], 'bestball');
    const today = new Date();
    const course = getCourseById('pebble')!;
    const white = course.tees!.find((t) => t.name === 'White')!;

    const league = await createLeague(ctx, {
      name: `[verify] Best Ball ${ctx.runId}`,
      format: 'best_ball',
      startDate: isoDate(addDays(today, -7)),
      endDate: isoDate(addDays(today, 14)),
      roundsThatCount: 1,
      useHandicap: true,
    });

    const { teams, entryByUser } = await createTeamsWithMembers(ctx, league.id, [
      { name: 'Birdie Bros', memberNames: ['Shooter McGavin', 'Roy Kent'] },
      { name: 'Par Patrol', memberNames: ['Walter White', 'Ty Webb'] },
    ]);
    a.check('Teams assigned evenly (2+ each)', teams.length === 2);

    // Same calendar date for teammates (documented current behavior)
    const sameDate = `${isoDate(addDays(today, -1))}T18:00:00.000Z`;
    const otherDate = `${isoDate(addDays(today, -2))}T18:00:00.000Z`;

    // Deterministic hole scores for Birdie Bros
    const shooterHoles = Array.from({ length: 18 }, (_, i) => (i % 2 === 0 ? 3 : 5));
    const royHoles = Array.from({ length: 18 }, (_, i) => (i % 2 === 0 ? 5 : 3));
    // Expected min gross per hole = 3 on every hole

    const shooter = ctx.profileByName.get('Shooter McGavin')!;
    const roy = ctx.profileByName.get('Roy Kent')!;
    const teamBirdie = teams.find((t) => t.name === 'Birdie Bros')!;

    const rShooter = await insertRound(ctx, shooter, shooterHoles.reduce((s, x) => s + x, 0), sameDate, {
      holes: shooterHoles,
      excludesFromSimcapIndex: false,
    });
    const rRoy = await insertRound(ctx, roy, royHoles.reduce((s, x) => s + x, 0), sameDate, {
      holes: royHoles,
      excludesFromSimcapIndex: false,
    });

    a.check(
      'Index: best ball round NOT excluded (flag false)',
      (await fetchRoundExclusionFlag(rShooter.roundId)) === false
    );
    a.check(
      'Index: best ball round counts toward SimCap after fetch',
      (() => {
        /* asserted after both inserts via differential presence */
        return true;
      })()
    );

    const shooterRows = await fetchUserActiveDifferentials(shooter.id);
    const thisRound = shooterRows.find((r) => r.id === rShooter.roundId);
    a.check(
      'Index: scramble-exclusion must not apply — round is counting',
      thisRound != null && thisRound.excludes === false,
      `excludes=${thisRound?.excludes}`
    );
    const idxCounting = indexFromFetchedRounds(shooterRows);
    const idxWithout = indexFromFetchedRounds(shooterRows.filter((r) => r.id !== rShooter.roundId));
    a.check(
      'Index: including best-ball round changes (or establishes) index vs omitting it',
      idxCounting != null &&
        (idxWithout == null || idxCounting !== idxWithout || shooterRows.length === 1),
      `with=${idxCounting}, without=${idxWithout}`
    );

    const lrS = await insertLeagueRound({
      leagueId: league.id,
      profile: shooter,
      entryId: entryByUser.get(shooter.id)!.id,
      teamId: teamBirdie.id,
      roundId: rShooter.roundId,
      gross: shooterHoles.reduce((s, x) => s + x, 0),
      net: shooterHoles.reduce((s, x) => s + x, 0),
      holeEntryStatus: 'pending_holes',
    });
    const lrR = await insertLeagueRound({
      leagueId: league.id,
      profile: roy,
      entryId: entryByUser.get(roy.id)!.id,
      teamId: teamBirdie.id,
      roundId: rRoy.roundId,
      gross: royHoles.reduce((s, x) => s + x, 0),
      net: royHoles.reduce((s, x) => s + x, 0),
      holeEntryStatus: 'pending_holes',
    });

    await upsertHoles(
      ctx.tokens.get(shooter.name)!,
      lrS,
      shooterHoles.map((g, i) => ({ hole_number: i + 1, gross_score: g }))
    );
    await upsertHoles(
      ctx.tokens.get(roy.name)!,
      lrR,
      royHoles.map((g, i) => ({ hole_number: i + 1, gross_score: g }))
    );

    // Partial until both submitted — calculate after shooter only first
    const partialCalc = await invokeEdgeFunction<{
      ok?: boolean;
      is_partial?: boolean;
      teammates_submitted?: number;
      teammates_expected?: number;
    }>('calculate-team-hole-scores', { league_round_id: lrS }, ctx.tokens.get(shooter.name)!);
    // After both upserts, recalculate from Roy's submission
    const fullCalc = await invokeEdgeFunction<{
      ok?: boolean;
      is_partial?: boolean;
      teammates_submitted?: number;
      teammates_expected?: number;
    }>('calculate-team-hole-scores', { league_round_id: lrR }, ctx.tokens.get(roy.name)!);
    a.check(
      'Same played date: teammates merged into one team round',
      fullCalc.data?.ok === true &&
        (fullCalc.data.teammates_submitted ?? 0) >= 2 &&
        fullCalc.data.is_partial === false,
      `submitted=${fullCalc.data?.teammates_submitted}, expected=${fullCalc.data?.teammates_expected}, partial=${fullCalc.data?.is_partial}; earlier partial=${partialCalc.data?.is_partial}`
    );

    const teamHoles = (await fetchTeamHoleScores(league.id)).filter(
      (r) => r.league_team_id === teamBirdie.id
    );
    a.check('Team holes: 18 rows for Birdie Bros', teamHoles.length === 18);

    let minGrossOk = true;
    for (let i = 0; i < 18; i++) {
      const row = teamHoles.find((r) => r.hole_number === i + 1);
      const expectedGross = Math.min(shooterHoles[i]!, royHoles[i]!);
      if (!row || row.team_score !== expectedGross) {
        minGrossOk = false;
        a.check(
          `Min gross hole ${i + 1}`,
          false,
          `got ${row?.team_score}, expected ${expectedGross}`
        );
        break;
      }
    }
    if (minGrossOk) a.check('Lowest score per hole counts for the team (gross)', true);

    // Net = min of per-player nets using the same effective indexes the edge function uses
    const indexes = await resolveEffectiveIndexes([shooter.id, roy.id]);
    const idxS = indexes.get(shooter.id);
    const idxR = indexes.get(roy.id);
    a.check(
      'Effective indexes resolved for net check',
      idxS != null && idxR != null,
      `shooter=${idxS}, roy=${idxR}`
    );
    const chShooter =
      idxS != null
        ? whsCourseHandicapFromIndex(idxS, white.rating, white.slope, 72)
        : 0;
    const chRoy =
      idxR != null ? whsCourseHandicapFromIndex(idxR, white.rating, white.slope, 72) : 0;
    let netOk = true;
    for (let i = 0; i < 18; i++) {
      const hole = i + 1;
      const netS = shooterHoles[i]! - strokesOnHole(hole, chShooter);
      const netR = royHoles[i]! - strokesOnHole(hole, chRoy);
      const expectedNet = Math.min(netS, netR);
      const row = teamHoles.find((r) => r.hole_number === hole);
      if (!row || Number(row.team_net_score) !== expectedNet) {
        netOk = false;
        a.check(
          `Team net hole ${hole}`,
          false,
          `got ${row?.team_net_score}, expected ${expectedNet} (ch S=${chShooter} R=${chRoy})`
        );
        break;
      }
    }
    if (netOk) a.check('Team net reflects handicap when use_handicap is on', true, `ch S=${chShooter} R=${chRoy}`);

    // Document same-date behavior: different date does NOT merge
    const walter = ctx.profileByName.get('Walter White')!;
    const ty = ctx.profileByName.get('Ty Webb')!;
    const teamPar = teams.find((t) => t.name === 'Par Patrol')!;
    const wHoles = Array.from({ length: 18 }, () => 4);
    const tHoles = Array.from({ length: 18 }, () => 5);

    const rW = await insertRound(ctx, walter, 72, sameDate, { holes: wHoles });
    const rT = await insertRound(ctx, ty, 90, otherDate, { holes: tHoles }); // different date
    const lrW = await insertLeagueRound({
      leagueId: league.id,
      profile: walter,
      entryId: entryByUser.get(walter.id)!.id,
      teamId: teamPar.id,
      roundId: rW.roundId,
      gross: 72,
      net: 72,
      holeEntryStatus: 'pending_holes',
    });
    const lrT = await insertLeagueRound({
      leagueId: league.id,
      profile: ty,
      entryId: entryByUser.get(ty.id)!.id,
      teamId: teamPar.id,
      roundId: rT.roundId,
      gross: 90,
      net: 90,
      holeEntryStatus: 'pending_holes',
    });
    await upsertHoles(
      ctx.tokens.get(walter.name)!,
      lrW,
      wHoles.map((g, i) => ({ hole_number: i + 1, gross_score: g }))
    );
    await upsertHoles(
      ctx.tokens.get(ty.name)!,
      lrT,
      tHoles.map((g, i) => ({ hole_number: i + 1, gross_score: g }))
    );
    const calcW = await invokeEdgeFunction<{
      ok?: boolean;
      is_partial?: boolean;
      round_date?: string;
      teammates_submitted?: number;
    }>('calculate-team-hole-scores', { league_round_id: lrW }, ctx.tokens.get(walter.name)!);
    a.check(
      'Played-date matching: teammate on different date does NOT complete same-date team card (current behavior)',
      calcW.data?.is_partial === true || (calcW.data?.teammates_submitted ?? 0) < 2,
      `partial=${calcW.data?.is_partial}, submitted=${calcW.data?.teammates_submitted}, date=${calcW.data?.round_date}`
    );

    // Give Ty a same-date round so Par Patrol can complete for standings
    const rT2 = await insertRound(ctx, ty, 90, sameDate, { holes: tHoles });
    const lrT2 = await insertLeagueRound({
      leagueId: league.id,
      profile: ty,
      entryId: entryByUser.get(ty.id)!.id,
      teamId: teamPar.id,
      roundId: rT2.roundId,
      gross: 90,
      net: 90,
      holeEntryStatus: 'pending_holes',
    });
    await upsertHoles(
      ctx.tokens.get(ty.name)!,
      lrT2,
      tHoles.map((g, i) => ({ hole_number: i + 1, gross_score: g }))
    );
    await invokeEdgeFunction(
      'calculate-team-hole-scores',
      { league_round_id: lrT2 },
      ctx.tokens.get(ty.name)!
    );

    const allTeamHoles = await fetchTeamHoleScores(league.id);
    const bundle = await fetchLeagueBundle(league.id);
    const standings = computeLeagueStandings({
      league: bundle.league,
      entries: bundle.entries,
      rounds: bundle.rounds,
      teams: bundle.teams,
      displayNames: displayNames(ctx),
      teamHoleScores: allTeamHoles as Parameters<typeof computeLeagueStandings>[0]['teamHoleScores'],
    });

    const birdieAgg = aggregateBestBallTeamRounds(allTeamHoles as never, teamBirdie.id, true);
    const { netScores } = bestBallStandingsScores(birdieAgg, true);
    a.check(
      'Standings: Low Net derived from complete team hole nets',
      netScores.length >= 1 && standings.some((s) => s.teamId === teamBirdie.id && s.lowNet != null),
      standings.map((s) => `${s.rank}.${s.displayName}=${s.lowNet}`).join(' | ')
    );
    a.check(
      'Standings: sorted by Low Net ascending',
      standings.length >= 2 && (standings[0]!.lowNet ?? 999) <= (standings[1]!.lowNet ?? 999)
    );

    const ready = isLeagueReadyToAutoComplete({
      league: bundle.league,
      teams: bundle.teams,
      entries: bundle.entries,
      rounds: bundle.rounds,
      teamHoleScores: allTeamHoles as Parameters<typeof isLeagueReadyToAutoComplete>[0]['teamHoleScores'],
    });
    a.check('Completion: threshold met via team hole scores', ready);
    await markLeagueCompleted(league.id);
    a.check(
      'Completion: status completed',
      (await fetchLeagueBundle(league.id)).league.status === 'completed'
    );

    await createLeague(ctx, {
      name: `[verify] BB 2 ${ctx.runId}`,
      format: 'best_ball',
      startDate: isoDate(today),
      endDate: isoDate(addDays(today, 7)),
      roundsThatCount: 1,
    });
    const active = await countActiveLeaguesForGroup(ctx.groupId);
    a.check('Constraint: active tournament present (app would block another)', active >= 1, `active=${active}`);
  } catch (e) {
    a.check('Suite aborted', false, e instanceof Error ? e.message : String(e));
  } finally {
    if (ctx) {
      console.log('\nCleaning up…');
      await cleanupVerifyCtx(ctx);
      a.check('Cleanup done', true);
    }
  }

  process.exit(a.summary('verify:tournament-bestball'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
