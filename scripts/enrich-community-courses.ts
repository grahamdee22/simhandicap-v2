#!/usr/bin/env npx tsx
/**
 * Offline enrichment for community courses: Tier 1, 3, 4 only.
 *
 * Requires .env:
 *   SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Run: npx tsx scripts/enrich-community-courses.ts
 *      npx tsx scripts/enrich-community-courses.ts --force  (re-enrich all)
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  curatedSeedByNormalizedName,
  gsProTeesFromSeed,
} from '../src/lib/curatedCourseCatalog';
import {
  isUsableGsproDifficulty,
  tier3SyntheticTee,
  tier4SyntheticTee,
} from '../src/lib/communityEnrichment';

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
const force = process.argv.includes('--force');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

type DbCourse = {
  id: string;
  name: string;
  name_normalized: string;
  gspro_difficulty: number | null;
  enrichment_tier: number | null;
};

/** PostgREST/Supabase default max rows per request. */
const PAGE_SIZE = 1000;

function courseQuery(admin: ReturnType<typeof createClient>) {
  return admin
    .from('courses')
    .select('id,name,name_normalized,gspro_difficulty,enrichment_tier')
    .eq('source', 'community')
    .order('name', { ascending: true });
}

async function fetchCoursePage(
  admin: ReturnType<typeof createClient>,
  offset: number
): Promise<DbCourse[]> {
  let query = courseQuery(admin).range(offset, offset + PAGE_SIZE - 1);
  if (!force) {
    query = query.is('enrichment_tier', null);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Fetch courses failed:', error.message);
    process.exit(1);
  }
  return (data ?? []) as DbCourse[];
}

async function enrichCourse(
  admin: ReturnType<typeof createClient>,
  course: DbCourse,
  seeds: ReturnType<typeof curatedSeedByNormalizedName>,
  counts: { tier1: number; tier3: number; tier4: number }
) {
  const seed = seeds.get(course.name_normalized);
  let tier: 1 | 3 | 4;
  let enrichmentSource: string;
  let teeRows: { name: string; rating: number; slope: number; yards: number | null }[];

  if (seed) {
    tier = 1;
    enrichmentSource = seed.id;
    teeRows = gsProTeesFromSeed(seed);
    counts.tier1++;
  } else if (isUsableGsproDifficulty(course.gspro_difficulty)) {
    tier = 3;
    enrichmentSource = 'gspro_difficulty';
    const syn = tier3SyntheticTee(course.gspro_difficulty as number);
    teeRows = [{ name: syn.name, rating: syn.rating, slope: syn.slope, yards: null }];
    counts.tier3++;
  } else {
    tier = 4;
    enrichmentSource = 'default';
    const syn = tier4SyntheticTee();
    teeRows = [{ name: syn.name, rating: syn.rating, slope: syn.slope, yards: null }];
    counts.tier4++;
  }

  const now = new Date().toISOString();

  await admin.from('course_tees').delete().eq('course_id', course.id);

  const { error: teeErr } = await admin.from('course_tees').insert(
    teeRows.map((t) => ({
      course_id: course.id,
      name: t.name,
      rating: t.rating,
      slope: t.slope,
      yards: t.yards,
    }))
  );
  if (teeErr) {
    console.error(`Tee insert failed for ${course.name}:`, teeErr.message);
    process.exit(1);
  }

  const { error: updErr } = await admin
    .from('courses')
    .update({
      enrichment_tier: tier,
      enrichment_source: enrichmentSource,
      enrichment_at: now,
    })
    .eq('id', course.id);
  if (updErr) {
    console.error(`Course update failed for ${course.name}:`, updErr.message);
    process.exit(1);
  }
}

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const seeds = curatedSeedByNormalizedName();

  const counts = { tier1: 0, tier3: 0, tier4: 0 };
  let processed = 0;
  let batch = 0;

  if (force) {
    let offset = 0;
    while (true) {
      const page = await fetchCoursePage(admin, offset);
      if (page.length === 0) break;
      batch++;
      console.log(
        `Batch ${batch}: enriching ${page.length} course(s) (offset ${offset})${force ? ' (force)' : ''}…`
      );
      for (const course of page) {
        await enrichCourse(admin, course, seeds, counts);
        processed++;
      }
      offset += page.length;
      if (page.length < PAGE_SIZE) break;
    }
  } else {
    while (true) {
      const page = await fetchCoursePage(admin, 0);
      if (page.length === 0) break;
      batch++;
      console.log(`Batch ${batch}: enriching ${page.length} unenriched course(s)…`);
      for (const course of page) {
        await enrichCourse(admin, course, seeds, counts);
        processed++;
      }
      if (page.length < PAGE_SIZE) break;
    }
  }

  console.log(`Done. Processed ${processed} course(s).`, counts);
  if (counts.tier1 > 0) {
    console.log('Spot-check Tier 1 name matches before trusting the batch.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
