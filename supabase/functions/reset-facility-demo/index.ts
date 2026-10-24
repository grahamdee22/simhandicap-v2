/**
 * Wipe + reseed the facility pitch demo account (demo@seed.simcap.test).
 *
 * Auth (either):
 *   - Header `x-facility-demo-reset-secret` === FACILITY_DEMO_RESET_SECRET
 *   - Authorization Bearer === SUPABASE_SERVICE_ROLE_KEY (pg_cron / vault pattern)
 *
 * Cron: pg_cron → pg_net POST nightly 07:00 UTC (see README).
 * Manual: curl with x-facility-demo-reset-secret (do not share with demo login).
 *
 * Not in the app bundle — shared demo login cannot trigger a reset.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/http.ts';

const DEMO_EMAIL = 'demo@seed.simcap.test';
const DEMO_PASSWORD = 'Seed-550011!';
const DEMO_SIMCAP = '550011';
const DEMO_DISPLAY = 'Alex Rivera';
const DEMO_PLATFORM = 'GSPro';
const DEMO_TARGET_INDEX = 12.0;

const GROUP_NAME = 'SimCap Crew';
const SEASON_NAME = '2026 Open Season';

const SIM_BASELINE = 0.88;
const PUTTING_MULT: Record<string, number> = { putt_all: 1.0, auto_2putt: 1.15, gimme_5: 1.05 };
const PIN_MULT: Record<string, number> = { thu: 1.12, fri: 1.08, sat: 1.04, sun: 1.0 };
const WIND_MULT: Record<string, number> = { off: 1.1, light: 1.05, strong: 1.0 };
const MULL_MULT: Record<string, number> = { on: 1.15, off: 1.0 };

const COURSES = [
  { id: 'pebble', name: 'Pebble Beach Golf Links', rating: 72.1, slope: 128, tee: 'White', par: 72 },
  { id: 'augusta', name: 'Augusta National Golf Club', rating: 74.2, slope: 132, tee: 'Green', par: 72 },
  { id: 'waste-mgmt', name: 'TPC Scottsdale Stadium', rating: 72.7, slope: 133, tee: 'Blue', par: 71 },
  { id: 'bethpage', name: 'Bethpage Black', rating: 75.4, slope: 144, tee: 'Black', par: 71 },
  { id: 'torrey-south', name: 'Torrey Pines South', rating: 75.3, slope: 144, tee: 'Blue', par: 72 },
] as const;

const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];

type Companion = {
  email: string;
  password: string;
  simcap: string;
  displayName: string;
  platform: string;
  targetIndex: number;
};

const COMPANIONS: Companion[] = [
  {
    email: 'jamie@seed.simcap.test',
    password: 'Seed-550012!',
    simcap: '550012',
    displayName: 'Jamie Chen',
    platform: 'Trackman',
    targetIndex: 8.2,
  },
  {
    email: 'morgan@seed.simcap.test',
    password: 'Seed-550013!',
    simcap: '550013',
    displayName: 'Morgan Blake',
    platform: 'Foresight',
    targetIndex: 14.6,
  },
  {
    email: 'taylor@seed.simcap.test',
    password: 'Seed-550014!',
    simcap: '550014',
    displayName: 'Taylor Brooks',
    platform: 'Uneekor',
    targetIndex: 22.1,
  },
  {
    email: 'riley@seed.simcap.test',
    password: 'Seed-550015!',
    simcap: '550015',
    displayName: 'Riley Quinn',
    platform: 'GSPro',
    targetIndex: 10.4,
  },
  {
    email: 'casey@seed.simcap.test',
    password: 'Seed-550016!',
    simcap: '550016',
    displayName: 'Casey Nguyen',
    platform: 'Trackman',
    targetIndex: 16.8,
  },
  {
    email: 'sam@seed.simcap.test',
    password: 'Seed-550017!',
    simcap: '550017',
    displayName: 'Sam Ortiz',
    platform: 'Foresight',
    targetIndex: 6.5,
  },
  {
    email: 'jordan@seed.simcap.test',
    password: 'Seed-550018!',
    simcap: '550018',
    displayName: 'Jordan Hale',
    platform: 'Uneekor',
    targetIndex: 19.3,
  },
];

type CoursePick = (typeof COURSES)[number];

type Player = {
  id: string;
  name: string;
  platform: string;
  index: number;
};

type HoleGross = { hole_number: number; gross_score: number; result?: string | null };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCHours(14, 30, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

function ymdDaysAgo(n: number): string {
  return daysAgoIso(n).slice(0, 10);
}

function ymdDaysFromNow(n: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function difficultyProduct(putting: string, pin: string, wind: string, mull: string): number {
  const product =
    (PUTTING_MULT[putting] ?? 1) *
    (PIN_MULT[pin] ?? 1) *
    (WIND_MULT[wind] ?? 1) *
    (MULL_MULT[mull] ?? 1) *
    SIM_BASELINE;
  return Math.max(0.7, product);
}

function adjustedDifferential(
  gross: number,
  rating: number,
  slope: number,
  putting: string,
  pin: string,
  wind: string,
  mull: string
): { raw: number; adjusted: number; modifier: number } {
  const modifier = round2(difficultyProduct(putting, pin, wind, mull));
  const raw = slope > 0 ? round1(((gross - rating) * 113) / slope) : 0;
  return { raw, adjusted: round1(raw * modifier), modifier };
}

function handicapIndexFromDifferentials(adjusted: number[]): number | null {
  if (adjusted.length === 0) return null;
  const window = adjusted.slice(-20);
  const sorted = [...window].sort((a, b) => a - b);
  const k = Math.min(8, sorted.length);
  const best = sorted.slice(0, k);
  const avg = best.reduce((s, x) => s + x, 0) / best.length;
  return round1(avg * 0.96);
}

function courseHandicap(index: number, slope: number): number {
  return Math.round((index * slope) / 113);
}

function scoreForTargetAdjustedDiff(
  targetAdj: number,
  rating: number,
  slope: number,
  putting: string,
  pin: string,
  wind: string,
  mull: string,
  par: number
): number {
  const mod = difficultyProduct(putting, pin, wind, mull);
  const raw = targetAdj / mod;
  let score = Math.round(rating + (raw * slope) / 113);
  score = Math.max(par - 6, Math.min(par + 30, score));
  return score;
}

function generateHoleScores(gross: number): number[] {
  const scores = [...PARS];
  let total = scores.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (total < gross && guard < 200) {
    scores[guard % 18] += 1;
    total += 1;
    guard += 1;
  }
  while (total > gross && guard < 400) {
    const i = guard % 18;
    if (scores[i] > 1) {
      scores[i] -= 1;
      total -= 1;
    }
    guard += 1;
  }
  return scores;
}

function holesFromGross(gross: number): HoleGross[] {
  return generateHoleScores(gross).map((gross_score, i) => ({
    hole_number: i + 1,
    gross_score,
  }));
}

/** Deterministic match-play hole pairs so p1 wins `p1Wins` holes, p2 wins `p2Wins`. */
function matchPlayHoleScores(p1Wins: number, p2Wins: number, halved = 1) {
  const p1: HoleGross[] = [];
  const p2: HoleGross[] = [];
  let w1 = 0;
  let w2 = 0;
  let h = 0;
  for (let hole = 1; hole <= 18; hole++) {
    let g1 = 4;
    let g2 = 4;
    if (w1 < p1Wins) {
      g1 = 4;
      g2 = 5;
      w1++;
    } else if (w2 < p2Wins) {
      g1 = 5;
      g2 = 4;
      w2++;
    } else if (h < halved) {
      g1 = 4;
      g2 = 4;
      h++;
    } else if (w1 <= w2) {
      g2 = 5;
      w1++;
    } else {
      g1 = 5;
      w2++;
    }
    p1.push({ hole_number: hole, gross_score: g1 });
    p2.push({ hole_number: hole, gross_score: g2 });
  }
  return { p1, p2, holes_won_p1: w1, holes_won_p2: w2, holes_halved: h };
}

function bestBallTeamHoles(
  memberHoles: HoleGross[][],
  handicapA: number,
  handicapB: number
): { hole_number: number; team_score: number; team_net_score: number }[] {
  const strokesA = Math.round(handicapA);
  const strokesB = Math.round(handicapB);
  const team = [];
  for (let i = 0; i < 18; i++) {
    const g1 = memberHoles[0][i].gross_score;
    const g2 = memberHoles[1][i].gross_score;
    const n1 = g1 - strokesA;
    const n2 = g2 - strokesB;
    team.push({
      hole_number: i + 1,
      team_score: Math.min(g1, g2),
      team_net_score: round1(Math.min(n1, n2)),
    });
  }
  return team;
}

function flatNet(gross: number, index: number): number {
  return round1(Math.max(1, gross - Math.round(index)));
}

function authorized(req: Request): boolean {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const demoSecret = Deno.env.get('FACILITY_DEMO_RESET_SECRET') ?? '';
  const providedSecret = req.headers.get('x-facility-demo-reset-secret') ?? '';
  const auth = req.headers.get('Authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if (demoSecret && providedSecret && providedSecret === demoSecret) return true;
  if (serviceKey && bearer && bearer === serviceKey) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Headers':
          'authorization, x-client-info, apikey, content-type, x-facility-demo-reset-secret',
      },
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  if (!authorized(req)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'Missing Supabase env' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const result = await wipeAndReseed(admin);
    return jsonResponse({ ok: true, ...result });
  } catch (e) {
    console.error('[reset-facility-demo]', e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : String(e) },
      500
    );
  }
});

async function findUserIdByEmail(
  admin: SupabaseClient,
  email: string
): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    const hit = data?.users?.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  return null;
}

async function ensureUser(
  admin: SupabaseClient,
  opts: {
    email: string;
    password: string;
    simcap: string;
    displayName: string;
    platform: string;
  }
): Promise<string> {
  let userId = await findUserIdByEmail(admin, opts.email);

  if (!userId) {
    const { data: bySimcap } = await admin
      .from('profiles')
      .select('id')
      .eq('simcap_id', opts.simcap)
      .maybeSingle();
    userId = bySimcap?.id ?? null;
  }

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: opts.email,
      password: opts.password,
      email_confirm: true,
      user_metadata: {
        display_name: opts.displayName,
        simcap_id: opts.simcap,
      },
    });
    if (error || !data.user) {
      if (error && /already|registered|exists/i.test(error.message)) {
        userId = await findUserIdByEmail(admin, opts.email);
        if (!userId) throw new Error(`createUser ${opts.email}: ${error.message}`);
      } else {
        throw new Error(`createUser ${opts.email}: ${error?.message ?? 'unknown'}`);
      }
    } else {
      userId = data.user.id;
    }
  } else {
    await admin.auth.admin.updateUserById(userId, {
      password: opts.password,
      email_confirm: true,
      user_metadata: {
        display_name: opts.displayName,
        simcap_id: opts.simcap,
      },
    });
  }

  const { error: profileErr } = await admin.from('profiles').upsert(
    {
      id: userId,
      display_name: opts.displayName,
      preferred_platform: opts.platform,
      simcap_id: opts.simcap,
      is_test: true,
      is_app_admin: false,
      ghin_index: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (profileErr) throw new Error(`profile upsert ${opts.email}: ${profileErr.message}`);

  return userId!;
}

async function wipeUserOwnedData(admin: SupabaseClient, userIds: string[]): Promise<void> {
  if (!userIds.length) return;

  const { data: leagues } = await admin.from('leagues').select('id').in('created_by', userIds);
  const leagueIds = (leagues ?? []).map((l) => l.id as string);
  if (leagueIds.length) {
    await admin.from('leagues').delete().in('id', leagueIds);
  }

  const { data: groups } = await admin
    .from('social_groups')
    .select('id')
    .in('created_by', userIds);
  const groupIds = (groups ?? []).map((g) => g.id as string);
  if (groupIds.length) {
    await admin.from('league_seasons').delete().in('group_id', groupIds);
    await admin.from('social_groups').delete().in('id', groupIds);
  }

  await admin.from('group_members').delete().in('user_id', userIds);

  const { data: matches } = await admin
    .from('matches')
    .select('id')
    .in('created_by', userIds);
  if (matches?.length) {
    await admin.from('matches').delete().in(
      'id',
      matches.map((m) => m.id)
    );
  }

  await admin.from('rounds').delete().in('user_id', userIds);

  await admin
    .from('profiles')
    .update({ ghin_index: null, updated_at: new Date().toISOString() })
    .in('id', userIds);
}

async function insertRound(
  admin: SupabaseClient,
  opts: {
    userId: string;
    course: CoursePick;
    platform: string;
    playedAt: string;
    gross: number;
    putting: string;
    pin: string;
    wind: string;
    mulligans: string;
    simcapIndexAtTime: number | null;
    holeScores?: number[];
  }
): Promise<{ id: string; adjusted: number; net: number; gross: number }> {
  const { raw, adjusted, modifier } = adjustedDifferential(
    opts.gross,
    opts.course.rating,
    opts.course.slope,
    opts.putting,
    opts.pin,
    opts.wind,
    opts.mulligans
  );
  const ch = courseHandicap(opts.simcapIndexAtTime ?? 18, opts.course.slope);
  const net = opts.gross - ch;
  const holeScores = opts.holeScores ?? generateHoleScores(opts.gross);

  const { data, error } = await admin
    .from('rounds')
    .insert({
      user_id: opts.userId,
      course_id: opts.course.id,
      course_name: opts.course.name,
      platform: opts.platform,
      gross_score: opts.gross,
      hole_scores: holeScores,
      putting_mode: opts.putting,
      pin_placement: opts.pin,
      wind: opts.wind,
      mulligans: opts.mulligans,
      difficulty_modifier: modifier,
      differential: adjusted,
      differential_version: 1,
      raw_differential: raw,
      course_rating: opts.course.rating,
      slope: opts.course.slope,
      tee_name: opts.course.tee,
      played_at: opts.playedAt,
      simcap_index_at_time: opts.simcapIndexAtTime,
      handicap_source: 'verified',
      tee_rating_source: 'curated',
      excludes_from_simcap_index: false,
      holes_played: '18',
      is_active: true,
      is_test: true,
      course_par: opts.course.par,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`insert round: ${error?.message ?? 'no id'}`);
  return { id: data.id as string, adjusted, net, gross: opts.gross };
}

async function seedPlayerRounds(
  admin: SupabaseClient,
  userId: string,
  platform: string,
  targetIndex: number,
  roundCount: number,
  dayOffsets: number[]
): Promise<{ roundIds: string[]; finalIndex: number }> {
  const roundIds: string[] = [];
  const diffs: number[] = [];
  let runningIndex: number | null = null;

  const puttings = ['putt_all', 'gimme_5', 'auto_2putt', 'putt_all', 'gimme_5'] as const;
  const pins = ['thu', 'fri', 'sat', 'sun', 'sat'] as const;
  const winds = ['off', 'light', 'strong', 'light', 'off'] as const;
  const mulls = ['off', 'off', 'on', 'off', 'off'] as const;
  const jitter = [
    -1.2, 0.4, -0.6, 1.1, 0.2, -0.9, 1.5, -0.3, 0.7, -1.0, 1.3, 0.0, -0.5, 0.9, -1.4, 0.6, 1.0,
    -0.2, 0.8, -0.7,
  ];

  const chronological = [...Array(roundCount).keys()].reverse();

  for (const i of chronological) {
    const course = COURSES[i % COURSES.length];
    const putting = puttings[i % puttings.length];
    const pin = pins[i % pins.length];
    const wind = winds[i % winds.length];
    const mull = mulls[i % mulls.length];
    const targetAdj = targetIndex / 0.96 + (jitter[i % jitter.length] ?? 0);
    const gross = scoreForTargetAdjustedDiff(
      targetAdj,
      course.rating,
      course.slope,
      putting,
      pin,
      wind,
      mull,
      course.par
    );
    const { id, adjusted } = await insertRound(admin, {
      userId,
      course,
      platform,
      playedAt: daysAgoIso(dayOffsets[i] ?? i + 1),
      gross,
      putting,
      pin,
      wind,
      mulligans: mull,
      simcapIndexAtTime: runningIndex,
    });
    roundIds.push(id);
    diffs.push(adjusted);
    runningIndex = handicapIndexFromDifferentials(diffs);
  }

  const finalIndex = handicapIndexFromDifferentials(diffs) ?? targetIndex;
  await admin
    .from('profiles')
    .update({ ghin_index: finalIndex, updated_at: new Date().toISOString() })
    .eq('id', userId);

  return { roundIds, finalIndex };
}

async function createLeague(
  admin: SupabaseClient,
  opts: Record<string, unknown>
): Promise<{ id: string; name: string; format: string; status: string }> {
  const { data, error } = await admin
    .from('leagues')
    .insert({ is_test: true, holes_per_round: '18', use_handicap: true, ...opts })
    .select('id, name, format, status')
    .single();
  if (error || !data) throw new Error(`league ${opts.name}: ${error?.message ?? 'failed'}`);
  return data as { id: string; name: string; format: string; status: string };
}

async function insertLeagueRoundWithHoles(
  admin: SupabaseClient,
  opts: {
    leagueId: string;
    player: Player;
    entryId: string;
    teamId: string | null;
    course: CoursePick;
    playedAt: string;
    holes: HoleGross[];
    isTeamScore?: boolean;
  }
): Promise<{ leagueRoundId: string; gross: number; net: number; roundDate: string }> {
  const gross = opts.holes.reduce((s, h) => s + h.gross_score, 0);
  const net = flatNet(gross, opts.player.index);
  const { id: roundId } = await insertRound(admin, {
    userId: opts.player.id,
    course: opts.course,
    platform: opts.player.platform,
    playedAt: opts.playedAt,
    gross,
    putting: 'putt_all',
    pin: 'sat',
    wind: 'light',
    mulligans: 'off',
    simcapIndexAtTime: opts.player.index,
    holeScores: opts.holes.map((h) => h.gross_score),
  });

  const { data: lr, error: lrErr } = await admin
    .from('league_rounds')
    .insert({
      league_id: opts.leagueId,
      user_id: opts.player.id,
      league_team_id: opts.teamId,
      round_id: roundId,
      gross_score: gross,
      net_score: net,
      counted: true,
      player_opted_in: true,
      hole_entry_status: 'complete',
    })
    .select('id')
    .single();
  if (lrErr || !lr) throw new Error(`league_rounds: ${lrErr?.message ?? 'failed'}`);

  const { error: hsErr } = await admin.from('tournament_hole_scores').insert(
    opts.holes.map((h) => ({
      league_entry_id: opts.entryId,
      league_round_id: lr.id,
      user_id: opts.player.id,
      hole_number: h.hole_number,
      gross_score: h.gross_score,
      result: h.result ?? null,
      is_team_score: !!opts.isTeamScore,
      is_test: true,
    }))
  );
  if (hsErr) throw new Error(`tournament_hole_scores: ${hsErr.message}`);

  return {
    leagueRoundId: lr.id as string,
    gross,
    net,
    roundDate: opts.playedAt.slice(0, 10),
  };
}

async function createTeamsAndEntries(
  admin: SupabaseClient,
  leagueId: string,
  teamDefs: {
    name: string;
    members: Player[];
    designatedScorerId?: string | null;
  }[]
): Promise<{
  teams: { id: string; name: string; members: Player[] }[];
  entryByUser: Map<string, { id: string; user_id: string; league_team_id: string }>;
}> {
  const entryByUser = new Map<string, { id: string; user_id: string; league_team_id: string }>();
  const teams: { id: string; name: string; members: Player[] }[] = [];

  for (const def of teamDefs) {
    const { data: team, error: tErr } = await admin
      .from('league_teams')
      .insert({
        league_id: leagueId,
        name: def.name,
        designated_scorer_id: def.designatedScorerId ?? null,
        is_test: true,
      })
      .select('id, name')
      .single();
    if (tErr || !team) throw new Error(`league_teams ${def.name}: ${tErr?.message}`);

    await admin.from('league_team_members').insert(
      def.members.map((m) => ({ league_team_id: team.id, user_id: m.id }))
    );

    const { data: entries, error: eErr } = await admin
      .from('league_entries')
      .insert(
        def.members.map((m) => ({
          league_id: leagueId,
          user_id: m.id,
          league_team_id: team.id,
          rounds_played: 0,
          points: 0,
        }))
      )
      .select('id, user_id, league_team_id');
    if (eErr) throw new Error(`league_entries ${def.name}: ${eErr.message}`);
    for (const e of entries ?? []) {
      entryByUser.set(e.user_id as string, e as { id: string; user_id: string; league_team_id: string });
    }
    teams.push({ id: team.id as string, name: def.name, members: def.members });
  }

  return { teams, entryByUser };
}

async function seedCompletedStroke(
  admin: SupabaseClient,
  opts: {
    groupId: string;
    seasonId: string;
    createdBy: string;
    players: Player[];
    name: string;
  }
) {
  const league = await createLeague(admin, {
    group_id: opts.groupId,
    name: opts.name,
    format: 'stroke',
    scoring_method: 'stroke',
    start_date: ymdDaysAgo(45),
    end_date: ymdDaysAgo(10),
    rounds_that_count: 4,
    created_by: opts.createdBy,
    status: 'completed',
    season_id: opts.seasonId,
    notes: 'Facility demo — completed stroke event with net leaderboard.',
  });

  await admin.from('league_entries').insert(
    opts.players.map((p) => ({ league_id: league.id, user_id: p.id }))
  );

  const dayOffsets = [12, 20, 28, 38];
  const standings: { userId: string; total: number }[] = [];

  for (const player of opts.players) {
    const nets: number[] = [];
    for (let i = 0; i < 4; i++) {
      const course = COURSES[(i + 2) % COURSES.length];
      const targetAdj = player.index / 0.96 + (i % 2 === 0 ? -0.4 : 0.7);
      const gross = scoreForTargetAdjustedDiff(
        targetAdj,
        course.rating,
        course.slope,
        'putt_all',
        'sat',
        'light',
        'off',
        course.par
      );
      const { id: roundId, net } = await insertRound(admin, {
        userId: player.id,
        course,
        platform: player.platform,
        playedAt: daysAgoIso(dayOffsets[i]),
        gross,
        putting: 'putt_all',
        pin: 'sat',
        wind: 'light',
        mulligans: 'off',
        simcapIndexAtTime: player.index,
      });
      nets.push(net);
      const { error } = await admin.from('league_rounds').insert({
        league_id: league.id,
        user_id: player.id,
        round_id: roundId,
        gross_score: gross,
        net_score: net,
        counted: true,
        player_opted_in: true,
        hole_entry_status: 'complete',
      });
      if (error) throw new Error(`stroke league_rounds: ${error.message}`);
    }
    standings.push({ userId: player.id, total: nets.reduce((s, n) => s + n, 0) });
  }

  standings.sort((a, b) => a.total - b.total);
  for (let i = 0; i < standings.length; i++) {
    await admin
      .from('league_entries')
      .update({
        rounds_played: 4,
        net_score: standings[i].total,
        position: i + 1,
        points: Math.max(0, 120 - i * 10),
      })
      .eq('league_id', league.id)
      .eq('user_id', standings[i].userId);
  }

  return league;
}

async function seedOpenStroke(
  admin: SupabaseClient,
  opts: {
    groupId: string;
    seasonId: string;
    createdBy: string;
    players: Player[];
    name: string;
  }
) {
  const league = await createLeague(admin, {
    group_id: opts.groupId,
    name: opts.name,
    format: 'stroke',
    scoring_method: 'stroke',
    start_date: ymdDaysAgo(7),
    end_date: ymdDaysFromNow(21),
    rounds_that_count: 3,
    created_by: opts.createdBy,
    status: 'active',
    season_id: opts.seasonId,
  });

  await admin.from('league_entries').insert(
    opts.players.map((p) => ({ league_id: league.id, user_id: p.id }))
  );

  for (const player of opts.players) {
    const course = COURSES[0];
    const gross = scoreForTargetAdjustedDiff(
      player.index / 0.96,
      course.rating,
      course.slope,
      'putt_all',
      'fri',
      'off',
      'off',
      course.par
    );
    const { id: roundId, net } = await insertRound(admin, {
      userId: player.id,
      course,
      platform: player.platform,
      playedAt: daysAgoIso(3),
      gross,
      putting: 'putt_all',
      pin: 'fri',
      wind: 'off',
      mulligans: 'off',
      simcapIndexAtTime: player.index,
    });
    await admin.from('league_rounds').insert({
      league_id: league.id,
      user_id: player.id,
      round_id: roundId,
      gross_score: gross,
      net_score: net,
      counted: true,
      player_opted_in: true,
      hole_entry_status: 'complete',
    });
    await admin
      .from('league_entries')
      .update({ rounds_played: 1, net_score: net })
      .eq('league_id', league.id)
      .eq('user_id', player.id);
  }

  return league;
}

async function seedCompletedScramble(
  admin: SupabaseClient,
  opts: {
    groupId: string;
    seasonId: string;
    createdBy: string;
    players: Player[];
  }
) {
  const league = await createLeague(admin, {
    group_id: opts.groupId,
    name: 'Clubhouse Scramble',
    format: 'scramble',
    scoring_method: 'scramble',
    start_date: ymdDaysAgo(50),
    end_date: ymdDaysAgo(18),
    rounds_that_count: 1,
    created_by: opts.createdBy,
    status: 'completed',
    season_id: opts.seasonId,
  });

  const p = opts.players;
  const teamDefs = [
    { name: 'Pin Seekers', members: [p[0], p[1]], designatedScorerId: p[0].id, targetGross: 68 },
    { name: 'Fairway Four', members: [p[2], p[3]], designatedScorerId: p[2].id, targetGross: 72 },
    { name: 'Range Rats', members: [p[4], p[5]], designatedScorerId: p[4].id, targetGross: 75 },
    { name: 'Mulligan Club', members: [p[6], p[7]], designatedScorerId: p[6].id, targetGross: 79 },
  ];

  const { teams, entryByUser } = await createTeamsAndEntries(admin, league.id, teamDefs);
  const course = COURSES[3];
  const playedAt = daysAgoIso(32);
  const results: { team: (typeof teams)[0]; gross: number; net: number }[] = [];

  for (let ti = 0; ti < teams.length; ti++) {
    const team = teams[ti];
    const scorer = team.members[0];
    const entry = entryByUser.get(scorer.id)!;
    const holes = holesFromGross(teamDefs[ti].targetGross);
    const lr = await insertLeagueRoundWithHoles(admin, {
      leagueId: league.id,
      player: scorer,
      entryId: entry.id,
      teamId: team.id,
      course,
      playedAt,
      holes,
      isTeamScore: true,
    });
    await admin.from('tournament_team_hole_scores').insert(
      holes.map((h) => ({
        league_id: league.id,
        league_team_id: team.id,
        round_date: lr.roundDate,
        hole_number: h.hole_number,
        team_score: h.gross_score,
        team_net_score: h.gross_score,
        is_partial: false,
        source_league_round_id: lr.leagueRoundId,
        is_test: true,
      }))
    );
    results.push({ team, gross: lr.gross, net: lr.net });
  }

  results.sort((a, b) => a.gross - b.gross);
  for (let i = 0; i < results.length; i++) {
    for (const m of results[i].team.members) {
      await admin
        .from('league_entries')
        .update({ rounds_played: 1, net_score: results[i].net, position: i + 1, points: Math.max(0, 80 - i * 15) })
        .eq('league_id', league.id)
        .eq('user_id', m.id);
    }
  }

  return { league, winner: results[0].team.name };
}

async function seedCompletedBestBall(
  admin: SupabaseClient,
  opts: {
    groupId: string;
    seasonId: string;
    createdBy: string;
    players: Player[];
  }
) {
  const league = await createLeague(admin, {
    group_id: opts.groupId,
    name: 'Fairway Best Ball',
    format: 'best_ball',
    scoring_method: 'best_ball',
    start_date: ymdDaysAgo(42),
    end_date: ymdDaysAgo(14),
    rounds_that_count: 1,
    created_by: opts.createdBy,
    status: 'completed',
    season_id: opts.seasonId,
  });

  const p = opts.players;
  const teamDefs = [
    { name: 'Blue Tees', members: [p[0], p[3]], g: [72, 76] as [number, number] },
    { name: 'Green Jackets', members: [p[1], p[2]], g: [74, 75] as [number, number] },
    { name: 'Sunset Pair', members: [p[4], p[5]], g: [78, 81] as [number, number] },
    { name: 'Back Nine', members: [p[6], p[7]], g: [80, 84] as [number, number] },
  ];

  const { teams, entryByUser } = await createTeamsAndEntries(admin, league.id, teamDefs);
  const course = COURSES[4];
  const playedAt = daysAgoIso(28);
  const totals: { team: (typeof teams)[0]; teamGross: number; teamNet: number }[] = [];

  for (let ti = 0; ti < teams.length; ti++) {
    const team = teams[ti];
    const [a, b] = team.members;
    const h1 = holesFromGross(teamDefs[ti].g[0]);
    const h2 = holesFromGross(teamDefs[ti].g[1]);
    const lr1 = await insertLeagueRoundWithHoles(admin, {
      leagueId: league.id,
      player: a,
      entryId: entryByUser.get(a.id)!.id,
      teamId: team.id,
      course,
      playedAt,
      holes: h1,
    });
    await insertLeagueRoundWithHoles(admin, {
      leagueId: league.id,
      player: b,
      entryId: entryByUser.get(b.id)!.id,
      teamId: team.id,
      course,
      playedAt,
      holes: h2,
    });
    const teamHoles = bestBallTeamHoles([h1, h2], a.index, b.index);
    const teamGross = teamHoles.reduce((s, h) => s + h.team_score, 0);
    const teamNet = teamHoles.reduce((s, h) => s + Number(h.team_net_score), 0);
    await admin.from('tournament_team_hole_scores').insert(
      teamHoles.map((h) => ({
        league_id: league.id,
        league_team_id: team.id,
        round_date: lr1.roundDate,
        hole_number: h.hole_number,
        team_score: h.team_score,
        team_net_score: h.team_net_score,
        is_partial: false,
        source_league_round_id: lr1.leagueRoundId,
        is_test: true,
      }))
    );
    totals.push({ team, teamGross, teamNet });
  }

  totals.sort((a, b) => a.teamGross - b.teamGross);
  for (let i = 0; i < totals.length; i++) {
    for (const m of totals[i].team.members) {
      await admin
        .from('league_entries')
        .update({
          rounds_played: 1,
          net_score: round1(totals[i].teamNet),
          position: i + 1,
          points: Math.max(0, 80 - i * 15),
        })
        .eq('league_id', league.id)
        .eq('user_id', m.id);
    }
  }

  return { league, winner: totals[0].team.name };
}

async function seedCompletedMatchPlay(
  admin: SupabaseClient,
  opts: {
    groupId: string;
    seasonId: string;
    createdBy: string;
    players: Player[];
  }
) {
  // Seed by index ascending (best first) — classic bracket seeding.
  const seeded = [...opts.players].sort((a, b) => a.index - b.index);
  const league = await createLeague(admin, {
    group_id: opts.groupId,
    name: 'Bracket Championship',
    format: 'match_play',
    scoring_method: 'match_play',
    start_date: ymdDaysAgo(40),
    end_date: ymdDaysAgo(8),
    rounds_that_count: 1,
    created_by: opts.createdBy,
    status: 'completed',
    season_id: opts.seasonId,
    match_play_pairing_method: 'bracket',
    current_bracket_round: null,
  });

  const entryByUser = new Map<string, { id: string; user_id: string }>();
  const { data: entries, error: eErr } = await admin
    .from('league_entries')
    .insert(
      seeded.map((p, idx) => ({
        league_id: league.id,
        user_id: p.id,
        bracket_seed: idx + 1,
        mp_wins: 0,
        mp_losses: 0,
        mp_halved: 0,
        rounds_played: 0,
        points: 0,
      }))
    )
    .select('id, user_id');
  if (eErr) throw new Error(`mp entries: ${eErr.message}`);
  for (const e of entries ?? []) entryByUser.set(e.user_id as string, e as { id: string; user_id: string });

  const bySeed = (s: number) => seeded[s - 1];
  const entryOf = (p: Player) => entryByUser.get(p.id)!;
  const course = COURSES[1];
  const completedAt = daysAgoIso(8);
  const stats = new Map<string, { w: number; l: number }>();
  for (const p of seeded) stats.set(p.id, { w: 0, l: 0 });

  async function playMatch(args: {
    round: 'r1' | 'semifinal' | 'final';
    slot: number;
    p1: Player;
    p2: Player;
    p1Wins: number;
    p2Wins: number;
    feeder1?: string | null;
    feeder2?: string | null;
    playedDaysAgo: number;
  }) {
    const sim = matchPlayHoleScores(args.p1Wins, args.p2Wins, 1);
    const e1 = entryOf(args.p1);
    const e2 = entryOf(args.p2);
    const winner = args.p1Wins > args.p2Wins ? args.p1 : args.p2;
    const loser = winner.id === args.p1.id ? args.p2 : args.p1;
    const playedAt = daysAgoIso(args.playedDaysAgo);

    const { data: pairing, error: pErr } = await admin
      .from('league_match_pairings')
      .insert({
        league_id: league.id,
        player_1_entry_id: e1.id,
        player_2_entry_id: e2.id,
        status: 'complete',
        winner_entry_id: entryOf(winner).id,
        holes_won_p1: sim.holes_won_p1,
        holes_won_p2: sim.holes_won_p2,
        holes_halved: sim.holes_halved,
        scheduled_at: playedAt,
        completed_at: completedAt,
        bracket_round: args.round,
        bracket_slot: args.slot,
        feeder_pairing_1_id: args.feeder1 ?? null,
        feeder_pairing_2_id: args.feeder2 ?? null,
      })
      .select('id')
      .single();
    if (pErr || !pairing) throw new Error(`pairing: ${pErr?.message}`);

    const withResults = (holes: HoleGross[], opp: HoleGross[]): HoleGross[] =>
      holes.map((h, i) => {
        const g1 = h.gross_score;
        const g2 = opp[i].gross_score;
        let result = 'H';
        if (g1 < g2) result = 'W';
        else if (g1 > g2) result = 'L';
        return { ...h, result };
      });

    const lr1 = await insertLeagueRoundWithHoles(admin, {
      leagueId: league.id,
      player: args.p1,
      entryId: e1.id,
      teamId: null,
      course,
      playedAt,
      holes: withResults(sim.p1, sim.p2),
    });
    const lr2 = await insertLeagueRoundWithHoles(admin, {
      leagueId: league.id,
      player: args.p2,
      entryId: e2.id,
      teamId: null,
      course,
      playedAt,
      holes: withResults(sim.p2, sim.p1),
    });

    await admin.from('league_match_pairing_rounds').insert([
      { pairing_id: pairing.id, league_round_id: lr1.leagueRoundId, submitted_by_entry_id: e1.id },
      { pairing_id: pairing.id, league_round_id: lr2.leagueRoundId, submitted_by_entry_id: e2.id },
    ]);

    stats.get(winner.id)!.w += 1;
    stats.get(loser.id)!.l += 1;
    return { pairingId: pairing.id as string, winner };
  }

  // Classic 8-player: 1v8, 4v5, 2v7, 3v6
  const r1a = await playMatch({
    round: 'r1',
    slot: 0,
    p1: bySeed(1),
    p2: bySeed(8),
    p1Wins: 11,
    p2Wins: 6,
    playedDaysAgo: 30,
  });
  const r1b = await playMatch({
    round: 'r1',
    slot: 1,
    p1: bySeed(4),
    p2: bySeed(5),
    p1Wins: 10,
    p2Wins: 7,
    playedDaysAgo: 29,
  });
  const r1c = await playMatch({
    round: 'r1',
    slot: 2,
    p1: bySeed(2),
    p2: bySeed(7),
    p1Wins: 12,
    p2Wins: 5,
    playedDaysAgo: 28,
  });
  const r1d = await playMatch({
    round: 'r1',
    slot: 3,
    p1: bySeed(3),
    p2: bySeed(6),
    p1Wins: 9,
    p2Wins: 8,
    playedDaysAgo: 27,
  });

  const sf1 = await playMatch({
    round: 'semifinal',
    slot: 0,
    p1: r1a.winner,
    p2: r1b.winner,
    p1Wins: 10,
    p2Wins: 7,
    feeder1: r1a.pairingId,
    feeder2: r1b.pairingId,
    playedDaysAgo: 18,
  });
  const sf2 = await playMatch({
    round: 'semifinal',
    slot: 1,
    p1: r1c.winner,
    p2: r1d.winner,
    p1Wins: 11,
    p2Wins: 6,
    feeder1: r1c.pairingId,
    feeder2: r1d.pairingId,
    playedDaysAgo: 17,
  });

  const final = await playMatch({
    round: 'final',
    slot: 0,
    p1: sf1.winner,
    p2: sf2.winner,
    p1Wins: 12,
    p2Wins: 5,
    feeder1: sf1.pairingId,
    feeder2: sf2.pairingId,
    playedDaysAgo: 9,
  });

  // Positions: champion 1, finalist 2, semifinal losers share 3
  const positionById = new Map<string, number>();
  positionById.set(final.winner.id, 1);
  const finalist = sf1.winner.id === final.winner.id ? sf2.winner : sf1.winner;
  positionById.set(finalist.id, 2);
  for (const w of [r1a.winner, r1b.winner, r1c.winner, r1d.winner]) {
    if (!positionById.has(w.id) && (w.id === sf1.winner.id || w.id === sf2.winner.id || true)) {
      // semifinal losers already have wins but lost SF
    }
  }
  const sfLosers = [sf1, sf2]
    .map((sf) => (sf.winner.id === final.winner.id || sf.winner.id === finalist.id
      ? seeded.find((p) => stats.get(p.id)!.w >= 1 && !positionById.has(p.id))
      : null))
    .filter(Boolean);
  // Simpler: anyone with 1 win and not finalist/champ → 3rd
  for (const p of seeded) {
    if (positionById.has(p.id)) continue;
    const st = stats.get(p.id)!;
    if (st.w === 1) positionById.set(p.id, 3);
    else if (st.w === 0) positionById.set(p.id, 5);
  }
  void sfLosers;

  for (const p of seeded) {
    const st = stats.get(p.id)!;
    await admin
      .from('league_entries')
      .update({
        mp_wins: st.w,
        mp_losses: st.l,
        mp_halved: 0,
        rounds_played: st.w + st.l,
        position: positionById.get(p.id) ?? null,
        points: st.w * 10,
      })
      .eq('league_id', league.id)
      .eq('user_id', p.id);
  }

  return { league, champion: final.winner.name };
}

async function wipeAndReseed(admin: SupabaseClient) {
  const demoId = await ensureUser(admin, {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    simcap: DEMO_SIMCAP,
    displayName: DEMO_DISPLAY,
    platform: DEMO_PLATFORM,
  });

  const companionIds: { id: string; meta: Companion }[] = [];
  for (const c of COMPANIONS) {
    const id = await ensureUser(admin, {
      email: c.email,
      password: c.password,
      simcap: c.simcap,
      displayName: c.displayName,
      platform: c.platform,
    });
    companionIds.push({ id, meta: c });
  }

  const allIds = [demoId, ...companionIds.map((c) => c.id)];
  await wipeUserOwnedData(admin, allIds);

  const demoDayOffsets = [
    2, 5, 8, 11, 14, 18, 22, 26, 30, 35, 40, 45, 50, 55, 60, 68, 75, 82, 88, 95,
  ];
  const demoSeed = await seedPlayerRounds(
    admin,
    demoId,
    DEMO_PLATFORM,
    DEMO_TARGET_INDEX,
    20,
    demoDayOffsets
  );

  for (const { id, meta } of companionIds) {
    const count = 12 + (Number(meta.simcap.slice(-1)) % 5);
    const offsets = Array.from({ length: count }, (_, i) => 3 + i * 6);
    await seedPlayerRounds(admin, id, meta.platform, meta.targetIndex, count, offsets);
  }

  // Refresh indexes for Player objects
  const { data: profileRows } = await admin
    .from('profiles')
    .select('id, display_name, preferred_platform, ghin_index')
    .in('id', allIds);

  const players: Player[] = allIds.map((id) => {
    const row = profileRows?.find((r) => r.id === id);
    return {
      id,
      name: (row?.display_name as string) || 'Golfer',
      platform: (row?.preferred_platform as string) || DEMO_PLATFORM,
      index: Number(row?.ghin_index ?? 18),
    };
  });

  const { data: group, error: groupErr } = await admin
    .from('social_groups')
    .insert({
      name: GROUP_NAME,
      created_by: demoId,
      is_active: true,
      is_test: true,
    })
    .select('id')
    .single();
  if (groupErr || !group) throw new Error(`group: ${groupErr?.message ?? 'failed'}`);
  const groupId = group.id as string;

  const { error: memErr } = await admin.from('group_members').insert(
    players.map((p, idx) => ({
      group_id: groupId,
      user_id: p.id,
      display_name_snapshot: p.name,
      is_admin: idx === 0,
    }))
  );
  if (memErr) throw new Error(`group_members: ${memErr.message}`);

  const { data: season, error: seasonErr } = await admin
    .from('league_seasons')
    .insert({
      group_id: groupId,
      name: SEASON_NAME,
      start_date: ymdDaysAgo(60),
      end_date: ymdDaysFromNow(120),
      status: 'active',
      created_by: demoId,
    })
    .select('id')
    .single();
  if (seasonErr || !season) throw new Error(`season: ${seasonErr?.message ?? 'failed'}`);
  const seasonId = season.id as string;

  const stroke = await seedCompletedStroke(admin, {
    groupId,
    seasonId,
    createdBy: demoId,
    players,
    name: 'Spring Open',
  });
  const scramble = await seedCompletedScramble(admin, {
    groupId,
    seasonId,
    createdBy: demoId,
    players,
  });
  const bestBall = await seedCompletedBestBall(admin, {
    groupId,
    seasonId,
    createdBy: demoId,
    players,
  });
  const matchPlay = await seedCompletedMatchPlay(admin, {
    groupId,
    seasonId,
    createdBy: demoId,
    players,
  });
  const open = await seedOpenStroke(admin, {
    groupId,
    seasonId,
    createdBy: demoId,
    players,
    name: 'Midsummer Cup',
  });

  return {
    demoUserId: demoId,
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    simcapId: DEMO_SIMCAP,
    displayName: DEMO_DISPLAY,
    handicapIndex: demoSeed.finalIndex,
    personalRounds: demoSeed.roundIds.length,
    playerCount: players.length,
    players: players.map((p) => ({ name: p.name, index: p.index })),
    groupId,
    groupName: GROUP_NAME,
    seasonId,
    seasonName: SEASON_NAME,
    tournaments: [
      { name: stroke.name, format: stroke.format, status: stroke.status },
      { name: scramble.league.name, format: scramble.league.format, status: scramble.league.status, winner: scramble.winner },
      { name: bestBall.league.name, format: bestBall.league.format, status: bestBall.league.status, winner: bestBall.winner },
      { name: matchPlay.league.name, format: matchPlay.league.format, status: matchPlay.league.status, champion: matchPlay.champion },
      { name: open.name, format: open.format, status: open.status },
    ],
  };
}
