#!/usr/bin/env npx tsx
/**
 * Automated tournament stress tester against live Supabase (seed test accounts).
 *
 * Requires .env at repo root:
 *   SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=...  (or SUPABASE_ANON_KEY)
 *
 * Run: npx tsx scripts/test-tournaments.ts
 *      npx ts-node scripts/test-tournaments.ts  (if ts-node is installed)
 *
 * Prerequisite: FULL_SEED=1 node scripts/seed-test-data.js
 * Scramble uses all 10 seed accounts (3 teams; add 2 more seed profiles for a strict 12-player / 4-per-team run).
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  adjustedDifferential,
  difficultyProduct,
  rawDifferential,
  SIM_BASELINE,
  round1,
} from '../src/lib/handicap';
import { isLeagueReadyToAutoComplete } from '../src/lib/leagueCompletion';
import { autoAssignMembersToTeams } from '../src/lib/tournamentTeamCount';
import { getCourseById, COURSE_SEEDS } from '../src/lib/courses';
import type { CourseSeed } from '../src/lib/courses';
import {
  aggregateBestBallTeamRounds,
  bestBallStandingsScores,
} from '../src/lib/bestBallTournament';
import { bracketR1Slots } from '../src/lib/matchPlayBracketLogic';
import type { DbLeagueRow, DbLeagueEntryRow, DbLeagueRoundRow, DbLeagueTeamRow } from '../src/lib/leagues';

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

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error(
    'Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or anon key in .env (repo root).'
  );
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- seed accounts ---------------------------------------------------------

type ProfileSpec = {
  name: string;
  simcapId: string;
  handicap: number;
  platform: string;
};

const PROFILE_SPECS: ProfileSpec[] = [
  { name: 'Walter White', simcapId: '847291', handicap: 8.4, platform: 'GSPro' },
  { name: 'Tony Soprano', simcapId: '751364', handicap: 21.1, platform: 'Trackman' },
  { name: 'Shooter McGavin', simcapId: '124856', handicap: 4.2, platform: 'Trackman' },
  { name: 'Danny Ocean', simcapId: '392018', handicap: 11.2, platform: 'Trackman' },
  { name: 'Ted Lasso', simcapId: '561034', handicap: 13.6, platform: 'Foresight' },
  { name: 'Roy Kent', simcapId: '718205', handicap: 6.8, platform: 'Uneekor' },
  { name: 'Happy Gilmore', simcapId: '903472', handicap: 23.4, platform: 'GSPro' },
  { name: 'Al Czervik', simcapId: '635709', handicap: 18.9, platform: 'Foresight' },
  { name: 'Ty Webb', simcapId: '280143', handicap: 9.7, platform: 'Uneekor' },
  { name: 'Danny Noonan', simcapId: '496820', handicap: 15.3, platform: 'GSPro' },
];

const TEST_GROUP_NAME = 'The Scratch Pad';
const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];

/** Generic default par layout from courses.ts (P72) — flag matches as warnings. */
const GENERIC_P72: number[] = [
  4, 4, 3, 4, 5, 4, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5,
];

type LoadedProfile = ProfileSpec & { id: string; email: string; password: string };

type TestContext = {
  profiles: LoadedProfile[];
  profileByName: Map<string, LoadedProfile>;
  tokens: Map<string, string>;
  groupId: string;
  admin: LoadedProfile;
  createdLeagueIds: string[];
  createdRoundIds: string[];
};

type StepResult = { ok: boolean; detail?: string };

type TestRun = {
  name: string;
  steps: { label: string; result: StepResult }[];
};

// --- helpers ---------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function generateHoleScores(targetGross: number, pars = PARS): number[] {
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
    holes[17] = Math.max(1, Math.min(12, holes[17] + (targetGross - sum)));
  }
  return holes;
}

function netScore(gross: number, handicap: number): number {
  return round1(Math.max(1, gross - Math.round(handicap)));
}

function logStep(label: string, result: StepResult): void {
  if (result.ok) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label}${result.detail ? ` — ${result.detail}` : ''}`);
  }
}

async function restRpcPost<T>(
  accessToken: string,
  rpcName: string,
  body: Record<string, unknown>
): Promise<{ data: T | null; error: string | null }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const rawText = await res.text().catch(() => '');
  if (!res.ok) {
    let msg = rawText || res.statusText;
    try {
      const j = JSON.parse(rawText) as { message?: string };
      if (j?.message) msg = j.message;
    } catch {
      /* keep */
    }
    return { data: null, error: msg };
  }
  if (!rawText.trim()) return { data: null, error: null };
  try {
    return { data: JSON.parse(rawText) as T, error: null };
  } catch {
    return { data: null, error: 'Invalid RPC response' };
  }
}

async function invokeEdgeFunction<T extends Record<string, unknown>>(
  functionName: string,
  body: Record<string, unknown>,
  accessToken: string
): Promise<{ data: T | null; error: string | null }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text().catch(() => '');
  let parsed: T & { error?: string } = {} as T & { error?: string };
  try {
    parsed = raw ? (JSON.parse(raw) as T & { error?: string }) : ({} as T);
  } catch {
    return { data: null, error: raw || res.statusText };
  }
  if (!res.ok) {
    return { data: null, error: parsed.error ?? raw ?? res.statusText };
  }
  return { data: parsed as T, error: null };
}

async function signInAllPlayers(): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  for (const spec of PROFILE_SPECS) {
    const email = `${slugify(spec.name)}@seed.simcap.test`;
    const password = `Seed-${spec.simcapId}!`;
    const client = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session?.access_token) {
      throw new Error(`Sign-in failed for ${spec.name}: ${error?.message ?? 'no session'}`);
    }
    tokens.set(spec.name, data.session.access_token);
  }
  return tokens;
}

async function loadProfiles(): Promise<LoadedProfile[]> {
  const names = PROFILE_SPECS.map((s) => s.name);
  const { data, error } = await admin
    .from('profiles')
    .select('id, display_name')
    .eq('is_test', true)
    .in('display_name', names);

  if (error) throw new Error(`profiles load: ${error.message}`);

  const byName = new Map((data ?? []).map((r) => [r.display_name, r.id]));
  return PROFILE_SPECS.map((spec) => {
    const id = byName.get(spec.name);
    if (!id) {
      throw new Error(
        `Missing test profile "${spec.name}". Run FULL_SEED=1 node scripts/seed-test-data.js first.`
      );
    }
    return {
      ...spec,
      id,
      email: `${slugify(spec.name)}@seed.simcap.test`,
      password: `Seed-${spec.simcapId}!`,
    };
  });
}

async function loadTestGroup(): Promise<string> {
  const { data, error } = await admin
    .from('social_groups')
    .select('id')
    .eq('is_test', true)
    .eq('name', TEST_GROUP_NAME)
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `Missing test group "${TEST_GROUP_NAME}". Run FULL_SEED=1 node scripts/seed-test-data.js first.`
    );
  }
  return data.id as string;
}

async function flagTestArtifacts(leagueId: string): Promise<void> {
  const { data: lrs } = await admin.from('league_rounds').select('id').eq('league_id', leagueId);
  const lrIds = (lrs ?? []).map((r) => r.id);
  if (lrIds.length > 0) {
    await admin.from('tournament_hole_scores').update({ is_test: true }).in('league_round_id', lrIds);
  }
  await admin.from('tournament_team_hole_scores').update({ is_test: true }).eq('league_id', leagueId);
}

async function cleanupTestRun(ctx: TestContext): Promise<void> {
  for (const leagueId of ctx.createdLeagueIds) {
    const { error } = await admin.from('leagues').delete().eq('id', leagueId);
    if (error) console.warn(`  [cleanup] league ${leagueId}: ${error.message}`);
  }
  if (ctx.createdRoundIds.length > 0) {
    const { error } = await admin.from('rounds').delete().in('id', ctx.createdRoundIds);
    if (error) console.warn(`  [cleanup] rounds: ${error.message}`);
  }
  ctx.createdLeagueIds.length = 0;
  ctx.createdRoundIds.length = 0;
}

async function createLeagueRecord(
  ctx: TestContext,
  opts: {
    name: string;
    format: 'stroke' | 'scramble' | 'best_ball' | 'match_play';
    startDate: string;
    endDate: string;
    matchPlayPairingMethod?: 'bracket' | null;
  }
): Promise<DbLeagueRow> {
  const { data, error } = await admin
    .from('leagues')
    .insert({
      group_id: ctx.groupId,
      name: opts.name,
      format: opts.format,
      scoring_method: opts.format,
      start_date: opts.startDate,
      end_date: opts.endDate,
      rounds_that_count: 1,
      use_handicap: true,
      created_by: ctx.admin.id,
      status: 'active',
      match_play_pairing_method: opts.matchPlayPairingMethod ?? null,
      is_test: true,
    })
    .select('*')
    .single();

  if (error || !data) throw new Error(`league insert: ${error?.message ?? 'unknown'}`);
  ctx.createdLeagueIds.push(data.id);
  return data as DbLeagueRow;
}

async function createTeamsAndEntries(
  ctx: TestContext,
  leagueId: string,
  teamDefs: {
    name: string;
    memberNames: string[];
    designatedScorerName?: string;
  }[]
): Promise<{ teams: DbLeagueTeamRow[]; entryByUser: Map<string, DbLeagueEntryRow> }> {
  const entryByUser = new Map<string, DbLeagueEntryRow>();
  const teams: DbLeagueTeamRow[] = [];

  for (const def of teamDefs) {
    const designatedId = def.designatedScorerName
      ? ctx.profileByName.get(def.designatedScorerName)?.id ?? null
      : null;

    const { data: team, error: tErr } = await admin
      .from('league_teams')
      .insert({
        league_id: leagueId,
        name: def.name,
        designated_scorer_id: designatedId,
        is_test: true,
      })
      .select('*')
      .single();
    if (tErr || !team) throw new Error(`team ${def.name}: ${tErr?.message}`);

    teams.push(team as DbLeagueTeamRow);

    const memberIds = def.memberNames.map((n) => {
      const p = ctx.profileByName.get(n);
      if (!p) throw new Error(`Unknown player ${n}`);
      return p.id;
    });

    await admin.from('league_team_members').insert(
      memberIds.map((user_id) => ({ league_team_id: team.id, user_id }))
    );

    const { data: entries, error: eErr } = await admin
      .from('league_entries')
      .insert(
        memberIds.map((user_id) => ({
          league_id: leagueId,
          user_id,
          league_team_id: team.id,
          rounds_played: 0,
          points: 0,
        }))
      )
      .select('*');
    if (eErr) throw new Error(`entries ${def.name}: ${eErr.message}`);
    for (const e of entries ?? []) entryByUser.set(e.user_id, e as DbLeagueEntryRow);
  }

  return { teams, entryByUser };
}

async function createSoloEntries(
  ctx: TestContext,
  leagueId: string,
  playerNames: string[]
): Promise<Map<string, DbLeagueEntryRow>> {
  const entryByUser = new Map<string, DbLeagueEntryRow>();
  const rows = playerNames.map((name) => {
    const p = ctx.profileByName.get(name);
    if (!p) throw new Error(`Unknown player ${name}`);
    return {
      league_id: leagueId,
      user_id: p.id,
      league_team_id: null,
      rounds_played: 0,
      points: 0,
      mp_wins: 0,
      mp_losses: 0,
      mp_halved: 0,
    };
  });

  const { data, error } = await admin.from('league_entries').insert(rows).select('*');
  if (error) throw new Error(`solo entries: ${error.message}`);
  for (const e of data ?? []) entryByUser.set(e.user_id, e as DbLeagueEntryRow);
  return entryByUser;
}

async function insertRound(
  ctx: TestContext,
  profile: LoadedProfile,
  gross: number,
  playedAt: string
): Promise<{ roundId: string; holes: { hole_number: number; gross_score: number }[] }> {
  const course = getCourseById('pebble')!;
  const white = course.tees!.find((t) => t.name === 'White')!;
  const holesArr = generateHoleScores(gross);
  const { raw, adjusted, modifier } = adjustedDifferential(
    gross,
    white.rating,
    white.slope,
    'auto_2putt',
    'sat',
    'off',
    'off'
  );

  const { data, error } = await admin
    .from('rounds')
    .insert({
      user_id: profile.id,
      course_id: course.id,
      course_name: course.name,
      platform: profile.platform,
      gross_score: gross,
      hole_scores: holesArr,
      putting_mode: 'auto_2putt',
      pin_placement: 'sat',
      wind: 'off',
      mulligans: 'off',
      difficulty_modifier: modifier,
      differential: adjusted,
      differential_version: 1,
      raw_differential: raw,
      course_rating: white.rating,
      slope: white.slope,
      tee_name: white.name,
      played_at: playedAt,
      simcap_index_at_time: profile.handicap,
      is_active: true,
      is_test: true,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`round insert: ${error?.message}`);
  ctx.createdRoundIds.push(data.id);
  return {
    roundId: data.id,
    holes: holesArr.map((gross_score, i) => ({ hole_number: i + 1, gross_score })),
  };
}

async function insertLeagueRound(
  leagueId: string,
  profile: LoadedProfile,
  entryId: string,
  teamId: string | null,
  roundId: string,
  gross: number,
  playedAt: string
): Promise<string> {
  const { data, error } = await admin
    .from('league_rounds')
    .insert({
      league_id: leagueId,
      user_id: profile.id,
      league_team_id: teamId,
      round_id: roundId,
      gross_score: gross,
      net_score: netScore(gross, profile.handicap),
      counted: true,
      player_opted_in: true,
      hole_entry_status: 'pending_holes',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`league_round: ${error?.message}`);
  return data.id;
}

async function upsertHoles(
  token: string,
  leagueRoundId: string,
  holes: { hole_number: number; gross_score: number; is_team_score?: boolean }[]
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await restRpcPost<{ hole_entry_status?: string }>(
    token,
    'upsert_tournament_hole_scores',
    {
      p_league_round_id: leagueRoundId,
      p_holes: holes.map((h) => ({
        hole_number: h.hole_number,
        gross_score: h.gross_score,
        is_team_score: h.is_team_score ?? false,
      })),
    }
  );
  if (error) return { ok: false, error };
  if (data?.hole_entry_status !== 'complete') {
    return { ok: false, error: `hole_entry_status=${data?.hole_entry_status ?? 'unknown'}` };
  }
  return { ok: true };
}

async function fetchLeagueBundle(leagueId: string): Promise<{
  league: DbLeagueRow;
  teams: DbLeagueTeamRow[];
  entries: DbLeagueEntryRow[];
  rounds: DbLeagueRoundRow[];
}> {
  const [l, t, e, r] = await Promise.all([
    admin.from('leagues').select('*').eq('id', leagueId).single(),
    admin.from('league_teams').select('*').eq('league_id', leagueId),
    admin.from('league_entries').select('*').eq('league_id', leagueId),
    admin.from('league_rounds').select('*').eq('league_id', leagueId),
  ]);
  if (l.error || !l.data) throw new Error(`bundle league: ${l.error?.message}`);
  return {
    league: l.data as DbLeagueRow,
    teams: (t.data ?? []) as DbLeagueTeamRow[],
    entries: (e.data ?? []) as DbLeagueEntryRow[],
    rounds: (r.data ?? []) as DbLeagueRoundRow[],
  };
}

async function fetchTeamHoleScores(leagueId: string) {
  const { data, error } = await admin
    .from('tournament_team_hole_scores')
    .select('*')
    .eq('league_id', leagueId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function triggerAutoCompletion(
  ctx: TestContext,
  leagueId: string,
  adminToken: string
): Promise<{ ok: boolean; detail?: string }> {
  const bundle = await fetchLeagueBundle(leagueId);
  let pairings: Parameters<typeof isLeagueReadyToAutoComplete>[0]['pairings'] = [];
  let teamHoleScores = await fetchTeamHoleScores(leagueId);

  if (bundle.league.format === 'match_play') {
    const { data } = await admin
      .from('league_match_pairings')
      .select('*')
      .eq('league_id', leagueId);
    pairings = (data ?? []) as Parameters<typeof isLeagueReadyToAutoComplete>[0]['pairings'];
  }

  const ready = isLeagueReadyToAutoComplete({
    league: bundle.league,
    teams: bundle.teams,
    entries: bundle.entries,
    rounds: bundle.rounds,
    pairings,
    teamHoleScores: teamHoleScores as Parameters<
      typeof isLeagueReadyToAutoComplete
    >[0]['teamHoleScores'],
  });

  if (!ready) {
    return { ok: false, detail: 'Tournament not ready to auto-complete' };
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/leagues?id=eq.${encodeURIComponent(leagueId)}`, {
    method: 'PATCH',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ status: 'completed', updated_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    return { ok: false, detail: await res.text().catch(() => res.statusText) };
  }
  return { ok: true };
}

function displayNames(ctx: TestContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of ctx.profiles) out[p.id] = p.name;
  return out;
}

function matchPlayHoleScores(p1Wins: number, p2Wins: number) {
  const p1: { hole_number: number; gross_score: number }[] = [];
  const p2: { hole_number: number; gross_score: number }[] = [];
  let w1 = 0;
  let w2 = 0;
  for (let hole = 1; hole <= 18; hole++) {
    let g1 = randInt(3, 5);
    let g2 = randInt(3, 5);
    if (w1 < p1Wins && (w2 >= p2Wins || Math.random() < 0.55)) {
      g2 = g1 + randInt(1, 2);
      w1++;
    } else if (w2 < p2Wins) {
      g1 = g2 + randInt(1, 2);
      w2++;
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
  return { p1, p2 };
}

function countingRounds(rounds: DbLeagueRoundRow[]): DbLeagueRoundRow[] {
  return rounds.filter(
    (r) =>
      r.player_opted_in === true &&
      (r.hole_entry_status === 'complete' || r.hole_entry_status == null)
  );
}

function strokeStandings(
  entries: DbLeagueEntryRow[],
  rounds: DbLeagueRoundRow[],
  displayNames: Record<string, string>
): { userId: string; name: string; lowNet: number }[] {
  const netsByUser = new Map<string, number[]>();
  for (const r of countingRounds(rounds)) {
    const list = netsByUser.get(r.user_id) ?? [];
    list.push(Number(r.net_score));
    netsByUser.set(r.user_id, list);
  }
  return entries
    .map((e) => {
      const nets = (netsByUser.get(e.user_id) ?? []).sort((a, b) => a - b);
      return {
        userId: e.user_id,
        name: displayNames[e.user_id] ?? 'Golfer',
        lowNet: nets[0] ?? 999,
      };
    })
    .sort((a, b) => a.lowNet - b.lowNet || a.name.localeCompare(b.name));
}

function scrambleTeamStandings(
  teams: DbLeagueTeamRow[],
  rounds: DbLeagueRoundRow[]
): { teamId: string; name: string; lowNet: number }[] {
  const netsByTeam = new Map<string, number[]>();
  for (const r of countingRounds(rounds)) {
    if (!r.league_team_id) continue;
    const list = netsByTeam.get(r.league_team_id) ?? [];
    list.push(Number(r.net_score));
    netsByTeam.set(r.league_team_id, list);
  }
  return teams
    .map((t) => ({
      teamId: t.id,
      name: t.name,
      lowNet: (netsByTeam.get(t.id) ?? []).sort((a, b) => a - b)[0] ?? 999,
    }))
    .sort((a, b) => a.lowNet - b.lowNet || a.name.localeCompare(b.name));
}

async function runStep(
  run: TestRun,
  label: string,
  fn: () => Promise<StepResult>
): Promise<boolean> {
  try {
    const result = await fn();
    run.steps.push({ label, result });
    logStep(label, result);
    return result.ok;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const result = { ok: false, detail };
    run.steps.push({ label, result });
    logStep(label, result);
    return false;
  }
}

// --- test suites -----------------------------------------------------------

async function testStrokePlay(ctx: TestContext): Promise<TestRun> {
  const run: TestRun = { name: 'Stroke Play', steps: [] };
  console.log('\n🏌️  Stroke Play (8 players)');

  const playerNames = PROFILE_SPECS.slice(0, 8).map((p) => p.name);
  const today = new Date();
  let leagueId = '';
  const playedAt = addDays(today, -1).toISOString();
  const grossByPlayer = new Map<string, number>();

  await runStep(run, 'Create stroke play tournament', async () => {
    const league = await createLeagueRecord(ctx, {
      name: `[stress] Stroke Play ${Date.now()}`,
      format: 'stroke',
      startDate: isoDate(addDays(today, -7)),
      endDate: isoDate(addDays(today, 7)),
    });
    leagueId = league.id;
    return { ok: true };
  });

  await runStep(run, 'Add 8 players', async () => {
    await createSoloEntries(ctx, leagueId, playerNames);
    const bundle = await fetchLeagueBundle(leagueId);
    return {
      ok: bundle.entries.length === 8,
      detail: bundle.entries.length !== 8 ? `expected 8 entries, got ${bundle.entries.length}` : undefined,
    };
  });

  await runStep(run, 'Submit random scores (68–85) for all 18 holes per player', async () => {
    const bundle = await fetchLeagueBundle(leagueId);
    for (const name of playerNames) {
      const profile = ctx.profileByName.get(name)!;
      const entry = bundle.entries.find((e) => e.user_id === profile.id);
      if (!entry) return { ok: false, detail: `No entry for ${name}` };
      const gross = randInt(68, 85);
      grossByPlayer.set(name, gross);
      const { roundId, holes } = await insertRound(ctx, profile, gross, playedAt);
      const lrId = await insertLeagueRound(
        leagueId,
        profile,
        entry.id,
        null,
        roundId,
        gross,
        playedAt
      );
      const token = ctx.tokens.get(name)!;
      const up = await upsertHoles(token, lrId, holes);
      if (!up.ok) return { ok: false, detail: `${name}: ${up.error}` };
    }
    return { ok: true };
  });

  await runStep(run, 'Trigger auto-completion', async () => {
    const adminToken = ctx.tokens.get(ctx.admin.name)!;
    const r = await triggerAutoCompletion(ctx, leagueId, adminToken);
    return { ok: r.ok, detail: r.detail };
  });

  await runStep(run, 'Verify leaderboard generated and ranked correctly', async () => {
    const bundle = await fetchLeagueBundle(leagueId);
    if (bundle.league.status !== 'completed') {
      return { ok: false, detail: `status=${bundle.league.status}` };
    }
    const standings = strokeStandings(bundle.entries, bundle.rounds, displayNames(ctx));
    if (standings.length !== 8) {
      return { ok: false, detail: `expected 8 standings rows, got ${standings.length}` };
    }
    for (let i = 1; i < standings.length; i++) {
      if (standings[i]!.lowNet < standings[i - 1]!.lowNet) {
        return { ok: false, detail: 'Standings not sorted by low net ascending' };
      }
    }
    return { ok: true };
  });

  await runStep(run, 'Verify winner is lowest score', async () => {
    const expectedWinner = [...grossByPlayer.entries()].sort((a, b) => {
      const na = netScore(a[1], ctx.profileByName.get(a[0])!.handicap);
      const nb = netScore(b[1], ctx.profileByName.get(b[0])!.handicap);
      return na - nb;
    })[0]![0];
    const bundle = await fetchLeagueBundle(leagueId);
    const standings = strokeStandings(bundle.entries, bundle.rounds, displayNames(ctx));
    if (standings[0]?.name !== expectedWinner) {
      return {
        ok: false,
        detail: `expected ${expectedWinner}, got ${standings[0]?.name ?? 'none'}`,
      };
    }
    return { ok: true };
  });

  await flagTestArtifacts(leagueId);
  await cleanupTestRun(ctx);
  return run;
}

async function testScramble(ctx: TestContext): Promise<TestRun> {
  const run: TestRun = { name: 'Scramble', steps: [] };
  console.log('\n🏌️  Scramble (10 players → 3 teams, target 4 per team)');

  const playerNames = PROFILE_SPECS.map((p) => p.name);
  const today = new Date();
  let leagueId = '';
  const playedAt = addDays(today, -1).toISOString();
  const teamGrossTotals = new Map<string, number>();

  await runStep(run, 'Create scramble tournament (players-per-team = 4)', async () => {
    const league = await createLeagueRecord(ctx, {
      name: `[stress] Scramble ${Date.now()}`,
      format: 'scramble',
      startDate: isoDate(addDays(today, -7)),
      endDate: isoDate(addDays(today, 7)),
    });
    leagueId = league.id;
    return { ok: true };
  });

  await runStep(run, 'Add all 10 seed players and auto-assign 3 teams', async () => {
    const memberIds = playerNames.map((n) => ctx.profileByName.get(n)!.id);
    const drafts = autoAssignMembersToTeams(
      memberIds.map((id) => ({ userId: id, handicap: 10 })),
      3,
      true,
      { randomizeMissingHandicap: true }
    );
    if (drafts.length !== 3) {
      return { ok: false, detail: `expected 3 teams, got ${drafts.length}` };
    }
    const teamDefs = drafts.map((d, i) => ({
      name: `Team ${i + 1}`,
      memberNames: d.memberIds.map(
        (id) => ctx.profiles.find((p) => p.id === id)!.name
      ),
      designatedScorerName: d.memberIds[0]
        ? ctx.profiles.find((p) => p.id === d.memberIds[0])!.name
        : undefined,
    }));
    await createTeamsAndEntries(ctx, leagueId, teamDefs);
    const bundle = await fetchLeagueBundle(leagueId);
    return {
      ok: bundle.teams.length === 3 && bundle.entries.length === 10,
      detail:
        bundle.teams.length !== 3
          ? `expected 3 teams, got ${bundle.teams.length}`
          : bundle.entries.length !== 10
            ? `expected 10 entries, got ${bundle.entries.length}`
            : undefined,
    };
  });

  await runStep(run, 'Submit team hole scores (52–68 gross) for all 18 holes', async () => {
    const bundle = await fetchLeagueBundle(leagueId);

    for (const team of bundle.teams) {
      const members = bundle.entries.filter((e) => e.league_team_id === team.id);
      const scorerEntry = members.find(
        (e) => e.user_id === team.designated_scorer_id
      );
      if (!scorerEntry) {
        return { ok: false, detail: `No designated scorer for ${team.name}` };
      }
      const scorer = ctx.profiles.find((p) => p.id === scorerEntry.user_id)!;
      const gross = randInt(52, 68);
      teamGrossTotals.set(team.name, gross);
      const { roundId, holes } = await insertRound(ctx, scorer, gross, playedAt);
      const lrId = await insertLeagueRound(
        leagueId,
        scorer,
        scorerEntry.id,
        team.id,
        roundId,
        gross,
        playedAt
      );
      const token = ctx.tokens.get(scorer.name)!;
      const up = await upsertHoles(
        token,
        lrId,
        holes.map((h) => ({ ...h, is_team_score: true }))
      );
      if (!up.ok) return { ok: false, detail: `${team.name}: ${up.error}` };

      const { error: calcErr } = await invokeEdgeFunction<{ ok?: boolean; holes_written?: number }>(
        'calculate-team-hole-scores',
        { league_round_id: lrId },
        token
      );
      if (calcErr) return { ok: false, detail: `${team.name} team calc: ${calcErr}` };
    }
    return { ok: true };
  });

  await runStep(run, 'Trigger auto-completion', async () => {
    const adminToken = ctx.tokens.get(ctx.admin.name)!;
    const r = await triggerAutoCompletion(ctx, leagueId, adminToken);
    return { ok: r.ok, detail: r.detail };
  });

  await runStep(run, 'Verify leaderboard shows 3 teams ranked correctly', async () => {
    const bundle = await fetchLeagueBundle(leagueId);
    const standings = scrambleTeamStandings(bundle.teams, bundle.rounds);
    if (standings.length !== 3) {
      return { ok: false, detail: `expected 3 team rows, got ${standings.length}` };
    }
    for (let i = 1; i < standings.length; i++) {
      if (standings[i]!.lowNet < standings[i - 1]!.lowNet) {
        return { ok: false, detail: 'Teams not sorted by low net' };
      }
    }
    const lowestTeam = standings[0]!;
    const lowestGross = [...teamGrossTotals.entries()].sort((a, b) => {
      const teamA = bundle.teams.find((t) => t.name === a[0])!;
      const scorerA = ctx.profiles.find((p) => p.id === teamA.designated_scorer_id)!;
      const teamB = bundle.teams.find((t) => t.name === b[0])!;
      const scorerB = ctx.profiles.find((p) => p.id === teamB.designated_scorer_id)!;
      return (
        netScore(a[1], scorerA.handicap) - netScore(b[1], scorerB.handicap)
      );
    })[0]![0];
    if (lowestTeam.name !== lowestGross) {
      return {
        ok: false,
        detail: `expected top team ${lowestGross}, got ${lowestTeam.name}`,
      };
    }
    return { ok: true };
  });

  await flagTestArtifacts(leagueId);
  await cleanupTestRun(ctx);
  return run;
}

async function testBestBall(ctx: TestContext): Promise<TestRun> {
  const run: TestRun = { name: 'Best Ball', steps: [] };
  console.log('\n🏌️  Best Ball (8 players, 4 teams of 2)');

  const playerNames = PROFILE_SPECS.slice(0, 8).map((p) => p.name);
  const today = new Date();
  let leagueId = '';
  const playedAt = addDays(today, -1).toISOString();

  await runStep(run, 'Create best ball tournament', async () => {
    const league = await createLeagueRecord(ctx, {
      name: `[stress] Best Ball ${Date.now()}`,
      format: 'best_ball',
      startDate: isoDate(addDays(today, -7)),
      endDate: isoDate(addDays(today, 7)),
    });
    leagueId = league.id;
    return { ok: true };
  });

  await runStep(run, 'Auto-assign 4 teams of 2', async () => {
    const memberIds = playerNames.map((n) => ctx.profileByName.get(n)!.id);
    const drafts = autoAssignMembersToTeams(
      memberIds.map((id) => ({ userId: id, handicap: 12 })),
      4,
      false
    );
    const teamDefs = drafts.map((d, i) => ({
      name: `Team ${i + 1}`,
      memberNames: d.memberIds.map(
        (id) => ctx.profiles.find((p) => p.id === id)!.name
      ),
    }));
    await createTeamsAndEntries(ctx, leagueId, teamDefs);
    const bundle = await fetchLeagueBundle(leagueId);
    return { ok: bundle.teams.length === 4 };
  });

  type MemberHolePair = {
    holes: { hole_number: number; gross_score: number }[];
    profile: LoadedProfile;
  };
  const memberHolesByTeam = new Map<string, [MemberHolePair, MemberHolePair]>();

  await runStep(run, 'Submit individual hole scores for all players (18 holes)', async () => {
    const bundle = await fetchLeagueBundle(leagueId);
    for (const team of bundle.teams) {
      const members = bundle.entries.filter((e) => e.league_team_id === team.id);
      if (members.length !== 2) {
        return { ok: false, detail: `${team.name} has ${members.length} members, expected 2` };
      }
      const pair: MemberHolePair[] = [];
      for (const entry of members) {
        const profile = ctx.profiles.find((p) => p.id === entry.user_id)!;
        const gross = randInt(68, 85);
        const { roundId, holes } = await insertRound(ctx, profile, gross, playedAt);
        const lrId = await insertLeagueRound(
          leagueId,
          profile,
          entry.id,
          team.id,
          roundId,
          gross,
          playedAt
        );
        const token = ctx.tokens.get(profile.name)!;
        const up = await upsertHoles(token, lrId, holes);
        if (!up.ok) return { ok: false, detail: `${profile.name}: ${up.error}` };
        pair.push({ holes, profile });
      }
      memberHolesByTeam.set(team.id, [pair[0]!, pair[1]!]);
    }
    return { ok: true };
  });

  await runStep(run, 'Verify best-ball scoring (best score per hole per team)', async () => {
    const bundle = await fetchLeagueBundle(leagueId);
    for (const team of bundle.teams) {
      const pair = memberHolesByTeam.get(team.id);
      if (!pair || pair.length !== 2) {
        return { ok: false, detail: `Missing hole data for ${team.name}` };
      }
      const [a, b] = pair;
      for (let i = 0; i < 18; i++) {
        const expectedGross = Math.min(a.holes[i]!.gross_score, b.holes[i]!.gross_score);
        const strokesA = Math.round(a.profile.handicap);
        const strokesB = Math.round(b.profile.handicap);
        const expectedNet = Math.min(
          a.holes[i]!.gross_score - strokesA,
          b.holes[i]!.gross_score - strokesB
        );
        void expectedGross;
        void expectedNet;
      }
    }

    for (const team of bundle.teams) {
      const members = bundle.entries.filter((e) => e.league_team_id === team.id);
      let lastLrId = '';
      for (const entry of members) {
        const lr = bundle.rounds.find((r) => r.user_id === entry.user_id);
        if (!lr) return { ok: false, detail: `No league round for ${team.name}` };
        lastLrId = lr.id;
        const profile = ctx.profiles.find((p) => p.id === entry.user_id)!;
        const token = ctx.tokens.get(profile.name)!;
        const { error } = await invokeEdgeFunction<{ ok?: boolean }>(
          'calculate-team-hole-scores',
          { league_round_id: lr.id },
          token
        );
        if (error) return { ok: false, detail: `${profile.name}: ${error}` };
      }
      void lastLrId;
    }

    const teamHoleScores = await fetchTeamHoleScores(leagueId);
    for (const team of bundle.teams) {
      const pair = memberHolesByTeam.get(team.id)!;
      const [a, b] = pair;
      const rows = teamHoleScores.filter((r) => r.league_team_id === team.id);
      if (rows.length < 18) {
        return { ok: false, detail: `${team.name}: only ${rows.length} team holes` };
      }
      for (let i = 0; i < 18; i++) {
        const holeNum = i + 1;
        const row = rows.find((r) => r.hole_number === holeNum);
        const expected = Math.min(a.holes[i]!.gross_score, b.holes[i]!.gross_score);
        if (!row || row.team_score !== expected) {
          return {
            ok: false,
            detail: `${team.name} hole ${holeNum}: expected ${expected}, got ${row?.team_score}`,
          };
        }
      }
    }
    return { ok: true };
  });

  await runStep(run, 'Trigger auto-completion', async () => {
    const adminToken = ctx.tokens.get(ctx.admin.name)!;
    const r = await triggerAutoCompletion(ctx, leagueId, adminToken);
    return { ok: r.ok, detail: r.detail };
  });

  await runStep(run, 'Verify best ball leaderboard is correct', async () => {
    const bundle = await fetchLeagueBundle(leagueId);
    const teamHoleScores = await fetchTeamHoleScores(leagueId);
    const expectedRanks: { teamId: string; lowNet: number }[] = [];

    for (const team of bundle.teams) {
      const aggregates = aggregateBestBallTeamRounds(
        teamHoleScores as Parameters<typeof aggregateBestBallTeamRounds>[0],
        team.id,
        true
      );
      const { netScores } = bestBallStandingsScores(aggregates, true);
      expectedRanks.push({ teamId: team.id, lowNet: netScores[0] ?? 999 });
    }
    expectedRanks.sort((a, b) => a.lowNet - b.lowNet);

    const standings = expectedRanks.map((r) => {
      const team = bundle.teams.find((t) => t.id === r.teamId)!;
      return { name: team.name, lowNet: r.lowNet };
    });

    if (standings.length !== 4) {
      return { ok: false, detail: `expected 4 teams, got ${standings.length}` };
    }
    const winnerTeam = bundle.teams.find((t) => t.id === expectedRanks[0]!.teamId);
    if (standings[0]!.name !== winnerTeam?.name) {
      return {
        ok: false,
        detail: `expected winner ${winnerTeam?.name}, got ${standings[0]!.name}`,
      };
    }
    return { ok: true };
  });

  await flagTestArtifacts(leagueId);
  await cleanupTestRun(ctx);
  return run;
}

async function playMatchPlayPairing(
  ctx: TestContext,
  leagueId: string,
  pairing: {
    id: string;
    player_1_entry_id: string;
    player_2_entry_id: string;
  },
  p1Wins: number,
  p2Wins: number,
  playedAt: string
): Promise<void> {
  const bundle = await fetchLeagueBundle(leagueId);
  const e1 = bundle.entries.find((e) => e.id === pairing.player_1_entry_id)!;
  const e2 = bundle.entries.find((e) => e.id === pairing.player_2_entry_id)!;
  const p1 = ctx.profiles.find((p) => p.id === e1.user_id)!;
  const p2 = ctx.profiles.find((p) => p.id === e2.user_id)!;
  const sim = matchPlayHoleScores(p1Wins, p2Wins);

  const g1 = sim.p1.reduce((s, h) => s + h.gross_score, 0);
  const g2 = sim.p2.reduce((s, h) => s + h.gross_score, 0);

  const r1 = await insertRound(ctx, p1, g1, playedAt);
  const r2 = await insertRound(ctx, p2, g2, playedAt);

  const lr1 = await insertLeagueRound(leagueId, p1, e1.id, null, r1.roundId, g1, playedAt);
  const lr2 = await insertLeagueRound(leagueId, p2, e2.id, null, r2.roundId, g2, playedAt);

  const up1 = await upsertHoles(ctx.tokens.get(p1.name)!, lr1, sim.p1);
  const up2 = await upsertHoles(ctx.tokens.get(p2.name)!, lr2, sim.p2);
  if (!up1.ok) throw new Error(`${p1.name}: ${up1.error}`);
  if (!up2.ok) throw new Error(`${p2.name}: ${up2.error}`);

  const ap1 = await restRpcPost(ctx.tokens.get(p1.name)!, 'apply_match_play_league_round', {
    p_league_round_id: lr1,
  });
  if (ap1.error) throw new Error(`apply ${p1.name}: ${ap1.error}`);

  const ap2 = await restRpcPost(ctx.tokens.get(p2.name)!, 'apply_match_play_league_round', {
    p_league_round_id: lr2,
  });
  if (ap2.error) throw new Error(`apply ${p2.name}: ${ap2.error}`);
}

async function testMatchPlay(ctx: TestContext): Promise<TestRun> {
  const run: TestRun = { name: 'Match Play', steps: [] };
  console.log('\n🏌️  Match Play (10 players, non-POT bracket)');

  const playerNames = PROFILE_SPECS.map((p) => p.name);
  const today = new Date();
  let leagueId = '';
  const playedAt = addDays(today, -1).toISOString();
  const adminToken = ctx.tokens.get(ctx.admin.name)!;

  await runStep(run, 'Create match play tournament (10 players)', async () => {
    const league = await createLeagueRecord(ctx, {
      name: `[stress] Match Play ${Date.now()}`,
      format: 'match_play',
      startDate: isoDate(addDays(today, -7)),
      endDate: isoDate(addDays(today, 7)),
      matchPlayPairingMethod: 'bracket',
    });
    leagueId = league.id;
    await createSoloEntries(ctx, leagueId, playerNames);
    return { ok: true };
  });

  await runStep(run, 'Generate bracket (admin)', async () => {
    const seededIds = playerNames.map((n) => ctx.profileByName.get(n)!.id);
    const { data, error } = await restRpcPost<{
      pairings_created?: number;
      current_bracket_round?: string;
    }>(adminToken, 'generate_match_play_bracket', {
      p_league_id: leagueId,
      p_seeded_user_ids: seededIds,
    });
    if (error) return { ok: false, detail: error };
    if (data?.pairings_created !== 5) {
      return {
        ok: false,
        detail: `expected 5 R1 pairings, got ${data?.pairings_created ?? 0}`,
      };
    }
    return { ok: true };
  });

  await runStep(run, 'Verify bracket has 5 first-round matches (1v10, 2v9, …)', async () => {
    const { data: pairings, error } = await admin
      .from('league_match_pairings')
      .select('*')
      .eq('league_id', leagueId)
      .eq('bracket_round', 'r1');
    if (error) return { ok: false, detail: error.message };
    if ((pairings ?? []).length !== 5) {
      return { ok: false, detail: `expected 5 R1 matches, got ${pairings?.length ?? 0}` };
    }
    const expected = bracketR1Slots(10);
    const bundle = await fetchLeagueBundle(leagueId);
    for (const slot of expected) {
      const pairing = pairings!.find((p) => p.bracket_slot === slot.slot);
      if (!pairing) {
        return { ok: false, detail: `Missing slot ${slot.slot}` };
      }
      const e1 = bundle.entries.find((e) => e.id === pairing.player_1_entry_id);
      const e2 = bundle.entries.find((e) => e.id === pairing.player_2_entry_id);
      if (e1?.bracket_seed !== slot.seed1 || e2?.bracket_seed !== slot.seed2) {
        return {
          ok: false,
          detail: `Slot ${slot.slot}: expected seeds ${slot.seed1}v${slot.seed2}, got ${e1?.bracket_seed}v${e2?.bracket_seed}`,
        };
      }
    }
    return { ok: true };
  });

  await runStep(run, 'Simulate all first-round matches', async () => {
    const { data: pairings, error } = await admin
      .from('league_match_pairings')
      .select('*')
      .eq('league_id', leagueId)
      .eq('bracket_round', 'r1')
      .order('bracket_slot');
    if (error) return { ok: false, detail: error.message };
    for (const p of pairings ?? []) {
      await playMatchPlayPairing(ctx, leagueId, p, 10, 7, playedAt);
    }
    return { ok: true };
  });

  await runStep(run, 'Verify bracket advances to next round', async () => {
    const { data: league } = await admin.from('leagues').select('*').eq('id', leagueId).single();
    if (!league) return { ok: false, detail: 'League not found' };
    if (league.current_bracket_round === 'r1') {
      return { ok: false, detail: 'Still on r1 after all matches complete' };
    }
    const { data: nextPairings } = await admin
      .from('league_match_pairings')
      .select('*')
      .eq('league_id', leagueId)
      .neq('bracket_round', 'r1');
    if (!nextPairings?.length) {
      return { ok: false, detail: 'No next-round pairings created' };
    }
    return { ok: true, detail: `advanced to ${league.current_bracket_round}` };
  });

  await runStep(run, 'Complete remaining bracket rounds', async () => {
    let safety = 0;
    while (safety++ < 10) {
      const { data: league } = await admin.from('leagues').select('*').eq('id', leagueId).single();
      if (!league?.current_bracket_round) break;

      const { data: active } = await admin
        .from('league_match_pairings')
        .select('*')
        .eq('league_id', leagueId)
        .eq('bracket_round', league.current_bracket_round)
        .in('status', ['scheduled', 'in_progress']);

      if (!active?.length) {
        const { data: final } = await admin
          .from('league_match_pairings')
          .select('*')
          .eq('league_id', leagueId)
          .eq('bracket_round', 'final')
          .maybeSingle();
        if (final?.status === 'complete') break;
        return { ok: false, detail: 'No active pairings but tournament not finished' };
      }

      for (const p of active) {
        await playMatchPlayPairing(ctx, leagueId, p, 10, 7, playedAt);
      }
    }
    return { ok: true };
  });

  await runStep(run, 'Complete tournament and verify winner declared', async () => {
    const adminToken = ctx.tokens.get(ctx.admin.name)!;
    const r = await triggerAutoCompletion(ctx, leagueId, adminToken);
    if (!r.ok) return { ok: false, detail: r.detail };

    const { data: final } = await admin
      .from('league_match_pairings')
      .select('*')
      .eq('league_id', leagueId)
      .eq('bracket_round', 'final')
      .maybeSingle();
    if (!final?.winner_entry_id) {
      return { ok: false, detail: 'Final pairing has no winner' };
    }
    const bundle = await fetchLeagueBundle(leagueId);
    if (bundle.league.status !== 'completed') {
      return { ok: false, detail: `status=${bundle.league.status}` };
    }
    return { ok: true };
  });

  await flagTestArtifacts(leagueId);
  await cleanupTestRun(ctx);
  return run;
}

async function testHandicapValidator(ctx: TestContext): Promise<TestRun> {
  const run: TestRun = { name: 'Handicap Calculation', steps: [] };
  console.log('\n📐 Handicap Calculation Validator');

  const walter = ctx.profileByName.get('Walter White')!;
  const course = getCourseById('pebble')!;
  const whiteTee = course.tees!.find((t) => t.name === 'White')!;
  const gross = 82;
  let roundId = '';

  const putting = 'auto_2putt' as const;
  const pin = 'sat' as const;
  const wind = 'off' as const;
  const mulligans = 'off' as const;

  const raw = rawDifferential(gross, whiteTee.rating, whiteTee.slope);
  const modifier = difficultyProduct(putting, pin, wind, mulligans);
  const expected = round1(raw * modifier);

  await runStep(run, 'Compute expected differential from SimCap formula', async () => {
    const calc = adjustedDifferential(
      gross,
      whiteTee.rating,
      whiteTee.slope,
      putting,
      pin,
      wind,
      mulligans
    );
    const detail =
      `raw=${round1(raw)} × modifier=${modifier.toFixed(4)} (SIM_BASELINE=${SIM_BASELINE}) = ${calc.adjusted}`;
    if (Math.abs(calc.adjusted - expected) > 0.01) {
      return { ok: false, detail: `internal mismatch: ${detail}` };
    }
    return { ok: true, detail };
  });

  await runStep(run, 'Log round (GSPro, Pebble White, score 82, Auto/Sat/Off/Off)', async () => {
    const holes = generateHoleScores(gross);
    const { data, error } = await admin
      .from('rounds')
      .insert({
        user_id: walter.id,
        course_id: course.id,
        course_name: course.name,
        platform: 'GSPro',
        gross_score: gross,
        hole_scores: holes,
        putting_mode: putting,
        pin_placement: pin,
        wind,
        mulligans,
        difficulty_modifier: modifier,
        differential: expected,
        differential_version: 1,
        raw_differential: round1(raw),
        course_rating: whiteTee.rating,
        slope: whiteTee.slope,
        tee_name: whiteTee.name,
        played_at: new Date().toISOString(),
        simcap_index_at_time: walter.handicap,
        is_active: true,
        is_test: true,
      })
      .select('id, differential')
      .single();

    if (error || !data) return { ok: false, detail: error?.message };
    roundId = data.id;
    ctx.createdRoundIds.push(roundId);
    return { ok: true };
  });

  await runStep(run, 'Compare stored differential to expected (±0.1)', async () => {
    const { data, error } = await admin
      .from('rounds')
      .select('differential, raw_differential, difficulty_modifier, course_rating, slope')
      .eq('id', roundId)
      .single();
    if (error || !data) return { ok: false, detail: error?.message };

    const actual = Number(data.differential);
    const delta = Math.abs(actual - expected);
    if (delta > 0.1) {
      return {
        ok: false,
        detail:
          `expected ${expected}, actual ${actual} (Δ=${delta.toFixed(2)}). ` +
          `Inputs: rating=${data.course_rating}, slope=${data.slope}, ` +
          `raw=${data.raw_differential}, modifier=${data.difficulty_modifier}`,
      };
    }
    return { ok: true, detail: `expected ${expected}, actual ${actual}` };
  });

  await cleanupTestRun(ctx);
  return run;
}

function parsArraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

type ParValidationOutcome = 'pass' | 'p72' | 'fail';

function validateCoursePars(course: CourseSeed): { outcome: ParValidationOutcome; detail?: string } {
  const { pars } = course;
  if (pars.length !== 18) {
    return { outcome: 'fail', detail: `expected 18 holes, got ${pars.length}` };
  }
  for (let i = 0; i < pars.length; i++) {
    const par = pars[i]!;
    if (par !== 3 && par !== 4 && par !== 5) {
      return { outcome: 'fail', detail: `hole ${i + 1} has invalid par ${par}` };
    }
  }
  const total = pars.reduce((sum, par) => sum + par, 0);
  if (total < 68 || total > 74) {
    return { outcome: 'fail', detail: `total par ${total} is outside 68–74` };
  }
  if (parsArraysEqual(pars, GENERIC_P72)) {
    return { outcome: 'p72', detail: 'still using generic P72 default' };
  }
  return { outcome: 'pass' };
}

async function testCourseParDataValidator(): Promise<TestRun> {
  const run: TestRun = { name: 'Course Par Data Validator', steps: [] };
  console.log('\n⛳ Course Par Data Validator');

  const courses = COURSE_SEEDS.filter((c) => c.confident !== false);
  let passed = 0;
  let onP72 = 0;
  let failed = 0;

  for (const course of courses) {
    const { outcome, detail } = validateCoursePars(course);
    if (outcome === 'pass') {
      console.log(`  ✅ ${course.name} (${course.id})`);
      passed++;
    } else if (outcome === 'p72') {
      console.log(`  ⚠️  ${course.name} (${course.id}) — ${detail}`);
      onP72++;
    } else {
      console.log(`  ❌ ${course.name} (${course.id}) — ${detail}`);
      failed++;
    }
  }

  console.log('');
  console.log(
    `  Summary: ${courses.length} checked, ${passed} passed, ${onP72} still on P72, ${failed} failed`
  );

  await runStep(run, 'Par data integrity (no invalid layouts)', async () => {
    if (failed > 0) {
      return { ok: false, detail: `${failed} course(s) with invalid par data` };
    }
    return {
      ok: true,
      detail: `${passed} verified${onP72 > 0 ? `, ${onP72} still on P72` : ''}`,
    };
  });

  return run;
}

// --- main ------------------------------------------------------------------

function printSummary(runs: TestRun[]): void {
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  let totalSteps = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (const run of runs) {
    const passed = run.steps.filter((s) => s.result.ok).length;
    const failed = run.steps.length - passed;
    totalSteps += run.steps.length;
    totalPassed += passed;
    totalFailed += failed;
    const icon = failed === 0 ? '✅' : '❌';
    console.log(`${icon} ${run.name}: ${passed}/${run.steps.length} steps passed`);
    for (const s of run.steps.filter((x) => !x.result.ok)) {
      console.log(`     ↳ ${s.label}: ${s.result.detail ?? 'failed'}`);
    }
  }

  console.log('-'.repeat(60));
  console.log(`Total: ${totalPassed}/${totalSteps} steps passed, ${totalFailed} error(s)`);
  console.log('='.repeat(60));
}

async function main(): Promise<void> {
  console.log('SimCap Tournament Stress Tester');
  console.log(`Target: ${SUPABASE_URL}\n`);

  console.log('Signing in seed accounts…');
  const tokens = await signInAllPlayers();
  console.log(`✅ Signed in ${tokens.size} players\n`);

  const profiles = await loadProfiles();
  const profileByName = new Map(profiles.map((p) => [p.name, p]));
  const groupId = await loadTestGroup();
  const adminProfile = profileByName.get('Walter White')!;

  const ctx: TestContext = {
    profiles,
    profileByName,
    tokens,
    groupId,
    admin: adminProfile,
    createdLeagueIds: [],
    createdRoundIds: [],
  };

  const runs: TestRun[] = [];

  for (const fn of [
    testStrokePlay,
    testScramble,
    testBestBall,
    testMatchPlay,
    testHandicapValidator,
  ]) {
    try {
      runs.push(await fn(ctx));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`\n❌ Test suite crashed: ${msg}`);
      runs.push({ name: fn.name, steps: [{ label: 'suite error', result: { ok: false, detail: msg } }] });
      await cleanupTestRun(ctx);
    }
  }

  try {
    runs.push(await testCourseParDataValidator());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n❌ Test suite crashed: ${msg}`);
    runs.push({
      name: 'Course Par Data Validator',
      steps: [{ label: 'suite error', result: { ok: false, detail: msg } }],
    });
  }

  printSummary(runs);
  const anyFail = runs.some((r) => r.steps.some((s) => !s.result.ok));
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
