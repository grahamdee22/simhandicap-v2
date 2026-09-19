#!/usr/bin/env npx tsx
/**
 * verify:team-handicap — Scramble/Best Ball team nets via calculate-team-hole-scores.
 * Asserts use_handicap on/off, 15%/85% (and override), and Best Ball min-of-nets.
 */
import {
  Asserter,
  addDays,
  admin,
  cleanupVerifyCtx,
  createLeague,
  createTeamsWithMembers,
  fetchTeamHoleScores,
  getCourseById,
  insertLeagueRound,
  insertRound,
  invokeEdgeFunction,
  isoDate,
  resolveEffectiveIndexes,
  setupVerifyCtx,
  upsertHoles,
  type VerifyCtx,
} from './harness';
import { computeScrambleTeamIndex } from '../../src/lib/scrambleTournament';
import {
  DEFAULT_STROKE_INDEX_BY_HOLE,
  holesForStrokes,
  whsCourseHandicapFromIndex,
} from '../../src/lib/netHandicap';

function strokesOnHole(hole: number, courseHandicap: number): number {
  if (courseHandicap <= 0) return 0;
  return holesForStrokes(courseHandicap, DEFAULT_STROKE_INDEX_BY_HOLE).filter((h) => h === hole)
    .length;
}

async function main(): Promise<void> {
  const a = new Asserter();
  console.log('\n=== verify:team-handicap ===\n');

  let ctx: VerifyCtx | null = null;
  try {
    ctx = await setupVerifyCtx(
      ['Shooter McGavin', 'Happy Gilmore', 'Roy Kent', 'Walter White'],
      'team-handicap'
    );
    const today = new Date();
    const playedAt = addDays(today, -1).toISOString();
    const course = getCourseById('pebble')!;
    const white = course.tees!.find((t) => t.name === 'White')!;

    // --- Scramble: handicap ON (15/85) ---
    const leagueOn = await createLeague(ctx, {
      name: `[verify] TeamHC scramble on ${ctx.runId}`,
      format: 'scramble',
      startDate: isoDate(addDays(today, -3)),
      endDate: isoDate(addDays(today, 7)),
      roundsThatCount: 1,
      useHandicap: true,
    });
    const { teams: teamsOn, entryByUser: entriesOn } = await createTeamsWithMembers(
      ctx,
      leagueOn.id,
      [
        {
          name: 'HC On',
          memberNames: ['Shooter McGavin', 'Happy Gilmore'],
          designatedScorerName: 'Shooter McGavin',
        },
        {
          name: 'HC On B',
          memberNames: ['Roy Kent', 'Walter White'],
          designatedScorerName: 'Roy Kent',
        },
      ]
    );
    const scorer = ctx.profileByName.get('Shooter McGavin')!;
    const teamOn = teamsOn.find((t) => t.name === 'HC On')!;
    const holes = Array.from({ length: 18 }, () => 4);
    const gross = 72;
    const { roundId, holes: holeRows } = await insertRound(ctx, scorer, gross, playedAt, {
      holes,
      excludesFromSimcapIndex: true,
    });
    const lrOn = await insertLeagueRound({
      leagueId: leagueOn.id,
      profile: scorer,
      entryId: entriesOn.get(scorer.id)!.id,
      teamId: teamOn.id,
      roundId,
      gross,
      net: gross,
      holeEntryStatus: 'pending_holes',
    });
    await upsertHoles(
      ctx.tokens.get(scorer.name)!,
      lrOn,
      holeRows.map((h) => ({ ...h, is_team_score: true }))
    );
    const calcOn = await invokeEdgeFunction<{
      ok?: boolean;
      team_course_handicap?: number | null;
      use_handicap?: boolean;
      error?: string;
    }>('calculate-team-hole-scores', { league_round_id: lrOn }, ctx.tokens.get(scorer.name)!);
    a.check('Scramble HC-on: edge ok', !!calcOn.data?.ok && !calcOn.error, calcOn.error);
    a.check(
      'Scramble HC-on: use_handicap reflected / course HC computed',
      calcOn.data?.team_course_handicap != null && Number(calcOn.data.team_course_handicap) >= 0,
      `ch=${calcOn.data?.team_course_handicap}`
    );

    const rowsOn = (await fetchTeamHoleScores(leagueOn.id))
      .filter((r) => r.league_team_id === teamOn.id)
      .sort((x, y) => x.hole_number - y.hole_number);
    const ch = Number(calcOn.data?.team_course_handicap ?? 0);
    const strokeHoles = holesForStrokes(Math.max(0, ch), DEFAULT_STROKE_INDEX_BY_HOLE);
    let onNetsOk = true;
    let anyStrokeApplied = false;
    for (const row of rowsOn) {
      const strokes = strokeHoles.filter((h) => h === row.hole_number).length;
      if (strokes > 0) anyStrokeApplied = true;
      const exp = Number(row.team_score) - strokes;
      if (Number(row.team_net_score) !== exp) {
        onNetsOk = false;
        a.check(
          `Scramble HC-on: hole ${row.hole_number} net`,
          false,
          `got ${row.team_net_score}, expected ${exp}`
        );
        break;
      }
    }
    if (onNetsOk) {
      a.check(
        'Scramble HC-on: team_net = gross − SI strokes for course HC',
        true,
        `ch=${ch}, strokesDistributed=${strokeHoles.length}`
      );
    }
    a.check(
      'Scramble HC-on: at least one hole receives a stroke when ch>0 (or ch=0 is valid)',
      ch === 0 || anyStrokeApplied,
      `ch=${ch}`
    );

    // 15/85 sanity vs override path
    const idx15 = computeScrambleTeamIndex([
      ctx.profileByName.get('Shooter McGavin')!.handicap,
      ctx.profileByName.get('Happy Gilmore')!.handicap,
    ]);
    a.check('15%/85% helper produces a team index', idx15 != null, `idx=${idx15}`);

    // --- Scramble: handicap OFF ---
    const leagueOff = await createLeague(ctx, {
      name: `[verify] TeamHC scramble off ${ctx.runId}`,
      format: 'scramble',
      startDate: isoDate(addDays(today, -3)),
      endDate: isoDate(addDays(today, 7)),
      roundsThatCount: 1,
      useHandicap: false,
    });
    // First league still active — app would block; we create via admin for isolated HC-off check.
    // End the first league so we don't leave two actives if cleanup fails mid-way.
    await adminMarkCompleted(leagueOn.id);

    const { teams: teamsOff, entryByUser: entriesOff } = await createTeamsWithMembers(
      ctx,
      leagueOff.id,
      [
        {
          name: 'HC Off',
          memberNames: ['Shooter McGavin', 'Happy Gilmore'],
          designatedScorerName: 'Shooter McGavin',
        },
        {
          name: 'HC Off B',
          memberNames: ['Roy Kent', 'Walter White'],
          designatedScorerName: 'Roy Kent',
        },
      ]
    );
    const teamOff = teamsOff.find((t) => t.name === 'HC Off')!;
    const { roundId: roundOff, holes: holesOff } = await insertRound(
      ctx,
      scorer,
      gross,
      playedAt,
      { holes, excludesFromSimcapIndex: true }
    );
    const lrOff = await insertLeagueRound({
      leagueId: leagueOff.id,
      profile: scorer,
      entryId: entriesOff.get(scorer.id)!.id,
      teamId: teamOff.id,
      roundId: roundOff,
      gross,
      net: gross,
      holeEntryStatus: 'pending_holes',
    });
    await upsertHoles(
      ctx.tokens.get(scorer.name)!,
      lrOff,
      holesOff.map((h) => ({ ...h, is_team_score: true }))
    );
    const calcOff = await invokeEdgeFunction<{
      ok?: boolean;
      team_course_handicap?: number | null;
    }>('calculate-team-hole-scores', { league_round_id: lrOff }, ctx.tokens.get(scorer.name)!);
    a.check('Scramble HC-off: edge ok', !!calcOff.data?.ok);
    const rowsOff = (await fetchTeamHoleScores(leagueOff.id)).filter(
      (r) => r.league_team_id === teamOff.id
    );
    const allEqual = rowsOff.every(
      (r) => Number(r.team_net_score) === Number(r.team_score)
    );
    a.check(
      'Scramble HC-off: team_net_score equals team_score on every hole',
      allEqual && rowsOff.length === 18,
      `n=${rowsOff.length}`
    );
    a.check(
      'Scramble: HC-on nets differ from HC-off when course HC > 0',
      ch === 0 || !allEqual || rowsOn.some((r) => Number(r.team_net_score) !== Number(r.team_score)),
      `ch=${ch}`
    );

    await adminMarkCompleted(leagueOff.id);

    // --- Scramble override ---
    const leagueOv = await createLeague(ctx, {
      name: `[verify] TeamHC override ${ctx.runId}`,
      format: 'scramble',
      startDate: isoDate(addDays(today, -3)),
      endDate: isoDate(addDays(today, 7)),
      roundsThatCount: 1,
      useHandicap: true,
      scrambleHandicapOverride: 10,
    });
    const { teams: teamsOv, entryByUser: entriesOv } = await createTeamsWithMembers(
      ctx,
      leagueOv.id,
      [
        {
          name: 'Override',
          memberNames: ['Shooter McGavin', 'Happy Gilmore'],
          designatedScorerName: 'Shooter McGavin',
        },
        {
          name: 'Override B',
          memberNames: ['Roy Kent', 'Walter White'],
          designatedScorerName: 'Roy Kent',
        },
      ]
    );
    const teamOv = teamsOv.find((t) => t.name === 'Override')!;
    const { roundId: roundOv, holes: holesOv } = await insertRound(ctx, scorer, gross, playedAt, {
      holes,
      excludesFromSimcapIndex: true,
    });
    const lrOv = await insertLeagueRound({
      leagueId: leagueOv.id,
      profile: scorer,
      entryId: entriesOv.get(scorer.id)!.id,
      teamId: teamOv.id,
      roundId: roundOv,
      gross,
      net: gross,
      holeEntryStatus: 'pending_holes',
    });
    await upsertHoles(
      ctx.tokens.get(scorer.name)!,
      lrOv,
      holesOv.map((h) => ({ ...h, is_team_score: true }))
    );
    const calcOv = await invokeEdgeFunction<{
      ok?: boolean;
      team_course_handicap?: number | null;
    }>('calculate-team-hole-scores', { league_round_id: lrOv }, ctx.tokens.get(scorer.name)!);
    const expectedChOv = whsCourseHandicapFromIndex(10, white.rating, white.slope, 72);
    a.check(
      'Scramble override: course HC derived from override index 10',
      calcOv.data?.ok === true && Number(calcOv.data.team_course_handicap) === expectedChOv,
      `got ch=${calcOv.data?.team_course_handicap}, expected ${expectedChOv}`
    );
    await adminMarkCompleted(leagueOv.id);

    // --- Best Ball: min of per-player nets ---
    const leagueBb = await createLeague(ctx, {
      name: `[verify] TeamHC bestball ${ctx.runId}`,
      format: 'best_ball',
      startDate: isoDate(addDays(today, -3)),
      endDate: isoDate(addDays(today, 7)),
      roundsThatCount: 1,
      useHandicap: true,
    });
    const { teams: teamsBb, entryByUser: entriesBb } = await createTeamsWithMembers(
      ctx,
      leagueBb.id,
      [
        { name: 'BB A', memberNames: ['Shooter McGavin', 'Roy Kent'] },
        { name: 'BB B', memberNames: ['Happy Gilmore', 'Walter White'] },
      ]
    );
    const teamBb = teamsBb.find((t) => t.name === 'BB A')!;
    const roy = ctx.profileByName.get('Roy Kent')!;
    const sHoles = Array.from({ length: 18 }, (_, i) => (i % 2 === 0 ? 3 : 5));
    const rHoles = Array.from({ length: 18 }, (_, i) => (i % 2 === 0 ? 5 : 3));
    const rS = await insertRound(ctx, scorer, sHoles.reduce((x, y) => x + y, 0), playedAt, {
      holes: sHoles,
    });
    const rR = await insertRound(ctx, roy, rHoles.reduce((x, y) => x + y, 0), playedAt, {
      holes: rHoles,
    });
    const lrS = await insertLeagueRound({
      leagueId: leagueBb.id,
      profile: scorer,
      entryId: entriesBb.get(scorer.id)!.id,
      teamId: teamBb.id,
      roundId: rS.roundId,
      gross: sHoles.reduce((x, y) => x + y, 0),
      net: 0,
      holeEntryStatus: 'pending_holes',
    });
    const lrR = await insertLeagueRound({
      leagueId: leagueBb.id,
      profile: roy,
      entryId: entriesBb.get(roy.id)!.id,
      teamId: teamBb.id,
      roundId: rR.roundId,
      gross: rHoles.reduce((x, y) => x + y, 0),
      net: 0,
      holeEntryStatus: 'pending_holes',
    });
    await upsertHoles(
      ctx.tokens.get(scorer.name)!,
      lrS,
      sHoles.map((g, i) => ({ hole_number: i + 1, gross_score: g }))
    );
    await upsertHoles(
      ctx.tokens.get(roy.name)!,
      lrR,
      rHoles.map((g, i) => ({ hole_number: i + 1, gross_score: g }))
    );
    await invokeEdgeFunction(
      'calculate-team-hole-scores',
      { league_round_id: lrS },
      ctx.tokens.get(scorer.name)!
    );
    await invokeEdgeFunction(
      'calculate-team-hole-scores',
      { league_round_id: lrR },
      ctx.tokens.get(roy.name)!
    );

    const indexes = await resolveEffectiveIndexes([scorer.id, roy.id]);
    const chS = whsCourseHandicapFromIndex(
      indexes.get(scorer.id) ?? 0,
      white.rating,
      white.slope,
      72
    );
    const chR = whsCourseHandicapFromIndex(
      indexes.get(roy.id) ?? 0,
      white.rating,
      white.slope,
      72
    );
    const bbRows = (await fetchTeamHoleScores(leagueBb.id)).filter(
      (r) => r.league_team_id === teamBb.id
    );
    let bbOk = true;
    for (let i = 0; i < 18; i++) {
      const hole = i + 1;
      const row = bbRows.find((r) => r.hole_number === hole);
      const expGross = Math.min(sHoles[i]!, rHoles[i]!);
      const expNet = Math.min(
        sHoles[i]! - strokesOnHole(hole, chS),
        rHoles[i]! - strokesOnHole(hole, chR)
      );
      if (!row || row.team_score !== expGross || Number(row.team_net_score) !== expNet) {
        bbOk = false;
        a.check(
          `Best Ball hole ${hole}`,
          false,
          `score=${row?.team_score}/${row?.team_net_score}, expected ${expGross}/${expNet}`
        );
        break;
      }
    }
    if (bbOk) {
      a.check(
        'Best Ball: min gross + min net (per-player SI strokes) when handicap on',
        true,
        `ch S=${chS} R=${chR}`
      );
    }
  } catch (e) {
    a.check('Suite aborted', false, e instanceof Error ? e.message : String(e));
  } finally {
    if (ctx) {
      console.log('\nCleaning up…');
      await cleanupVerifyCtx(ctx);
      a.check('Cleanup done', true);
    }
  }

  process.exit(a.summary('verify:team-handicap'));
}

async function adminMarkCompleted(leagueId: string): Promise<void> {
  await admin
    .from('leagues')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', leagueId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
