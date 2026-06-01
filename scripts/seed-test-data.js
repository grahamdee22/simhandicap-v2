#!/usr/bin/env node
/**
 * Seed SimCap test data (is_test = true) via Supabase service role.
 *
 * Requires .env at repo root:
 *   SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Run: node scripts/seed-test-data.js
 * Full base seed (profiles, rounds, groups): FULL_SEED=1 node scripts/seed-test-data.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// --- env -------------------------------------------------------------------

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env (repo root).'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- constants -------------------------------------------------------------

const PROFILE_SPECS = [
  { name: 'Walter White', handicap: 8.4, platform: 'GSPro', simcapId: '847291' },
  { name: 'Danny Ocean', handicap: 11.2, platform: 'Trackman', simcapId: '392018' },
  { name: 'Ted Lasso', handicap: 13.6, platform: 'Foresight', simcapId: '561034' },
  { name: 'Roy Kent', handicap: 6.8, platform: 'Uneekor', simcapId: '718205' },
  { name: 'Happy Gilmore', handicap: 23.4, platform: 'GSPro', simcapId: '903472' },
  { name: 'Shooter McGavin', handicap: 4.2, platform: 'Trackman', simcapId: '124856' },
  { name: 'Al Czervik', handicap: 18.9, platform: 'Foresight', simcapId: '635709' },
  { name: 'Ty Webb', handicap: 9.7, platform: 'Uneekor', simcapId: '280143' },
  { name: 'Danny Noonan', handicap: 15.3, platform: 'GSPro', simcapId: '496820' },
  { name: 'Tony Soprano', handicap: 21.1, platform: 'Trackman', simcapId: '751364' },
];

const GROUP_NAMES = ['The Scratch Pad', 'Basement Boys', 'Pacific Simmers'];

const TOURNAMENT_NAMES = [
  'The Basement Scramble',
  'Pacific Best Ball',
  'Scratch Pad Championship',
  'Summer Kickoff',
];

const SUMMER_KICKOFF_NAME = 'Summer Kickoff';
const SUMMER_KICKOFF_EXCLUDED = 'Happy Gilmore';
const SUMMER_KICKOFF_PLAYERS = PROFILE_SPECS.map((s) => s.name).filter(
  (n) => n !== SUMMER_KICKOFF_EXCLUDED
);

const COURSES = [
  { id: 'pebble', name: 'Pebble Beach Golf Links', rating: 72.1, slope: 128, tee: 'White' },
  { id: 'augusta', name: 'Augusta National Golf Club', rating: 74.2, slope: 132, tee: 'Green' },
  { id: 'waste-mgmt', name: 'TPC Scottsdale Stadium', rating: 72.7, slope: 133, tee: 'Blue' },
  { id: 'bethpage', name: 'Bethpage Black', rating: 75.4, slope: 144, tee: 'Black' },
  { id: 'torrey-south', name: 'Torrey Pines South', rating: 75.3, slope: 144, tee: 'Blue' },
];

const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const PUTTING_MODES = ['auto_2putt', 'gimme_5', 'putt_all'];
const PIN_MODES = ['thu', 'fri', 'sat', 'sun'];
const WIND_MODES = ['off', 'light', 'strong'];
const MULL_MODES = ['on', 'off'];

const PUTTING = { putt_all: 1.0, auto_2putt: 1.15, gimme_5: 1.05 };
const PIN = { thu: 1.12, fri: 1.08, sat: 1.04, sun: 1.0 };
const WIND = { off: 1.1, light: 1.05, strong: 1.0 };
const MULL = { on: 1.15, off: 1.0 };
const SIM_BASELINE = 0.88;

// --- helpers ---------------------------------------------------------------

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function difficultyProduct(putting, pin, wind, mulligans) {
  const product =
    PUTTING[putting] * PIN[pin] * WIND[wind] * MULL[mulligans] * SIM_BASELINE;
  return Math.max(0.5, product);
}

function computeDifferential(gross, rating, slope, putting, pin, wind, mulligans) {
  const modifier = difficultyProduct(putting, pin, wind, mulligans);
  const raw = ((gross - rating) * 113) / slope;
  return {
    raw: round1(raw),
    adjusted: round1(raw * modifier),
    modifier: round2(modifier),
  };
}

/** Gross score band from handicap index (par 72 courses). */
function grossForHandicap(handicap) {
  const base = 72 + Math.round(handicap * 0.92);
  const jitter = randInt(-3, 4);
  return Math.min(95, Math.max(68, base + jitter));
}

function generateHoleScores(targetGross, pars = PARS) {
  const holes = pars.map((p) => p + randInt(-1, 2));
  let sum = holes.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum !== targetGross && guard < 800) {
    const idx = randInt(0, 17);
    const delta = targetGross > sum ? 1 : -1;
    const next = holes[idx] + delta;
    if (next >= 1 && next <= 12) {
      holes[idx] = next;
      sum += delta;
    }
    guard++;
  }
  if (sum !== targetGross) {
    const fix = targetGross - sum;
    const idx = 17;
    holes[idx] = Math.max(1, Math.min(12, holes[idx] + fix));
  }
  return holes;
}

function randomPlayedAt(daysBack = 90) {
  const now = Date.now();
  const offset = randInt(0, daysBack) * 24 * 60 * 60 * 1000;
  const hour = randInt(8, 20);
  const d = new Date(now - offset);
  d.setHours(hour, randInt(0, 59), 0, 0);
  return d.toISOString();
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function netScore(gross, handicap) {
  return round1(Math.max(1, gross - Math.round(handicap)));
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function profileByName(profiles, name) {
  const p = profiles.find((x) => x.name === name);
  if (!p) throw new Error(`Missing test profile: ${name}`);
  return p;
}

function groupByName(groups, name) {
  const g = groups.find((x) => x.name === name);
  if (!g) throw new Error(`Missing test group: ${name}`);
  return g;
}

function holesFromGross(gross) {
  return generateHoleScores(gross).map((gross_score, i) => ({
    hole_number: i + 1,
    gross_score,
  }));
}

/** Build 18 gross pairs so player 1 wins `p1Wins`, player 2 wins `p2Wins`, with optional halved holes. */
function matchPlayHoleScores(p1Wins, p2Wins, halved = 0) {
  const p1 = [];
  const p2 = [];
  let w1 = 0;
  let w2 = 0;
  let h = 0;

  for (let hole = 1; hole <= 18; hole++) {
    let g1 = randInt(3, 5);
    let g2 = randInt(3, 5);

    if (w1 < p1Wins && (w2 >= p2Wins || Math.random() < 0.55)) {
      g2 = g1 + randInt(1, 2);
      w1++;
    } else if (w2 < p2Wins) {
      g1 = g2 + randInt(1, 2);
      w2++;
    } else if (h < halved) {
      g2 = g1;
      h++;
    } else if (w1 <= w2) {
      g2 = g1 + 1;
      w1++;
    } else {
      g1 = g2 + 1;
      w2++;
    }

    p1.push({ hole_number: hole, gross_score: g1 });
    p2.push({ hole_number: hole, gross_score: g2 });
  }

  return { p1, p2, holes_won_p1: w1, holes_won_p2: w2, holes_halved: h };
}

function bestBallTeamHoles(memberHoles, handicapA, handicapB, useHandicap) {
  const strokesA = useHandicap ? Math.round(handicapA) : 0;
  const strokesB = useHandicap ? Math.round(handicapB) : 0;
  const team = [];
  for (let i = 0; i < 18; i++) {
    const g1 = memberHoles[0][i].gross_score;
    const g2 = memberHoles[1][i].gross_score;
    const n1 = useHandicap ? g1 - strokesA : g1;
    const n2 = useHandicap ? g2 - strokesB : g2;
    const teamGross = Math.min(g1, g2);
    const teamNet = Math.min(n1, n2);
    team.push({
      hole_number: i + 1,
      team_score: teamGross,
      team_net_score: round1(teamNet),
    });
  }
  return team;
}

// --- cleanup prior test seed -----------------------------------------------

async function cleanupPriorTestData() {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('is_test', true);

  if (error) {
    console.warn('[seed] Could not query prior test profiles:', error.message);
    return 0;
  }

  let removed = 0;
  for (const row of profiles ?? []) {
    const { error: delErr } = await supabase.auth.admin.deleteUser(row.id);
    if (delErr) {
      console.warn(`[seed] deleteUser ${row.display_name}:`, delErr.message);
    } else {
      removed++;
    }
  }
  return removed;
}

// --- seed steps ------------------------------------------------------------

async function createProfiles() {
  const created = [];

  for (const spec of PROFILE_SPECS) {
    const email = `${slugify(spec.name)}@seed.simcap.test`;
    const password = `Seed-${spec.simcapId}!`;

    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: spec.name },
    });

    if (authErr) {
      throw new Error(`auth.createUser ${spec.name}: ${authErr.message}`);
    }

    const userId = authData.user.id;

    const { error: profileErr } = await supabase
      .from('profiles')
      .update({
        display_name: spec.name,
        preferred_platform: spec.platform,
        ghin_index: spec.handicap,
        simcap_id: spec.simcapId,
        is_test: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (profileErr) {
      throw new Error(`profiles.update ${spec.name}: ${profileErr.message}`);
    }

    created.push({
      ...spec,
      id: userId,
      email,
    });
  }

  return created;
}

async function insertRounds(profiles) {
  const allRounds = [];

  for (const profile of profiles) {
    const count = randInt(8, 12);
    const rounds = [];

    for (let i = 0; i < count; i++) {
      const course = COURSES[i % COURSES.length];
      const gross = grossForHandicap(profile.handicap);
      const putting = pick(PUTTING_MODES);
      const pin = pick(PIN_MODES);
      const wind = pick(WIND_MODES);
      const mulligans = pick(MULL_MODES);
      const { raw, adjusted, modifier } = computeDifferential(
        gross,
        course.rating,
        course.slope,
        putting,
        pin,
        wind,
        mulligans
      );

      rounds.push({
        user_id: profile.id,
        course_id: course.id,
        course_name: course.name,
        platform: profile.platform,
        gross_score: gross,
        hole_scores: generateHoleScores(gross),
        putting_mode: putting,
        pin_placement: pin,
        wind,
        mulligans,
        difficulty_modifier: modifier,
        differential: adjusted,
        differential_version: 1,
        raw_differential: raw,
        course_rating: course.rating,
        slope: course.slope,
        tee_name: course.tee,
        played_at: randomPlayedAt(90),
        simcap_index_at_time: profile.handicap,
        is_active: true,
        is_test: true,
      });
    }

    const { data, error } = await supabase
      .from('rounds')
      .insert(rounds)
      .select('id, user_id, gross_score');
    if (error) throw new Error(`rounds.insert ${profile.name}: ${error.message}`);

    allRounds.push(
      ...(data ?? []).map((r) => ({
        id: r.id,
        userId: r.user_id,
        grossScore: r.gross_score,
        profileName: profile.name,
        handicap: profile.handicap,
      }))
    );
  }

  return allRounds;
}

async function insertGroups(profiles) {
  const creator = profiles[0];
  const groups = [];

  for (const name of GROUP_NAMES) {
    const { data: group, error: gErr } = await supabase
      .from('social_groups')
      .insert({
        name,
        created_by: creator.id,
        is_active: true,
        is_test: true,
      })
      .select('id, name')
      .single();

    if (gErr) throw new Error(`social_groups.insert ${name}: ${gErr.message}`);

    const members = profiles.map((p, idx) => ({
      group_id: group.id,
      user_id: p.id,
      display_name_snapshot: p.name,
      is_admin: idx === 0,
    }));

    const { error: mErr } = await supabase.from('group_members').insert(members);
    if (mErr) throw new Error(`group_members.insert ${name}: ${mErr.message}`);

    groups.push(group);
  }

  return groups;
}

// --- load existing test data -----------------------------------------------

async function loadTestProfiles() {
  const names = PROFILE_SPECS.map((s) => s.name);
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, ghin_index, preferred_platform, simcap_id')
    .eq('is_test', true)
    .in('display_name', names);

  if (error) throw new Error(`profiles load: ${error.message}`);

  const byName = new Map((data ?? []).map((r) => [r.display_name, r]));
  return PROFILE_SPECS.map((spec) => {
    const row = byName.get(spec.name);
    if (!row) {
      throw new Error(
        `Missing test profile "${spec.name}". Run FULL_SEED=1 node scripts/seed-test-data.js first.`
      );
    }
    return { ...spec, id: row.id };
  });
}

async function loadTestGroups() {
  const { data, error } = await supabase
    .from('social_groups')
    .select('id, name')
    .eq('is_test', true)
    .in('name', GROUP_NAMES);

  if (error) throw new Error(`social_groups load: ${error.message}`);

  return GROUP_NAMES.map((name) => {
    const row = (data ?? []).find((g) => g.name === name);
    if (!row) {
      throw new Error(
        `Missing test group "${name}". Run FULL_SEED=1 node scripts/seed-test-data.js first.`
      );
    }
    return row;
  });
}

async function cleanupTestTournaments() {
  const { data: leagues, error } = await supabase
    .from('leagues')
    .select('id, name')
    .eq('is_test', true);

  if (error) throw new Error(`leagues cleanup query: ${error.message}`);
  if (!leagues?.length) return 0;

  const toDelete = leagues.filter((l) => l.name !== SUMMER_KICKOFF_NAME);
  if (toDelete.length === 0) return 0;

  const { error: delErr } = await supabase
    .from('leagues')
    .delete()
    .in(
      'id',
      toDelete.map((l) => l.id)
    );
  if (delErr) throw new Error(`leagues cleanup delete: ${delErr.message}`);
  return toDelete.length;
}

/** Remove submitted Summer Kickoff league rounds (and linked rounds/scores) so stroke submissions can be re-seeded. */
async function wipeSummerKickoffSubmittedRounds(leagueId) {
  const { data: lrs, error } = await supabase
    .from('league_rounds')
    .select('id, round_id')
    .eq('league_id', leagueId);

  if (error) throw new Error(`Summer Kickoff league_rounds query: ${error.message}`);

  const lrIds = (lrs ?? []).map((r) => r.id);
  const roundIds = [...new Set((lrs ?? []).map((r) => r.round_id).filter(Boolean))];

  if (lrIds.length > 0) {
    const { error: thErr } = await supabase
      .from('tournament_hole_scores')
      .delete()
      .in('league_round_id', lrIds);
    if (thErr) throw new Error(`Summer Kickoff hole scores delete: ${thErr.message}`);

    const { error: lrErr } = await supabase.from('league_rounds').delete().eq('league_id', leagueId);
    if (lrErr) throw new Error(`Summer Kickoff league_rounds delete: ${lrErr.message}`);
  }

  if (roundIds.length > 0) {
    const { error: rErr } = await supabase.from('rounds').delete().in('id', roundIds);
    if (rErr) throw new Error(`Summer Kickoff rounds delete: ${rErr.message}`);
  }

  const { error: eErr } = await supabase
    .from('league_entries')
    .update({ rounds_played: 0, net_score: null, position: null })
    .eq('league_id', leagueId);
  if (eErr) throw new Error(`Summer Kickoff entries reset: ${eErr.message}`);

  return { leagueRoundsRemoved: lrIds.length, roundsRemoved: roundIds.length };
}

// --- tournament helpers ----------------------------------------------------

async function insertTournamentRound(profile, course, playedAt) {
  const gross = grossForHandicap(profile.handicap);
  const putting = pick(PUTTING_MODES);
  const pin = pick(PIN_MODES);
  const wind = pick(WIND_MODES);
  const mulligans = pick(MULL_MODES);
  const { raw, adjusted, modifier } = computeDifferential(
    gross,
    course.rating,
    course.slope,
    putting,
    pin,
    wind,
    mulligans
  );

  const { data, error } = await supabase
    .from('rounds')
    .insert({
      user_id: profile.id,
      course_id: course.id,
      course_name: course.name,
      platform: profile.platform,
      gross_score: gross,
      hole_scores: generateHoleScores(gross),
      putting_mode: putting,
      pin_placement: pin,
      wind,
      mulligans,
      difficulty_modifier: modifier,
      differential: adjusted,
      differential_version: 1,
      raw_differential: raw,
      course_rating: course.rating,
      slope: course.slope,
      tee_name: course.tee,
      played_at: playedAt,
      simcap_index_at_time: profile.handicap,
      is_active: true,
      is_test: true,
    })
    .select('id, gross_score')
    .single();

  if (error) throw new Error(`tournament round ${profile.name}: ${error.message}`);
  return data;
}

async function createLeagueRecord(opts) {
  const { data, error } = await supabase
    .from('leagues')
    .insert({
      group_id: opts.groupId,
      name: opts.name,
      format: opts.format,
      scoring_method: opts.format,
      start_date: opts.startDate,
      end_date: opts.endDate,
      rounds_that_count: opts.roundsThatCount ?? 1,
      use_handicap: opts.useHandicap !== false,
      created_by: opts.createdBy,
      status: opts.status,
      match_play_pairing_method: opts.matchPlayPairingMethod ?? null,
      match_play_matches_that_count: opts.matchPlayMatchesThatCount ?? null,
      current_bracket_round: opts.currentBracketRound ?? null,
      is_test: true,
    })
    .select('id, name, format, status')
    .single();

  if (error) throw new Error(`league ${opts.name}: ${error.message}`);
  return data;
}

async function createTeamsAndEntries(leagueId, teamDefs, profiles) {
  const entryByUser = new Map();
  const teams = [];

  for (const def of teamDefs) {
    const designated =
      def.designatedScorerName != null
        ? profileByName(profiles, def.designatedScorerName).id
        : null;

    const { data: team, error: tErr } = await supabase
      .from('league_teams')
      .insert({
        league_id: leagueId,
        name: def.name,
        designated_scorer_id: designated,
        is_test: true,
      })
      .select('id, name')
      .single();

    if (tErr) throw new Error(`league_teams ${def.name}: ${tErr.message}`);
    teams.push({ ...team, memberNames: def.memberNames });

    const memberIds = def.memberNames.map((n) => profileByName(profiles, n).id);
    await supabase.from('league_team_members').insert(
      memberIds.map((user_id) => ({ league_team_id: team.id, user_id }))
    );

    const entryRows = memberIds.map((user_id) => ({
      league_id: leagueId,
      user_id,
      league_team_id: team.id,
      rounds_played: 0,
      points: 0,
      net_score: null,
      position: null,
      bracket_seed: def.bracketSeedByUser?.[user_id] ?? null,
    }));

    const { data: insertedEntries, error: eErr } = await supabase
      .from('league_entries')
      .insert(entryRows)
      .select('id, user_id, league_team_id');

    if (eErr) throw new Error(`league_entries ${def.name}: ${eErr.message}`);
    for (const e of insertedEntries ?? []) {
      entryByUser.set(e.user_id, e);
    }
  }

  return { teams, entryByUser };
}

async function createSoloEntries(leagueId, playerNames, profiles, bracketSeeds) {
  const entryByUser = new Map();
  const rows = playerNames.map((name, idx) => {
    const p = profileByName(profiles, name);
    return {
      league_id: leagueId,
      user_id: p.id,
      league_team_id: null,
      rounds_played: 0,
      points: 0,
      net_score: null,
      position: null,
      bracket_seed: bracketSeeds?.[idx] ?? null,
      mp_wins: 0,
      mp_losses: 0,
      mp_halved: 0,
    };
  });

  const { data, error } = await supabase.from('league_entries').insert(rows).select('id, user_id');
  if (error) throw new Error(`league_entries solo: ${error.message}`);
  for (const e of data ?? []) entryByUser.set(e.user_id, e);
  return entryByUser;
}

async function insertHoleScoreRows(rows) {
  if (rows.length === 0) return;
  const { error } = await supabase.from('tournament_hole_scores').insert(rows);
  if (error) throw new Error(`tournament_hole_scores: ${error.message}`);
}

async function insertTeamHoleScoreRows(rows) {
  if (rows.length === 0) return;
  const payload = rows.map((r) => ({ ...r, is_test: true }));
  const { error } = await supabase.from('tournament_team_hole_scores').insert(payload);
  if (error) throw new Error(`tournament_team_hole_scores: ${error.message}`);
}

async function insertLeagueRoundWithHoles({
  leagueId,
  profile,
  entryId,
  teamId,
  course,
  playedAt,
  holes,
  holeEntryStatus = 'complete',
  isTeamScore = false,
}) {
  const gross = holes.reduce((s, h) => s + h.gross_score, 0);
  const round = await insertTournamentRound(profile, course, playedAt);

  const { data: lr, error: lrErr } = await supabase
    .from('league_rounds')
    .insert({
      league_id: leagueId,
      user_id: profile.id,
      league_team_id: teamId ?? null,
      round_id: round.id,
      gross_score: gross,
      net_score: netScore(gross, profile.handicap),
      counted: true,
      player_opted_in: true,
      hole_entry_status: holeEntryStatus,
    })
    .select('id')
    .single();

  if (lrErr) throw new Error(`league_rounds ${profile.name}: ${lrErr.message}`);

  await insertHoleScoreRows(
    holes.map((h) => ({
      league_entry_id: entryId,
      league_round_id: lr.id,
      user_id: profile.id,
      hole_number: h.hole_number,
      gross_score: h.gross_score,
      result: h.result ?? null,
      is_team_score: isTeamScore,
      is_test: true,
    }))
  );

  return { leagueRoundId: lr.id, gross, net: netScore(gross, profile.handicap), roundDate: playedAt.slice(0, 10) };
}

async function seedBasementScramble(group, profiles, creator) {
  const today = new Date();
  const league = await createLeagueRecord({
    groupId: group.id,
    name: 'The Basement Scramble',
    format: 'scramble',
    status: 'completed',
    startDate: isoDate(addDays(today, -50)),
    endDate: isoDate(addDays(today, -18)),
    createdBy: creator.id,
    roundsThatCount: 1,
  });

  const { teams, entryByUser } = await createTeamsAndEntries(
    league.id,
    [
      {
        name: 'Blue Sky',
        memberNames: ['Walter White', 'Danny Ocean'],
        designatedScorerName: 'Walter White',
      },
      {
        name: 'Happy Place',
        memberNames: ['Happy Gilmore', 'Tony Soprano'],
        designatedScorerName: 'Happy Gilmore',
      },
    ],
    profiles
  );

  const course = COURSES[3];
  const playedAt = addDays(today, -32).toISOString();
  const roundDate = playedAt.slice(0, 10);
  let holeScoreCount = 0;
  let teamHoleCount = 0;

  const teamResults = [];
  for (const team of teams) {
    const scorer = profileByName(profiles, team.name === 'Blue Sky' ? 'Walter White' : 'Happy Gilmore');
    const entry = entryByUser.get(scorer.id);
    const targetGross = team.name === 'Blue Sky' ? 71 : 79;
    const holes = holesFromGross(targetGross);

    const lr = await insertLeagueRoundWithHoles({
      leagueId: league.id,
      profile: scorer,
      entryId: entry.id,
      teamId: team.id,
      course,
      playedAt,
      holes,
      isTeamScore: true,
    });

    holeScoreCount += holes.length;
    await insertTeamHoleScoreRows(
      holes.map((h) => ({
        league_id: league.id,
        league_team_id: team.id,
        round_date: roundDate,
        hole_number: h.hole_number,
        team_score: h.gross_score,
        team_net_score: h.gross_score,
        is_partial: false,
        source_league_round_id: lr.leagueRoundId,
      }))
    );
    teamHoleCount += holes.length;
    teamResults.push({ team, lr });
  }

  teamResults.sort((a, b) => a.lr.gross - b.lr.gross);
  for (let i = 0; i < teamResults.length; i++) {
    const { team, lr } = teamResults[i];
    for (const name of team.memberNames) {
      const p = profileByName(profiles, name);
      await supabase
        .from('league_entries')
        .update({
          rounds_played: 1,
          net_score: lr.net,
          position: i + 1,
        })
        .eq('league_id', league.id)
        .eq('user_id', p.id);
    }
  }

  return {
    league,
    teams: teams.length,
    holeScores: holeScoreCount,
    teamHoleScores: teamHoleCount,
    winner: teamResults[0].team.name,
  };
}

async function seedPacificBestBall(group, profiles, creator) {
  const today = new Date();
  const league = await createLeagueRecord({
    groupId: group.id,
    name: 'Pacific Best Ball',
    format: 'best_ball',
    status: 'completed',
    startDate: isoDate(addDays(today, -45)),
    endDate: isoDate(addDays(today, -12)),
    createdBy: creator.id,
    roundsThatCount: 1,
  });

  const { teams, entryByUser } = await createTeamsAndEntries(
    league.id,
    [
      { name: 'Believe Brigade', memberNames: ['Ted Lasso', 'Roy Kent'] },
      { name: 'Caddyshack', memberNames: ['Al Czervik', 'Danny Noonan'] },
    ],
    profiles
  );

  const course = COURSES[4];
  const playedAt = addDays(today, -28).toISOString();
  const roundDate = playedAt.slice(0, 10);
  let holeScoreCount = 0;
  let teamHoleCount = 0;
  const teamTotals = [];

  for (const team of teams) {
    const names = team.memberNames;
    const p1 = profileByName(profiles, names[0]);
    const p2 = profileByName(profiles, names[1]);
    const e1 = entryByUser.get(p1.id);
    const e2 = entryByUser.get(p2.id);

    const g1 = team.name === 'Believe Brigade' ? 74 : 84;
    const g2 = team.name === 'Believe Brigade' ? 76 : 86;
    const h1 = holesFromGross(g1);
    const h2 = holesFromGross(g2);

    const lr1 = await insertLeagueRoundWithHoles({
      leagueId: league.id,
      profile: p1,
      entryId: e1.id,
      teamId: team.id,
      course,
      playedAt,
      holes: h1,
    });
    const lr2 = await insertLeagueRoundWithHoles({
      leagueId: league.id,
      profile: p2,
      entryId: e2.id,
      teamId: team.id,
      course,
      playedAt,
      holes: h2,
    });

    holeScoreCount += h1.length + h2.length;
    const teamHoles = bestBallTeamHoles([h1, h2], p1.handicap, p2.handicap, true);
    const teamGross = teamHoles.reduce((s, h) => s + h.team_score, 0);
    const teamNet = teamHoles.reduce((s, h) => s + Number(h.team_net_score), 0);

    await insertTeamHoleScoreRows(
      teamHoles.map((h) => ({
        league_id: league.id,
        league_team_id: team.id,
        round_date: roundDate,
        hole_number: h.hole_number,
        team_score: h.team_score,
        team_net_score: h.team_net_score,
        is_partial: false,
        source_league_round_id: lr1.leagueRoundId,
      }))
    );
    teamHoleCount += teamHoles.length;
    teamTotals.push({ team, teamNet, teamGross, lr1, lr2 });
  }

  teamTotals.sort((a, b) => a.teamGross - b.teamGross);
  for (let i = 0; i < teamTotals.length; i++) {
    const { team, teamNet } = teamTotals[i];
    for (const name of team.memberNames) {
      const p = profileByName(profiles, name);
      await supabase
        .from('league_entries')
        .update({ rounds_played: 1, net_score: round1(teamNet), position: i + 1 })
        .eq('league_id', league.id)
        .eq('user_id', p.id);
    }
  }

  return {
    league,
    teams: teams.length,
    holeScores: holeScoreCount,
    teamHoleScores: teamHoleCount,
    winner: teamTotals[0].team.name,
  };
}

async function seedMatchPlayBracket(group, profiles, creator) {
  const today = new Date();
  const completedAt = addDays(today, -8).toISOString();

  const league = await createLeagueRecord({
    groupId: group.id,
    name: 'Scratch Pad Championship',
    format: 'match_play',
    status: 'completed',
    startDate: isoDate(addDays(today, -40)),
    endDate: isoDate(addDays(today, -8)),
    createdBy: creator.id,
    matchPlayPairingMethod: 'bracket',
    currentBracketRound: null,
  });

  const playerNames = ['Shooter McGavin', 'Roy Kent', 'Danny Ocean', 'Ty Webb'];
  const entryByUser = await createSoloEntries(
    league.id,
    playerNames,
    profiles,
    [1, 2, 3, 4]
  );

  const entry = (name) => entryByUser.get(profileByName(profiles, name).id);
  const course = COURSES[1];
  const playedAt = addDays(today, -20).toISOString();
  let holeScoreCount = 0;

  async function playBracketMatch({
    round,
    slot,
    p1Name,
    p2Name,
    p1Wins,
    p2Wins,
    feeder1 = null,
    feeder2 = null,
  }) {
    const p1 = profileByName(profiles, p1Name);
    const p2 = profileByName(profiles, p2Name);
    const e1 = entry(p1Name);
    const e2 = entry(p2Name);
    const sim = matchPlayHoleScores(p1Wins, p2Wins, 1);
    const winnerEntry = p1Wins > p2Wins ? e1 : e2;

    const { data: pairing, error: pErr } = await supabase
      .from('league_match_pairings')
      .insert({
        league_id: league.id,
        player_1_entry_id: e1.id,
        player_2_entry_id: e2.id,
        status: 'complete',
        winner_entry_id: winnerEntry.id,
        holes_won_p1: sim.holes_won_p1,
        holes_won_p2: sim.holes_won_p2,
        holes_halved: sim.holes_halved,
        scheduled_at: playedAt,
        completed_at: completedAt,
        bracket_round: round,
        bracket_slot: slot,
        feeder_pairing_1_id: feeder1,
        feeder_pairing_2_id: feeder2,
      })
      .select('id')
      .single();

    if (pErr) throw new Error(`pairing ${p1Name} vs ${p2Name}: ${pErr.message}`);

    const lr1 = await insertLeagueRoundWithHoles({
      leagueId: league.id,
      profile: p1,
      entryId: e1.id,
      teamId: null,
      course,
      playedAt,
      holes: sim.p1,
    });
    const lr2 = await insertLeagueRoundWithHoles({
      leagueId: league.id,
      profile: p2,
      entryId: e2.id,
      teamId: null,
      course,
      playedAt,
      holes: sim.p2,
    });

    holeScoreCount += sim.p1.length + sim.p2.length;

    for (let i = 0; i < 18; i++) {
      const g1 = sim.p1[i].gross_score;
      const g2 = sim.p2[i].gross_score;
      let r1 = 'H';
      let r2 = 'H';
      if (g1 < g2) {
        r1 = 'W';
        r2 = 'L';
      } else if (g2 < g1) {
        r1 = 'L';
        r2 = 'W';
      }
      await supabase
        .from('tournament_hole_scores')
        .update({ result: r1 })
        .eq('league_round_id', lr1.leagueRoundId)
        .eq('hole_number', i + 1);
      await supabase
        .from('tournament_hole_scores')
        .update({ result: r2 })
        .eq('league_round_id', lr2.leagueRoundId)
        .eq('hole_number', i + 1);
    }

    await supabase.from('league_match_pairing_rounds').insert([
      { pairing_id: pairing.id, league_round_id: lr1.leagueRoundId, submitted_by_entry_id: e1.id },
      { pairing_id: pairing.id, league_round_id: lr2.leagueRoundId, submitted_by_entry_id: e2.id },
    ]);

    return { pairingId: pairing.id, winnerEntryId: winnerEntry.id, winnerName: p1Wins > p2Wins ? p1Name : p2Name };
  }

  const r1a = await playBracketMatch({
    round: 'r1',
    slot: 0,
    p1Name: 'Shooter McGavin',
    p2Name: 'Ty Webb',
    p1Wins: 11,
    p2Wins: 6,
  });
  const r1b = await playBracketMatch({
    round: 'r1',
    slot: 1,
    p1Name: 'Roy Kent',
    p2Name: 'Danny Ocean',
    p1Wins: 10,
    p2Wins: 7,
  });
  const final = await playBracketMatch({
    round: 'final',
    slot: 0,
    p1Name: 'Shooter McGavin',
    p2Name: 'Roy Kent',
    p1Wins: 12,
    p2Wins: 5,
    feeder1: r1a.pairingId,
    feeder2: r1b.pairingId,
  });

  const mpStats = {
    'Shooter McGavin': { w: 2, l: 0, h: 0 },
    'Roy Kent': { w: 1, l: 1, h: 0 },
    'Danny Ocean': { w: 0, l: 1, h: 0 },
    'Ty Webb': { w: 0, l: 1, h: 0 },
  };

  for (const [name, stats] of Object.entries(mpStats)) {
    const p = profileByName(profiles, name);
    await supabase
      .from('league_entries')
      .update({
        mp_wins: stats.w,
        mp_losses: stats.l,
        mp_halved: stats.h,
        rounds_played: stats.w + stats.l + stats.h,
        position: name === final.winnerName ? 1 : name === 'Roy Kent' ? 2 : null,
      })
      .eq('league_id', league.id)
      .eq('user_id', p.id);
  }

  return {
    league,
    pairings: 3,
    holeScores: holeScoreCount,
    champion: final.winnerName,
  };
}

async function seedSummerKickoff(group, profiles, creator) {
  const today = new Date();
  const course = COURSES[2];

  let league = null;
  const { data: existingLeague } = await supabase
    .from('leagues')
    .select('id, name')
    .eq('group_id', group.id)
    .eq('name', SUMMER_KICKOFF_NAME)
    .eq('is_test', true)
    .maybeSingle();

  if (existingLeague) {
    league = existingLeague;
  } else {
    league = await createLeagueRecord({
      groupId: group.id,
      name: SUMMER_KICKOFF_NAME,
      format: 'stroke',
      status: 'active',
      startDate: isoDate(addDays(today, -14)),
      endDate: isoDate(addDays(today, 28)),
      createdBy: creator.id,
      roundsThatCount: 4,
    });
  }

  let entryByUser = new Map();
  const { data: existingEntries } = await supabase
    .from('league_entries')
    .select('id, user_id')
    .eq('league_id', league.id);

  for (const e of existingEntries ?? []) {
    entryByUser.set(e.user_id, e);
  }

  const missingPlayers = SUMMER_KICKOFF_PLAYERS.filter(
    (name) => !entryByUser.has(profileByName(profiles, name).id)
  );
  if (missingPlayers.length > 0) {
    const added = await createSoloEntries(league.id, missingPlayers, profiles);
    entryByUser = new Map([...entryByUser, ...added]);
  }

  const wiped = await wipeSummerKickoffSubmittedRounds(league.id);

  /** Per-player stroke submissions: 1–2 rounds; `holes` omitted = 18 complete. */
  const submissionPlan = {
    'Shooter McGavin': [
      { daysAgo: 12, grossOffset: -2 },
      { daysAgo: 6, grossOffset: 0 },
    ],
    'Walter White': [
      { daysAgo: 11, grossOffset: 1 },
      { daysAgo: 5, grossOffset: -1 },
    ],
    'Roy Kent': [
      { daysAgo: 10, grossOffset: -1 },
      { daysAgo: 3, holes: 9, grossOffset: 0 },
    ],
    'Ted Lasso': [
      { daysAgo: 9, grossOffset: 2 },
      { daysAgo: 4, grossOffset: 0 },
    ],
    'Danny Ocean': [{ daysAgo: 8, grossOffset: 1 }],
    'Al Czervik': [{ daysAgo: 7, grossOffset: 3 }],
    'Ty Webb': [
      { daysAgo: 13, grossOffset: 0 },
      { daysAgo: 2, grossOffset: 1 },
    ],
    'Danny Noonan': [{ daysAgo: 6, grossOffset: 2 }],
    'Tony Soprano': [{ daysAgo: 5, grossOffset: 4 }],
  };

  let holeScoreCount = 0;
  let leagueRoundCount = 0;
  const submittedSummary = [];
  const completeNetsByUser = new Map();

  for (const name of SUMMER_KICKOFF_PLAYERS) {
    const profile = profileByName(profiles, name);
    const entry = entryByUser.get(profile.id);
    if (!entry) throw new Error(`Summer Kickoff missing entry for ${name}`);

    const plan = submissionPlan[name] ?? [{ daysAgo: 7, grossOffset: 0 }];
    let completeCount = 0;

    for (const sub of plan) {
      const gross = grossForHandicap(profile.handicap) + (sub.grossOffset ?? 0);
      const playedAt = addDays(today, -sub.daysAgo).toISOString();
      const allHoles = holesFromGross(gross);
      const isPartial = sub.holes != null && sub.holes < 18;
      const holes = isPartial ? allHoles.slice(0, sub.holes) : allHoles;

      if (isPartial) {
        const partialGross = holes.reduce((s, h) => s + h.gross_score, 0);
        const round = await insertTournamentRound(profile, course, playedAt);
        const { data: lr, error: lrErr } = await supabase
          .from('league_rounds')
          .insert({
            league_id: league.id,
            user_id: profile.id,
            league_team_id: null,
            round_id: round.id,
            gross_score: partialGross,
            net_score: netScore(partialGross, profile.handicap),
            counted: true,
            player_opted_in: true,
            hole_entry_status: 'pending_holes',
          })
          .select('id')
          .single();
        if (lrErr) throw new Error(`Summer Kickoff partial lr ${name}: ${lrErr.message}`);

        await insertHoleScoreRows(
          holes.map((h) => ({
            league_entry_id: entry.id,
            league_round_id: lr.id,
            user_id: profile.id,
            hole_number: h.hole_number,
            gross_score: h.gross_score,
            is_team_score: false,
            is_test: true,
          }))
        );
        holeScoreCount += holes.length;
        leagueRoundCount++;
        submittedSummary.push(`${name} (${holes.length} pending)`);
      } else {
        const lr = await insertLeagueRoundWithHoles({
          leagueId: league.id,
          profile,
          entryId: entry.id,
          teamId: null,
          course,
          playedAt,
          holes,
        });
        holeScoreCount += holes.length;
        leagueRoundCount++;
        completeCount++;
        const nets = completeNetsByUser.get(profile.id) ?? [];
        nets.push(lr.net);
        completeNetsByUser.set(profile.id, nets);
        submittedSummary.push(`${name} (${holes.length})`);
      }
    }

    const nets = completeNetsByUser.get(profile.id) ?? [];
    const bestNet = nets.length > 0 ? Math.min(...nets.map(Number)) : null;
    await supabase
      .from('league_entries')
      .update({
        rounds_played: completeCount,
        net_score: bestNet != null ? round1(bestNet) : null,
      })
      .eq('league_id', league.id)
      .eq('user_id', profile.id);
  }

  return {
    league,
    players: SUMMER_KICKOFF_PLAYERS.length,
    leagueRounds: leagueRoundCount,
    holeScores: holeScoreCount,
    submitted: submittedSummary,
    wiped,
  };
}

async function seedTournaments(profiles, groups, creator) {
  const basement = groupByName(groups, 'Basement Boys');
  const pacific = groupByName(groups, 'Pacific Simmers');
  const scratch = groupByName(groups, 'The Scratch Pad');

  const scramble = await seedBasementScramble(basement, profiles, creator);
  const bestBall = await seedPacificBestBall(pacific, profiles, creator);
  const bracket = await seedMatchPlayBracket(scratch, profiles, creator);
  const stroke = await seedSummerKickoff(scratch, profiles, creator);

  return { scramble, bestBall, bracket, stroke };
}

// --- main ------------------------------------------------------------------

async function main() {
  const fullSeed = process.env.FULL_SEED === '1';
  console.log(`SimCap test data seed${fullSeed ? ' (full)' : ' (tournaments)'}\n`);

  let profiles;
  let groups;
  let roundCount = null;

  if (fullSeed) {
    const removed = await cleanupPriorTestData();
    if (removed > 0) console.log(`Removed ${removed} prior test user(s).\n`);

    profiles = await createProfiles();
    console.log(`Created ${profiles.length} profiles.`);

    const rounds = await insertRounds(profiles);
    roundCount = rounds.length;
    console.log(`Inserted ${roundCount} rounds.`);

    groups = await insertGroups(profiles);
    console.log(`Created ${groups.length} social groups.\n`);
  } else {
    profiles = await loadTestProfiles();
    groups = await loadTestGroups();
    console.log(`Loaded ${profiles.length} test profiles and ${groups.length} groups.\n`);
  }

  const wiped = await cleanupTestTournaments();
  if (wiped > 0) console.log(`Removed ${wiped} prior test tournament(s).\n`);

  const creator = profiles[0];
  const tournaments = await seedTournaments(profiles, groups, creator);

  console.log('Tournaments seeded:');
  console.log(
    `  ${tournaments.scramble.league.name} (completed) — winner: ${tournaments.scramble.winner}; ${tournaments.scramble.holeScores} hole scores, ${tournaments.scramble.teamHoleScores} team hole rows`
  );
  console.log(
    `  ${tournaments.bestBall.league.name} (completed) — winner: ${tournaments.bestBall.winner}; ${tournaments.bestBall.holeScores} hole scores, ${tournaments.bestBall.teamHoleScores} team hole rows`
  );
  console.log(
    `  ${tournaments.bracket.league.name} (completed) — champion: ${tournaments.bracket.champion}; ${tournaments.bracket.pairings} pairings, ${tournaments.bracket.holeScores} hole scores`
  );
  console.log(
    `  ${tournaments.stroke.league.name} (active) — ${tournaments.stroke.players} players, ${tournaments.stroke.leagueRounds} league rounds${tournaments.stroke.wiped?.leagueRoundsRemoved ? ` (wiped ${tournaments.stroke.wiped.leagueRoundsRemoved} prior)` : ''}`
  );

  console.log('\n--- Summary ---');
  console.log(`Profiles:      ${profiles.length}`);
  for (const p of profiles) {
    console.log(`  ${p.simcapId}  ${p.name.padEnd(18)}  index ${p.handicap}  ${p.platform}`);
  }
  if (roundCount != null) {
    console.log(`Rounds:        ${roundCount} (8–12 per profile, last 90 days)`);
  }
  console.log(`Social groups: ${groups.map((g) => g.name).join(', ')}`);
  console.log(`Tournaments:   ${TOURNAMENT_NAMES.join(', ')}`);
  console.log('\nAll new tournament rows marked is_test = true.');
  if (fullSeed) {
    console.log('Test login emails: <slug>@seed.simcap.test  password: Seed-<simcapId>!');
  }
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message ?? err);
  process.exit(1);
});
