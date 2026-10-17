#!/usr/bin/env node
/**
 * Seed dedicated demo-recording accounts (is_test = true) for Maestro footage.
 *
 * Standalone — does NOT import or call scripts/seed-test-data.js (no Walter White /
 * seed.simcap.test fixtures). Creates exactly:
 *   - Jordan Ellis, Alex Rivera
 *   - Fairway Collective (those two members only)
 *
 * Does not wipe other is_test rows outside this group.
 *
 * Requires .env:
 *   SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Run: node scripts/seed-demo-recording.js
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

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Believable names for on-camera demo — not QA fixtures. */
const DEMO_USERS = [
  {
    email: 'jordan.ellis@demo.simcap.test',
    password: 'Demo-Recording-JEllis!',
    displayName: 'Jordan Ellis',
    platform: 'GSPro',
    ghin: 9.2,
    simcapId: '482917',
  },
  {
    email: 'alex.rivera@demo.simcap.test',
    password: 'Demo-Recording-ARivera!',
    displayName: 'Alex Rivera',
    platform: 'GSPro',
    ghin: 12.4,
    simcapId: '619384',
  },
];

const GROUP_NAME = 'Fairway Collective';

async function upsertDemoUser(spec) {
  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = (listed?.users ?? []).find(
    (u) => (u.email ?? '').toLowerCase() === spec.email.toLowerCase()
  );

  let userId = existing?.id;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: spec.email,
      password: spec.password,
      email_confirm: true,
      user_metadata: { display_name: spec.displayName },
    });
    if (error) throw new Error(`createUser ${spec.email}: ${error.message}`);
    userId = data.user.id;
    console.log(`Created auth user ${spec.displayName} (${spec.email})`);
  } else {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: spec.password,
      email_confirm: true,
      user_metadata: { display_name: spec.displayName },
    });
    if (error) throw new Error(`updateUser ${spec.email}: ${error.message}`);
    console.log(`Updated auth user ${spec.displayName} (${spec.email})`);
  }

  const { error: pErr } = await admin.from('profiles').upsert(
    {
      id: userId,
      display_name: spec.displayName,
      preferred_platform: spec.platform,
      ghin_index: spec.ghin,
      simcap_id: spec.simcapId,
      is_test: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (pErr) throw new Error(`profiles upsert ${spec.displayName}: ${pErr.message}`);

  return { ...spec, id: userId };
}

async function ensureGroup(creator, member) {
  const { data: existing } = await admin
    .from('social_groups')
    .select('id, name, created_by, is_test')
    .eq('created_by', creator.id)
    .eq('name', GROUP_NAME)
    .eq('is_active', true)
    .maybeSingle();

  let groupId = existing?.id;
  if (!groupId) {
    const { data, error } = await admin
      .from('social_groups')
      .insert({
        name: GROUP_NAME,
        created_by: creator.id,
        is_test: true,
        is_active: true,
        expanded_course_list_enabled: false,
      })
      .select('id')
      .single();
    if (error) throw new Error(`create group: ${error.message}`);
    groupId = data.id;
    console.log(`Created group "${GROUP_NAME}"`);
  } else {
    await admin.from('social_groups').update({ is_test: true }).eq('id', groupId);
    console.log(`Reusing group "${GROUP_NAME}" (${groupId})`);
  }

  const keepIds = new Set([creator.id, member.id]);
  for (const u of [creator, member]) {
    const { error } = await admin.from('group_members').upsert(
      {
        group_id: groupId,
        user_id: u.id,
        display_name_snapshot: u.displayName,
      },
      { onConflict: 'group_id,user_id' }
    );
    if (error) throw new Error(`group_members ${u.displayName}: ${error.message}`);
  }

  // Strip any accidental extras (e.g. seed-test-data users) from this demo group only.
  const { data: members, error: mErr } = await admin
    .from('group_members')
    .select('id, user_id, display_name_snapshot')
    .eq('group_id', groupId);
  if (mErr) throw new Error(`list group_members: ${mErr.message}`);
  for (const row of members ?? []) {
    if (!keepIds.has(row.user_id)) {
      const { error: delErr } = await admin.from('group_members').delete().eq('id', row.id);
      if (delErr) {
        console.warn(`Could not remove extra member ${row.display_name_snapshot}:`, delErr.message);
      } else {
        console.log(`Removed extra member from ${GROUP_NAME}: ${row.display_name_snapshot}`);
      }
    }
  }

  return groupId;
}

async function main() {
  const users = [];
  for (const spec of DEMO_USERS) {
    users.push(await upsertDemoUser(spec));
  }
  const [jordan, alex] = users;
  const groupId = await ensureGroup(jordan, alex);

  // Confirm daily-report exclusion
  const { count: testCount } = await admin
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('is_test', true)
    .in(
      'id',
      users.map((u) => u.id)
    );
  const { count: realWouldCount } = await admin
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('is_test', false)
    .in(
      'id',
      users.map((u) => u.id)
    );

  console.log('\nDemo recording accounts ready:');
  for (const u of users) {
    console.log(`  ${u.displayName}  ${u.email}  /  ${u.password}`);
  }
  console.log(`  Group: ${GROUP_NAME} (${groupId})`);
  console.log(`  is_test profiles matched: ${testCount} (should be 2)`);
  console.log(`  is_test=false match for these ids: ${realWouldCount} (should be 0)`);
  console.log('\nUse Jordan for log-round + create-tournament Maestro flows.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
