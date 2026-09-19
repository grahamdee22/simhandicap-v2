/**
 * Shared harness for tournament lifecycle verification scripts.
 * Hits live Supabase with seed test accounts; creates throwaway groups; cleans up after.
 */
import fs from 'fs';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  adjustedDifferential,
  handicapIndexFromDifferentials,
  round1,
} from '../../src/lib/handicap';
import { getCourseById } from '../../src/lib/courses';
import { isLeagueReadyToAutoComplete } from '../../src/lib/leagueCompletion';
import { autoAssignMembersToTeams } from '../../src/lib/tournamentTeamCount';
/** Local row shapes — avoid importing src/lib/leagues (pulls useAppStore → react-native). */
export type DbLeagueRow = {
  id: string;
  group_id: string;
  name: string;
  format: 'stroke' | 'scramble' | 'best_ball' | 'match_play';
  start_date: string;
  end_date: string;
  rounds_that_count: number;
  use_handicap: boolean;
  status: string;
  match_play_pairing_method?: string | null;
  scramble_handicap_override?: number | null;
};

export type DbLeagueEntryRow = {
  id: string;
  league_id: string;
  user_id: string;
  league_team_id: string | null;
  points: number;
  mp_wins?: number;
  mp_losses?: number;
  mp_halved?: number;
  bracket_seed?: number | null;
};

export type DbLeagueRoundRow = {
  id: string;
  league_id: string;
  user_id: string;
  league_team_id: string | null;
  round_id: string;
  gross_score: number;
  net_score: number;
  player_opted_in: boolean;
  hole_entry_status: string | null;
};

export type DbLeagueTeamRow = {
  id: string;
  league_id: string;
  name: string;
  designated_scorer_id?: string | null;
};

export function loadEnvFile(): void {
  const envPath = path.join(__dirname, '..', '..', '.env');
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

export const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const ANON_KEY =
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

export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type ProfileSpec = {
  name: string;
  simcapId: string;
  handicap: number;
  platform: string;
};

/** Lowest-index-first useful for seeding checks. */
export const PROFILE_SPECS: ProfileSpec[] = [
  { name: 'Shooter McGavin', simcapId: '124856', handicap: 4.2, platform: 'Trackman' },
  { name: 'Roy Kent', simcapId: '718205', handicap: 6.8, platform: 'Uneekor' },
  { name: 'Walter White', simcapId: '847291', handicap: 8.4, platform: 'GSPro' },
  { name: 'Ty Webb', simcapId: '280143', handicap: 9.7, platform: 'Uneekor' },
  { name: 'Danny Ocean', simcapId: '392018', handicap: 11.2, platform: 'Trackman' },
  { name: 'Ted Lasso', simcapId: '561034', handicap: 13.6, platform: 'Foresight' },
  { name: 'Danny Noonan', simcapId: '496820', handicap: 15.3, platform: 'GSPro' },
  { name: 'Al Czervik', simcapId: '635709', handicap: 18.9, platform: 'Foresight' },
  { name: 'Tony Soprano', simcapId: '751364', handicap: 21.1, platform: 'Trackman' },
  { name: 'Happy Gilmore', simcapId: '903472', handicap: 23.4, platform: 'GSPro' },
];

export type LoadedProfile = ProfileSpec & { id: string; email: string; password: string };

export type VerifyCtx = {
  runId: string;
  profiles: LoadedProfile[];
  profileByName: Map<string, LoadedProfile>;
  tokens: Map<string, string>;
  groupId: string;
  groupName: string;
  adminUser: LoadedProfile;
  createdLeagueIds: string[];
  createdRoundIds: string[];
};

export type CheckResult = { ok: boolean; detail?: string };

export class Asserter {
  pass = 0;
  fail = 0;
  results: { label: string; ok: boolean; detail?: string }[] = [];

  check(label: string, ok: boolean, detail?: string): boolean {
    this.results.push({ label, ok, detail });
    if (ok) {
      this.pass += 1;
      console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
    } else {
      this.fail += 1;
      console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    }
    return ok;
  }

  async step(label: string, fn: () => Promise<CheckResult> | CheckResult): Promise<boolean> {
    try {
      const r = await fn();
      return this.check(label, r.ok, r.detail);
    } catch (e) {
      return this.check(label, false, e instanceof Error ? e.message : String(e));
    }
  }

  summary(suiteName: string): number {
    console.log(
      `\n${suiteName}: ${this.pass} passed, ${this.fail} failed (${this.pass + this.fail} total)`
    );
    return this.fail === 0 ? 0 : 1;
  }
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export function netFromIndex(gross: number, handicap: number): number {
  return round1(Math.max(1, gross - Math.round(handicap)));
}

export function generateHoleScores(targetGross: number): number[] {
  const pars = [4, 4, 3, 4, 5, 4, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
  const holes = pars.map((p) => p);
  let sum = holes.reduce((a, b) => a + b, 0);
  let guard = 0;
  while (sum !== targetGross && guard < 800) {
    const idx = Math.floor(Math.random() * 18);
    const delta = targetGross > sum ? 1 : -1;
    const next = holes[idx]! + delta;
    if (next >= 1 && next <= 12) {
      holes[idx] = next;
      sum += delta;
    }
    guard++;
  }
  if (sum !== targetGross) {
    holes[17] = Math.max(1, Math.min(12, holes[17]! + (targetGross - sum)));
  }
  return holes;
}

/** Fixed hole scores for match-play gross tests (deterministic). */
export function matchPlayGrossHoles(
  p1Wins: number,
  p2Wins: number
): {
  p1: { hole_number: number; gross_score: number }[];
  p2: { hole_number: number; gross_score: number }[];
} {
  const halved = Math.max(0, 18 - p1Wins - p2Wins);
  const p1: { hole_number: number; gross_score: number }[] = [];
  const p2: { hole_number: number; gross_score: number }[] = [];
  let w1 = 0;
  let w2 = 0;
  let h = 0;
  for (let i = 1; i <= 18; i++) {
    if (w1 < p1Wins) {
      p1.push({ hole_number: i, gross_score: 3 });
      p2.push({ hole_number: i, gross_score: 5 });
      w1++;
    } else if (w2 < p2Wins) {
      p1.push({ hole_number: i, gross_score: 5 });
      p2.push({ hole_number: i, gross_score: 3 });
      w2++;
    } else if (h < halved) {
      p1.push({ hole_number: i, gross_score: 4 });
      p2.push({ hole_number: i, gross_score: 4 });
      h++;
    } else {
      p1.push({ hole_number: i, gross_score: 4 });
      p2.push({ hole_number: i, gross_score: 4 });
    }
  }
  return { p1, p2 };
}

export async function restRpcPost<T>(
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

export async function invokeEdgeFunction<T extends Record<string, unknown>>(
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

export async function loadProfilesByNames(names: string[]): Promise<LoadedProfile[]> {
  const specs = names.map((n) => {
    const s = PROFILE_SPECS.find((p) => p.name === n);
    if (!s) throw new Error(`Unknown seed profile ${n}`);
    return s;
  });
  const { data, error } = await admin
    .from('profiles')
    .select('id, display_name')
    .eq('is_test', true)
    .in('display_name', names);
  if (error) throw new Error(`profiles load: ${error.message}`);
  const byName = new Map((data ?? []).map((r) => [r.display_name as string, r.id as string]));
  return specs.map((spec) => {
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

export async function signInProfiles(profiles: LoadedProfile[]): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  for (const p of profiles) {
    const client = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email: p.email,
      password: p.password,
    });
    if (error || !data.session?.access_token) {
      throw new Error(`Sign-in failed for ${p.name}: ${error?.message ?? 'no session'}`);
    }
    tokens.set(p.name, data.session.access_token);
  }
  return tokens;
}

export async function createThrowawayGroup(
  profiles: LoadedProfile[],
  runId: string,
  label: string
): Promise<{ groupId: string; groupName: string }> {
  const groupName = `[verify] ${label} ${runId}`;
  const creator = profiles[0]!;
  const { data: group, error } = await admin
    .from('social_groups')
    .insert({
      name: groupName,
      created_by: creator.id,
      is_active: true,
      is_test: true,
    })
    .select('id')
    .single();
  if (error || !group) throw new Error(`group create: ${error?.message}`);

  const { error: memErr } = await admin.from('group_members').insert(
    profiles.map((p) => ({
      group_id: group.id,
      user_id: p.id,
      display_name_snapshot: p.name,
      is_admin: p.id === creator.id,
    }))
  );
  if (memErr) throw new Error(`group members: ${memErr.message}`);

  return { groupId: group.id as string, groupName };
}

export async function setupVerifyCtx(
  playerNames: string[],
  label: string
): Promise<VerifyCtx> {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const profiles = await loadProfilesByNames(playerNames);
  const tokens = await signInProfiles(profiles);
  const { groupId, groupName } = await createThrowawayGroup(profiles, runId, label);
  return {
    runId,
    profiles,
    profileByName: new Map(profiles.map((p) => [p.name, p])),
    tokens,
    groupId,
    groupName,
    adminUser: profiles[0]!,
    createdLeagueIds: [],
    createdRoundIds: [],
  };
}

export async function cleanupVerifyCtx(ctx: VerifyCtx): Promise<void> {
  for (const leagueId of ctx.createdLeagueIds) {
    const { error } = await admin.from('leagues').delete().eq('id', leagueId);
    if (error) console.warn(`  [cleanup] league ${leagueId}: ${error.message}`);
  }
  if (ctx.createdRoundIds.length > 0) {
    const { error } = await admin.from('rounds').delete().in('id', ctx.createdRoundIds);
    if (error) console.warn(`  [cleanup] rounds: ${error.message}`);
  }
  const { error: gErr } = await admin.from('social_groups').delete().eq('id', ctx.groupId);
  if (gErr) console.warn(`  [cleanup] group ${ctx.groupId}: ${gErr.message}`);
  ctx.createdLeagueIds.length = 0;
  ctx.createdRoundIds.length = 0;
}

export async function createLeague(
  ctx: VerifyCtx,
  opts: {
    name: string;
    format: 'stroke' | 'scramble' | 'best_ball' | 'match_play';
    startDate: string;
    endDate: string;
    roundsThatCount?: number;
    useHandicap?: boolean;
    scrambleHandicapOverride?: number | null;
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
      rounds_that_count: opts.roundsThatCount ?? 4,
      use_handicap: opts.useHandicap !== false,
      created_by: ctx.adminUser.id,
      status: 'active',
      match_play_pairing_method: opts.matchPlayPairingMethod ?? null,
      scramble_handicap_override: opts.scrambleHandicapOverride ?? null,
      is_test: true,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`league insert: ${error?.message ?? 'unknown'}`);
  ctx.createdLeagueIds.push(data.id);
  return data as DbLeagueRow;
}

/** Auto-enter every group member (mirrors create flow). */
export async function enterAllGroupMembers(
  ctx: VerifyCtx,
  leagueId: string
): Promise<Map<string, DbLeagueEntryRow>> {
  const rows = ctx.profiles.map((p) => ({
    league_id: leagueId,
    user_id: p.id,
    league_team_id: null as string | null,
    rounds_played: 0,
    points: 0,
    mp_wins: 0,
    mp_losses: 0,
    mp_halved: 0,
  }));
  const { data, error } = await admin.from('league_entries').insert(rows).select('*');
  if (error) throw new Error(`entries: ${error.message}`);
  const map = new Map<string, DbLeagueEntryRow>();
  for (const e of data ?? []) map.set(e.user_id, e as DbLeagueEntryRow);
  return map;
}

export async function createTeamsWithMembers(
  ctx: VerifyCtx,
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

export async function insertRound(
  ctx: VerifyCtx,
  profile: LoadedProfile,
  gross: number,
  playedAt: string,
  opts?: { excludesFromSimcapIndex?: boolean; holes?: number[] }
): Promise<{ roundId: string; holes: { hole_number: number; gross_score: number }[]; adjustedDiff: number }> {
  const course = getCourseById('pebble')!;
  const white = course.tees!.find((t) => t.name === 'White')!;
  const holesArr = opts?.holes ?? generateHoleScores(gross);
  const { raw, adjusted, modifier } = adjustedDifferential(
    gross,
    white.rating,
    white.slope,
    'auto_2putt',
    'sat',
    'off',
    'none'
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
      mulligans: 'none',
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
      excludes_from_simcap_index: !!opts?.excludesFromSimcapIndex,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`round insert: ${error?.message}`);
  ctx.createdRoundIds.push(data.id);
  return {
    roundId: data.id,
    holes: holesArr.map((gross_score, i) => ({ hole_number: i + 1, gross_score })),
    adjustedDiff: adjusted,
  };
}

export async function insertLeagueRound(opts: {
  leagueId: string;
  profile: LoadedProfile;
  entryId: string;
  teamId: string | null;
  roundId: string;
  gross: number;
  net: number;
  holeEntryStatus?: 'complete' | 'pending_holes';
}): Promise<string> {
  const { data, error } = await admin
    .from('league_rounds')
    .insert({
      league_id: opts.leagueId,
      user_id: opts.profile.id,
      league_team_id: opts.teamId,
      round_id: opts.roundId,
      gross_score: opts.gross,
      net_score: opts.net,
      counted: true,
      player_opted_in: true,
      hole_entry_status: opts.holeEntryStatus ?? 'complete',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`league_round: ${error?.message}`);
  return data.id;
}

export async function upsertHoles(
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

export async function fetchLeagueBundle(leagueId: string): Promise<{
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

export async function fetchTeamHoleScores(leagueId: string) {
  const { data, error } = await admin
    .from('tournament_team_hole_scores')
    .select('*')
    .eq('league_id', leagueId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function displayNames(ctx: VerifyCtx): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of ctx.profiles) out[p.id] = p.name;
  return out;
}

export async function markLeagueCompleted(leagueId: string): Promise<void> {
  const { error } = await admin
    .from('leagues')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', leagueId);
  if (error) throw new Error(`complete league: ${error.message}`);
}

export async function countActiveLeaguesForGroup(groupId: string): Promise<number> {
  const { data, error } = await admin
    .from('leagues')
    .select('id')
    .eq('group_id', groupId)
    .eq('status', 'active');
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

export async function fetchRoundExclusionFlag(roundId: string): Promise<boolean | null> {
  const { data, error } = await admin
    .from('rounds')
    .select('excludes_from_simcap_index')
    .eq('id', roundId)
    .maybeSingle();
  if (error || !data) return null;
  return data.excludes_from_simcap_index === true;
}

export async function fetchUserActiveDifferentials(userId: string): Promise<
  { id: string; differential: number; excludes: boolean }[]
> {
  const { data, error } = await admin
    .from('rounds')
    .select('id, differential, excludes_from_simcap_index')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('played_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    differential: Number(r.differential),
    excludes: r.excludes_from_simcap_index === true,
  }));
}

export function indexFromFetchedRounds(
  rows: { differential: number; excludes: boolean }[]
): number | null {
  const counting = rows.filter((r) => !r.excludes).map((r) => r.differential);
  return handicapIndexFromDifferentials(counting);
}

export async function resolveEffectiveIndexes(
  userIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, ghin_index')
    .in('id', userIds);
  const ghinByUser = new Map<string, number>();
  for (const p of (profiles ?? []) as { id: string; ghin_index: number | string | null }[]) {
    if (p.ghin_index != null && Number.isFinite(Number(p.ghin_index))) {
      const n = Number(p.ghin_index);
      if (n >= 0) ghinByUser.set(p.id, n);
    }
  }

  const { data: rounds } = await admin
    .from('rounds')
    .select('user_id, differential, played_at')
    .in('user_id', userIds)
    .eq('is_active', true)
    .order('played_at', { ascending: true });

  const diffsByUser = new Map<string, number[]>();
  for (const r of (rounds ?? []) as {
    user_id: string;
    differential: number | null;
  }[]) {
    if (r.differential == null || !Number.isFinite(Number(r.differential))) continue;
    const list = diffsByUser.get(r.user_id) ?? [];
    list.push(Number(r.differential));
    diffsByUser.set(r.user_id, list);
  }

  for (const uid of userIds) {
    const diffs = diffsByUser.get(uid) ?? [];
    if (diffs.length >= 3) {
      const idx = handicapIndexFromDifferentials(diffs);
      if (idx != null) {
        out.set(uid, idx);
        continue;
      }
    }
    const ghin = ghinByUser.get(uid);
    if (ghin != null) out.set(uid, ghin);
  }
  return out;
}

export { autoAssignMembersToTeams, isLeagueReadyToAutoComplete, getCourseById };
