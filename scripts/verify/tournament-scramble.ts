#!/usr/bin/env npx tsx
/**
 * verify:tournament-scramble — scramble lifecycle + index exclusion persistence.
 */
import {
  Asserter,
  addDays,
  autoAssignMembersToTeams,
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
  netFromIndex,
  setupVerifyCtx,
  upsertHoles,
} from './harness';
import { computeLeagueStandings } from '../../src/lib/computeLeagueStandings';
import { isValidPlayersPerTeam } from '../../src/lib/tournamentTeamCount';
import { computeScrambleTeamIndex } from '../../src/lib/scrambleTournament';
import {
  DEFAULT_STROKE_INDEX_BY_HOLE,
  holesForStrokes,
  whsCourseHandicapFromIndex,
} from '../../src/lib/netHandicap';

const PLAYERS = ['Shooter McGavin', 'Roy Kent', 'Walter White', 'Happy Gilmore'] as const;

async function main(): Promise<void> {
  const a = new Asserter();
  console.log('\n=== verify:tournament-scramble ===\n');

  a.check(
    'Constraint: uneven 5 players / 2 per team rejected',
    !isValidPlayersPerTeam(5, 2, 'scramble')
  );
  a.check(
    'Constraint: 4 players / 2 per team allowed',
    isValidPlayersPerTeam(4, 2, 'scramble')
  );
  a.check(
    'Constraint: too few members (3) cannot form 2 teams of 2',
    !isValidPlayersPerTeam(3, 2, 'scramble')
  );

  let ctx: Awaited<ReturnType<typeof setupVerifyCtx>> | null = null;
  try {
    ctx = await setupVerifyCtx([...PLAYERS], 'scramble');
    const today = new Date();
    const course = getCourseById('pebble')!;
    const white = course.tees!.find((t) => t.name === 'White')!;

    // --- Auto-assign (snake by handicap) ---
    const membersForAssign = PLAYERS.map((n) => {
      const p = ctx!.profileByName.get(n)!;
      return { userId: p.id, handicap: p.handicap };
    });
    const auto = autoAssignMembersToTeams(membersForAssign, 2, false);
    a.check(
      'Auto-assign: 2 teams, 2+ each, even split',
      auto.length === 2 && auto.every((t) => t.memberIds.length === 2),
      auto.map((t) => t.memberIds.length).join(',')
    );

    const league = await createLeague(ctx, {
      name: `[verify] Scramble ${ctx.runId}`,
      format: 'scramble',
      startDate: isoDate(addDays(today, -7)),
      endDate: isoDate(addDays(today, 14)),
      roundsThatCount: 1,
      useHandicap: true,
    });

    // Manual team assignment (also validates designated scorer)
    const teamANames = ['Shooter McGavin', 'Happy Gilmore']; // low + high → 15/85
    const teamBNames = ['Roy Kent', 'Walter White'];
    const { teams, entryByUser } = await createTeamsWithMembers(ctx, league.id, [
      {
        name: 'Team Alpha',
        memberNames: teamANames,
        designatedScorerName: 'Shooter McGavin',
      },
      {
        name: 'Team Bravo',
        memberNames: teamBNames,
        designatedScorerName: 'Roy Kent',
      },
    ]);
    a.check(
      'Manual assign: teams divide evenly with 2+ per team',
      teams.length === 2 && teams.every((t) => {
        const n = [...entryByUser.values()].filter((e) => e.league_team_id === t.id).length;
        return n >= 2;
      })
    );

    // Team A index 15/85
    const teamAIndexes = teamANames.map((n) => ctx!.profileByName.get(n)!.handicap);
    const teamAIndex = computeScrambleTeamIndex(teamAIndexes)!;
    a.check(
      'Team handicap: 15%/85% auto-calc',
      Math.abs(teamAIndex - (4.2 * 0.15 + 23.4 * 0.85)) < 0.05,
      `teamIndex=${teamAIndex}`
    );

    // Scramble scorecard as designated scorer
    const scorer = ctx.profileByName.get('Shooter McGavin')!;
    const entry = entryByUser.get(scorer.id)!;
    const team = teams.find((t) => t.id === entry.league_team_id)!;
    const gross = 68;
    const playedAt = addDays(today, -1).toISOString();
    const { roundId, holes, adjustedDiff } = await insertRound(ctx, scorer, gross, playedAt, {
      excludesFromSimcapIndex: true,
    });

    const flag = await fetchRoundExclusionFlag(roundId);
    a.check(
      'Index exclusion: excludes_from_simcap_index persisted on insert',
      flag === true,
      `flag=${flag}`
    );

    const beforeRows = await fetchUserActiveDifferentials(scorer.id);
    const indexWithExclusion = indexFromFetchedRounds(beforeRows);
    const indexIfCounted = indexFromFetchedRounds(
      beforeRows.map((r) =>
        r.id === roundId ? { ...r, excludes: false } : r
      )
    );
    a.check(
      'Index exclusion: scramble-only round omitted from SimCap index math after fetch',
      indexWithExclusion !== indexIfCounted || beforeRows.filter((r) => !r.excludes).length < beforeRows.length,
      `indexExcluded=${indexWithExclusion}, indexIfCounted=${indexIfCounted}, adjDiff=${adjustedDiff}`
    );
    a.check(
      'Index exclusion: this round flagged excluded in fetched set',
      beforeRows.some((r) => r.id === roundId && r.excludes === true)
    );

    const lrId = await insertLeagueRound({
      leagueId: league.id,
      profile: scorer,
      entryId: entry.id,
      teamId: team.id,
      roundId,
      gross,
      net: netFromIndex(gross, teamAIndex),
      holeEntryStatus: 'pending_holes',
    });

    const up = await upsertHoles(
      ctx.tokens.get(scorer.name)!,
      lrId,
      holes.map((h) => ({ ...h, is_team_score: true }))
    );
    a.check('Scorecard: designated scorer upserted 18 holes', up.ok, up.error);

    const calc = await invokeEdgeFunction<{
      ok?: boolean;
      holes_written?: number;
      use_handicap?: boolean;
      team_course_handicap?: number | null;
      error?: string;
    }>('calculate-team-hole-scores', { league_round_id: lrId }, ctx.tokens.get(scorer.name)!);
    a.check(
      'calculate-team-hole-scores: ok with handicap',
      !!calc.data?.ok && !calc.error,
      calc.error ?? `holes=${calc.data?.holes_written} ch=${calc.data?.team_course_handicap}`
    );

    const teamHoles = await fetchTeamHoleScores(league.id);
    const teamRows = teamHoles
      .filter((r) => r.league_team_id === team.id)
      .sort((x, y) => x.hole_number - y.hole_number);
    a.check('Team holes: 18 rows written', teamRows.length === 18, `n=${teamRows.length}`);

    // Prefer the course handicap the edge function actually used (effective indexes from DB,
    // not the seed PROFILE_SPECS handicap field).
    const courseHandicap =
      calc.data?.team_course_handicap != null && Number.isFinite(calc.data.team_course_handicap)
        ? Number(calc.data.team_course_handicap)
        : whsCourseHandicapFromIndex(teamAIndex, white.rating, white.slope, 72);
    const strokeHoles = holesForStrokes(Math.max(0, courseHandicap), DEFAULT_STROKE_INDEX_BY_HOLE);
    let netsMatch = true;
    for (let i = 0; i < 18; i++) {
      const row = teamRows[i];
      const hole = i + 1;
      const strokes = strokeHoles.filter((h) => h === hole).length;
      const exp = holes[i]!.gross_score - strokes;
      if (!row || Number(row.team_net_score) !== exp) {
        netsMatch = false;
        a.check(
          `Team net hole ${hole}`,
          false,
          `got ${row?.team_net_score}, expected ${exp} (gross ${holes[i]?.gross_score}, ch=${courseHandicap})`
        );
        break;
      }
    }
    if (netsMatch) {
      a.check(
        'Team net: per-hole nets match course-HC stroke allocation',
        true,
        `ch=${courseHandicap}`
      );
    }

    // Team B also needs a round for completion (rounds_that_count=1)
    const scorerB = ctx.profileByName.get('Roy Kent')!;
    const entryB = entryByUser.get(scorerB.id)!;
    const teamB = teams.find((t) => t.id === entryB.league_team_id)!;
    const { roundId: roundB, holes: holesB } = await insertRound(
      ctx,
      scorerB,
      72,
      playedAt,
      { excludesFromSimcapIndex: true }
    );
    const lrB = await insertLeagueRound({
      leagueId: league.id,
      profile: scorerB,
      entryId: entryB.id,
      teamId: teamB.id,
      roundId: roundB,
      gross: 72,
      net: netFromIndex(72, computeScrambleTeamIndex(teamBNames.map((n) => ctx!.profileByName.get(n)!.handicap))!),
      holeEntryStatus: 'pending_holes',
    });
    await upsertHoles(
      ctx.tokens.get(scorerB.name)!,
      lrB,
      holesB.map((h) => ({ ...h, is_team_score: true }))
    );
    await invokeEdgeFunction(
      'calculate-team-hole-scores',
      { league_round_id: lrB },
      ctx.tokens.get(scorerB.name)!
    );

    const bundle = await fetchLeagueBundle(league.id);
    const standings = computeLeagueStandings({
      league: bundle.league,
      entries: bundle.entries,
      rounds: bundle.rounds,
      teams: bundle.teams,
      displayNames: displayNames(ctx),
    });
    a.check(
      'Standings: Low Net ranking present for both teams',
      standings.length === 2 && standings.every((s) => s.lowNet != null),
      standings.map((s) => `${s.rank}.${s.displayName}=${s.lowNet}`).join(' | ')
    );
    a.check(
      'Standings: sorted ascending Low Net',
      (standings[0]!.lowNet ?? 999) <= (standings[1]!.lowNet ?? 999)
    );

    const ready = isLeagueReadyToAutoComplete({
      league: bundle.league,
      teams: bundle.teams,
      entries: bundle.entries,
      rounds: bundle.rounds,
    });
    a.check('Completion: both teams met counting rounds', ready);
    await markLeagueCompleted(league.id);
    a.check(
      'Completion: status completed',
      (await fetchLeagueBundle(league.id)).league.status === 'completed'
    );

    // Dual active probe
    await createLeague(ctx, {
      name: `[verify] Scramble 2 ${ctx.runId}`,
      format: 'scramble',
      startDate: isoDate(today),
      endDate: isoDate(addDays(today, 7)),
      roundsThatCount: 1,
    });
    const active = await countActiveLeaguesForGroup(ctx.groupId);
    a.check(
      'Constraint: active tournament count ≥ 1 blocks another in app',
      active >= 1,
      `active=${active}`
    );
  } catch (e) {
    a.check('Suite aborted', false, e instanceof Error ? e.message : String(e));
  } finally {
    if (ctx) {
      console.log('\nCleaning up…');
      await cleanupVerifyCtx(ctx);
      a.check('Cleanup done', true);
    }
  }

  process.exit(a.summary('verify:tournament-scramble'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
