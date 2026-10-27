#!/usr/bin/env node
/**
 * Seed / ensure two is_test Group Challenge QA crews.
 *
 * Creates (or top-ups):
 *   - QA Group Challenge A / B (is_test=true)
 *   - 5 companion profiles per group (is_test=true) + 6 qualifying rounds each
 *   - grahamdee818@yahoo.com as creator/admin of both (manual QA)
 *   - walter-white@seed.simcap.test as admin of both (Playwright smoke)
 *     (companions + dual admins → each side can field 5 without putting the
 *     same dual-member account on both rosters — unique user constraint)
 *
 * Idempotent: safe to re-run. Existing groups are kept; missing members /
 * qualifying rounds are added.
 *
 * Requires .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Run: node scripts/seed-group-challenge-qa.js
 *   or: npm run seed:group-challenge-qa
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const GRAHAM_EMAIL = 'grahamdee818@yahoo.com';
const WALTER_EMAIL = 'walter-white@seed.simcap.test';
const GROUP_A = 'QA Group Challenge A';
const GROUP_B = 'QA Group Challenge B';
const ROUNDS_PER_PLAYER = 6;

const COURSES = [
  { id: 'pebble', name: 'Pebble Beach Golf Links', rating: 72.1, slope: 128, tee: 'White' },
  { id: 'augusta', name: 'Augusta National Golf Club', rating: 74.2, slope: 132, tee: 'Green' },
  { id: 'waste-mgmt', name: 'TPC Scottsdale Stadium', rating: 72.7, slope: 133, tee: 'Blue' },
  { id: 'bethpage', name: 'Bethpage Black', rating: 75.4, slope: 144, tee: 'Black' },
  { id: 'torrey-south', name: 'Torrey Pines South', rating: 75.3, slope: 144, tee: 'Blue' },
];

const PARS = [4, 4, 3, 4, 5, 4, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const PUTTING = { putt_all: 1.0, auto_2putt: 1.15, gimme_5: 1.05 };
const PIN = { thu: 1.12, fri: 1.08, sat: 1.04, sun: 1.0 };
const WIND = { off: 1.1, light: 1.05, strong: 1.0 };
const MULL = { on: 1.15, off: 1.0 };
const SIM_BASELINE = 0.88;

/** 5 companions per group — Graham is admin/member #6 (can manage both sides). */
const COMPANIONS_A = [
  { name: 'QA GCA Alpha', handicap: 9.2, platform: 'GSPro', simcapId: '991101' },
  { name: 'QA GCA Bravo', handicap: 12.4, platform: 'Trackman', simcapId: '991102' },
  { name: 'QA GCA Charlie', handicap: 7.8, platform: 'Foresight', simcapId: '991103' },
  { name: 'QA GCA Delta', handicap: 15.1, platform: 'Uneekor', simcapId: '991104' },
  { name: 'QA GCA Eagle', handicap: 11.0, platform: 'GSPro', simcapId: '991105' },
];

const COMPANIONS_B = [
  { name: 'QA GCB Echo', handicap: 10.6, platform: 'GSPro', simcapId: '991201' },
  { name: 'QA GCB Foxtrot', handicap: 14.3, platform: 'Trackman', simcapId: '991202' },
  { name: 'QA GCB Golf', handicap: 8.1, platform: 'Foresight', simcapId: '991203' },
  { name: 'QA GCB Hotel', handicap: 18.7, platform: 'Uneekor', simcapId: '991204' },
  { name: 'QA GCB India', handicap: 13.2, platform: 'Trackman', simcapId: '991205' },
];

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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

function computeDifferential(gross, rating, slope, putting, pin, wind, mulligans) {
  const modifier = Math.max(
    0.5,
    PUTTING[putting] * PIN[pin] * WIND[wind] * MULL[mulligans] * SIM_BASELINE
  );
  const raw = ((gross - rating) * 113) / slope;
  return {
    raw: round1(raw),
    adjusted: round1(raw * modifier),
    modifier: round2(modifier),
  };
}

function grossForHandicap(handicap) {
  const base = 72 + Math.round(handicap * 0.92);
  return Math.min(95, Math.max(68, base + randInt(-2, 3)));
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
    holes[17] = Math.max(1, Math.min(12, holes[17] + (targetGross - sum)));
  }
  return holes;
}

function daysAgoIso(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  d.setHours(10 + (daysBack % 8), randInt(0, 59), 0, 0);
  return d.toISOString();
}

async function findUserByEmail(email) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = (data.users ?? []).find((u) => (u.email || '').toLowerCase() === target);
    if (hit) return hit;
    if ((data.users ?? []).length < 200) break;
  }
  return null;
}

async function ensureCompanion(spec) {
  const email = `${slugify(spec.name)}@seed.simcap.test`;
  const password = `Seed-${spec.simcapId}!`;

  const { data: bySimcap } = await supabase
    .from('profiles')
    .select('id, display_name, is_test')
    .eq('simcap_id', spec.simcapId)
    .maybeSingle();

  let userId = bySimcap?.id ?? null;

  if (!userId) {
    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: spec.name },
    });
    if (authErr) {
      if (/already|registered|exists/i.test(authErr.message)) {
        const existing = await findUserByEmail(email);
        if (!existing) throw new Error(`createUser ${spec.name}: ${authErr.message}`);
        userId = existing.id;
      } else {
        throw new Error(`createUser ${spec.name}: ${authErr.message}`);
      }
    } else {
      userId = authData.user.id;
    }
  }

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
  if (profileErr) throw new Error(`profiles.update ${spec.name}: ${profileErr.message}`);

  return { ...spec, id: userId, email, password };
}

async function ensureQualifyingRounds(profile) {
  const { count, error: cErr } = await supabase
    .from('rounds')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.id)
    .eq('is_active', true)
    .eq('excludes_from_simcap_index', false);
  if (cErr) throw new Error(`rounds count ${profile.name}: ${cErr.message}`);

  const have = count ?? 0;
  const need = Math.max(0, ROUNDS_PER_PLAYER - have);
  if (need === 0) {
    console.log(`  rounds ok: ${profile.name} already has ${have}`);
    return have;
  }

  const puttingModes = Object.keys(PUTTING);
  const pinModes = Object.keys(PIN);
  const windModes = Object.keys(WIND);
  const mullModes = Object.keys(MULL);
  const rows = [];
  for (let i = 0; i < need; i++) {
    const course = COURSES[i % COURSES.length];
    const gross = grossForHandicap(profile.handicap);
    const putting = puttingModes[i % puttingModes.length];
    const pin = pinModes[i % pinModes.length];
    const wind = windModes[i % windModes.length];
    const mulligans = 'off'; // challenge-eligible history; mulligans off is fine for seed
    const { raw, adjusted, modifier } = computeDifferential(
      gross,
      course.rating,
      course.slope,
      putting,
      pin,
      wind,
      mulligans
    );
    rows.push({
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
      played_at: daysAgoIso(7 + i * 3),
      simcap_index_at_time: profile.handicap,
      holes_played: '18',
      is_active: true,
      excludes_from_simcap_index: false,
      is_test: true,
    });
  }

  const { error } = await supabase.from('rounds').insert(rows);
  if (error) throw new Error(`rounds.insert ${profile.name}: ${error.message}`);
  console.log(`  rounds: ${profile.name} +${need} (now ≥ ${have + need})`);
  return have + need;
}

async function ensureMember(groupId, member) {
  const { data: existing } = await supabase
    .from('group_members')
    .select('user_id, is_admin')
    .eq('group_id', groupId)
    .eq('user_id', member.id)
    .maybeSingle();
  if (existing) {
    if (member.isAdmin && !existing.is_admin) {
      const { error } = await supabase
        .from('group_members')
        .update({ is_admin: true })
        .eq('group_id', groupId)
        .eq('user_id', member.id);
      if (error) throw new Error(`group_members.promote ${member.displayName}: ${error.message}`);
      console.log(`  promoted admin: ${member.displayName} → group ${groupId}`);
    }
    return;
  }
  const { error } = await supabase.from('group_members').insert({
    group_id: groupId,
    user_id: member.id,
    display_name_snapshot: member.displayName,
    is_admin: member.isAdmin === true,
  });
  if (error) throw new Error(`group_members.insert ${member.displayName}: ${error.message}`);
  console.log(`  added member: ${member.displayName} (admin=${!!member.isAdmin})`);
}

async function ensureQaGroup(name, creatorId, members) {
  const { data: existing } = await supabase
    .from('social_groups')
    .select('id, name, is_test, created_by')
    .eq('name', name)
    .maybeSingle();

  let group = existing;
  if (!group) {
    const { data: created, error: gErr } = await supabase
      .from('social_groups')
      .insert({
        name,
        created_by: creatorId,
        is_active: true,
        is_test: true,
      })
      .select('id, name, is_test, created_by')
      .single();
    if (gErr) throw new Error(`social_groups.insert ${name}: ${gErr.message}`);
    group = created;
    console.log(`  created group: ${name} (${group.id})`);
  } else {
    if (!group.is_test) {
      throw new Error(`Group "${name}" exists but is_test=false — refusing to touch it.`);
    }
    console.log(`  group exists: ${name} (${group.id})`);
  }

  for (const m of members) {
    await ensureMember(group.id, m);
  }
  return group;
}

async function loadSeedProfileByEmail(email, label) {
  const auth = await findUserByEmail(email);
  if (!auth) {
    throw new Error(`Could not find auth user for ${email} (${label})`);
  }
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, display_name, is_test, ghin_index')
    .eq('id', auth.id)
    .maybeSingle();
  if (error || !profile) {
    throw new Error(`Missing profile for ${email}`);
  }
  if (!profile.is_test) {
    throw new Error(
      `${email} profile is_test=false — refusing to use a non-test account for QA seed.`
    );
  }
  console.log(`${label}: ${profile.display_name} (${email}) id=${profile.id}`);
  return profile;
}

async function main() {
  console.log('Seeding Group Challenge QA groups…');

  const grahamProfile = await loadSeedProfileByEmail(GRAHAM_EMAIL, 'Graham');
  const walterProfile = await loadSeedProfileByEmail(WALTER_EMAIL, 'Walter');

  await ensureQualifyingRounds({
    id: grahamProfile.id,
    name: grahamProfile.display_name,
    handicap: grahamProfile.ghin_index ?? 12,
    platform: 'GSPro',
  });
  await ensureQualifyingRounds({
    id: walterProfile.id,
    name: walterProfile.display_name,
    handicap: walterProfile.ghin_index ?? 8.4,
    platform: 'GSPro',
  });

  console.log('Companions A…');
  const companionsA = [];
  for (const spec of COMPANIONS_A) {
    const p = await ensureCompanion(spec);
    await ensureQualifyingRounds(p);
    companionsA.push(p);
  }

  console.log('Companions B…');
  const companionsB = [];
  for (const spec of COMPANIONS_B) {
    const p = await ensureCompanion(spec);
    await ensureQualifyingRounds(p);
    companionsB.push(p);
  }

  const dualAdmins = [
    {
      id: grahamProfile.id,
      displayName: grahamProfile.display_name,
      isAdmin: true,
    },
    {
      id: walterProfile.id,
      displayName: walterProfile.display_name,
      isAdmin: true,
    },
  ];
  const membersA = [
    ...dualAdmins,
    ...companionsA.map((p) => ({
      id: p.id,
      displayName: p.name,
      isAdmin: false,
    })),
  ];
  const membersB = [
    ...dualAdmins,
    ...companionsB.map((p) => ({
      id: p.id,
      displayName: p.name,
      isAdmin: false,
    })),
  ];

  const groupA = await ensureQaGroup(GROUP_A, grahamProfile.id, membersA);
  const groupB = await ensureQaGroup(GROUP_B, grahamProfile.id, membersB);

  const { data: verifyA } = await supabase
    .from('group_members')
    .select('user_id, is_admin, display_name_snapshot')
    .eq('group_id', groupA.id);
  const { data: verifyB } = await supabase
    .from('group_members')
    .select('user_id, is_admin, display_name_snapshot')
    .eq('group_id', groupB.id);

  console.log('\nDone.');
  console.log(
    JSON.stringify(
      {
        groups: [
          { id: groupA.id, name: groupA.name, is_test: groupA.is_test, members: verifyA?.length },
          { id: groupB.id, name: groupB.name, is_test: groupB.is_test, members: verifyB?.length },
        ],
        dualAdmins: {
          graham: {
            A: verifyA?.some((m) => m.user_id === grahamProfile.id && m.is_admin),
            B: verifyB?.some((m) => m.user_id === grahamProfile.id && m.is_admin),
          },
          walter: {
            A: verifyA?.some((m) => m.user_id === walterProfile.id && m.is_admin),
            B: verifyB?.some((m) => m.user_id === walterProfile.id && m.is_admin),
          },
        },
        companionsA: companionsA.map((p) => ({ name: p.name, email: p.email, password: p.password })),
        companionsB: companionsB.map((p) => ({ name: p.name, email: p.email, password: p.password })),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
