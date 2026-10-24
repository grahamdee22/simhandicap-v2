#!/usr/bin/env node
/**
 * Invoke reset-facility-demo edge function (wipe + reseed facility pitch account).
 *
 * Requires .env:
 *   SUPABASE_URL
 *   FACILITY_DEMO_RESET_SECRET
 * Optional fallback: SUPABASE_SERVICE_ROLE_KEY (Authorization Bearer)
 *
 * Run: node scripts/reset-facility-demo.js
 */

const fs = require('fs');
const path = require('path');

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

const url = (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(
  /\/$/,
  ''
);
const secret = process.env.FACILITY_DEMO_RESET_SECRET || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!url) {
  console.error('Missing SUPABASE_URL');
  process.exit(1);
}
if (!serviceKey && !(secret && anonKey)) {
  console.error(
    'Need SUPABASE_SERVICE_ROLE_KEY, or FACILITY_DEMO_RESET_SECRET + EXPO_PUBLIC_SUPABASE_ANON_KEY'
  );
  process.exit(1);
}

async function main() {
  // Gateway requires Authorization; function accepts service role OR the demo secret.
  const gatewayKey = serviceKey || anonKey;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${gatewayKey}`,
    apikey: gatewayKey,
  };
  if (secret) headers['x-facility-demo-reset-secret'] = secret;

  const res = await fetch(`${url}/functions/v1/reset-facility-demo`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    console.error('Reset failed', res.status, body);
    process.exit(1);
  }
  console.log(JSON.stringify(body, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
