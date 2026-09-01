#!/usr/bin/env npx tsx
/**
 * Import GSPro Master Course List into public.courses (community only).
 *
 * Requires .env at repo root:
 *   SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Run: npx tsx scripts/import-gspro-courses.ts
 *      npx tsx scripts/import-gspro-courses.ts --debug
 *
 * Send PakGolf Studios a courtesy note before running against production.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { curatedNormalizedNameSet, normalizeCourseName } from '../src/lib/curatedCourseCatalog';

const PAKGOLF_URL = 'https://pakgolfstudios.com/gspro-course-list/';
const BATCH_SIZE = 100;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const KNOWN_COURSE_SNIPPETS = [
  'Brookside at the Rose Bowl',
  'Ambassador GC',
  'Pebble Beach Golf Links',
];

export type ParsedRow = {
  name: string;
  difficulty: number | null;
  location: string | null;
  designer: string | null;
};

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

function parseDifficulty(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&apos;/g, "'");
}

function stripHtmlTags(fragment: string): string {
  return fragment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cellText(htmlFragment: string): string {
  return decodeHtmlEntities(stripHtmlTags(htmlFragment));
}

/** Parse wpDataTable HTML (`table#table_1`) from the live PakGolf course list page. */
export function parsePakGolfHtml(html: string): ParsedRow[] {
  const tableMatch = html.match(/<table[^>]*\bid=["']table_1["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return [];

  const rows: ParsedRow[] = [];
  for (const tr of tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
    if (cells.length < 7) continue;
    const name = cells[0]?.trim();
    if (!name || name.toLowerCase() === 'name') continue;
    rows.push({
      name,
      difficulty: parseDifficulty(cells[1] ?? ''),
      location: cells[5]?.trim() || null,
      designer: cells[6]?.trim() || null,
    });
  }
  return rows;
}

/** Legacy markdown table lines (e.g. from markdown export tools); kept as fallback only. */
export function parsePakGolfMarkdown(html: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const line of html.split('\n')) {
    if (!line.startsWith('| ') || line.includes('---') || line.includes('Name | Difficulty')) continue;
    const parts = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((p) => p.trim());
    if (parts.length < 7) continue;
    const name = parts[0];
    if (!name) continue;
    rows.push({
      name,
      difficulty: parseDifficulty(parts[1]),
      location: parts[5] || null,
      designer: parts[6] || null,
    });
  }
  return rows;
}

export function parsePakGolfCourseList(html: string): ParsedRow[] {
  const fromHtml = parsePakGolfHtml(html);
  if (fromHtml.length > 0) return fromHtml;
  return parsePakGolfMarkdown(html);
}

export type FetchDiagnostics = {
  status: number;
  statusText: string;
  contentType: string | null;
  contentLength: string | null;
  userAgent: string;
  htmlLength: number;
  hasTableTag: boolean;
  hasTable1: boolean;
  hasWpDataTable: boolean;
  knownCourseHits: string[];
  preview: string;
  dumpPath: string | null;
};

export function logFetchDiagnostics(html: string, diag: FetchDiagnostics): void {
  console.log('--- PakGolf fetch diagnostics ---');
  console.log(`HTTP status: ${diag.status} ${diag.statusText}`);
  console.log(`Content-Type: ${diag.contentType ?? '(none)'}`);
  console.log(`Content-Length header: ${diag.contentLength ?? '(none)'}`);
  console.log(`User-Agent sent: ${diag.userAgent}`);
  console.log(`HTML byte length: ${diag.htmlLength}`);
  console.log(`Contains "<table": ${diag.hasTableTag}`);
  console.log(`Contains table id="table_1": ${diag.hasTable1}`);
  console.log(`Contains "wpDataTable": ${diag.hasWpDataTable}`);
  console.log(
    `Known course name hits: ${
      diag.knownCourseHits.length > 0 ? diag.knownCourseHits.join(', ') : '(none)'
    }`
  );
  console.log('First 500 characters:');
  console.log(diag.preview);
  if (diag.dumpPath) {
    console.log(`Full HTML written to: ${diag.dumpPath}`);
  }
  console.log('--------------------------------');
}

export function writeFetchDump(html: string, debug: boolean): string | null {
  if (!debug && process.env.PAKGOLF_DEBUG !== '1') return null;
  const cacheDir = path.join(__dirname, '.cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const dumpPath = path.join(cacheDir, 'pakgolf-last-fetch.html');
  fs.writeFileSync(dumpPath, html, 'utf8');
  return dumpPath;
}

export async function fetchPakGolfCourseListHtml(): Promise<{
  html: string;
  diagnostics: FetchDiagnostics;
}> {
  const res = await fetch(PAKGOLF_URL, {
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const html = await res.text();
  const debug = process.argv.includes('--debug');
  const dumpPath = writeFetchDump(html, debug);

  const diagnostics: FetchDiagnostics = {
    status: res.status,
    statusText: res.statusText,
    contentType: res.headers.get('content-type'),
    contentLength: res.headers.get('content-length'),
    userAgent: BROWSER_USER_AGENT,
    htmlLength: html.length,
    hasTableTag: /<table\b/i.test(html),
    hasTable1: /\bid=["']table_1["']/i.test(html),
    hasWpDataTable: /wpDataTable/i.test(html),
    knownCourseHits: KNOWN_COURSE_SNIPPETS.filter((s) => html.includes(s)),
    preview: html.slice(0, 500),
    dumpPath,
  };

  return { html, diagnostics };
}

async function main() {
  const debug = process.argv.includes('--debug');
  loadEnvFile();

  const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }

  console.log('Fetching PakGolf Master Course List…');
  const { html, diagnostics } = await fetchPakGolfCourseListHtml();
  logFetchDiagnostics(html, diagnostics);

  if (diagnostics.status < 200 || diagnostics.status >= 300) {
    console.error('Fetch failed:', diagnostics.status, diagnostics.statusText);
    process.exit(1);
  }

  const parsed = parsePakGolfCourseList(html);
  console.log(`Parsed ${parsed.length} rows from HTML.`);

  if (parsed.length === 0) {
    const autoDump = writeFetchDump(html, true);
    if (autoDump && !diagnostics.dumpPath) {
      console.error(`Parse returned 0 rows; full HTML also written to: ${autoDump}`);
    }
    console.error(
      'No courses parsed. If diagnostics show table_1 but 0 rows, the table structure may have changed.'
    );
    if (!diagnostics.hasTable1 && !diagnostics.hasWpDataTable) {
      console.error(
        'Likely cause: page shell without embedded table (JS-rendered data) or blocked/alternate response.'
      );
    }
    process.exit(1);
  }

  const curated = curatedNormalizedNameSet();
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existingRows, error: existingErr } = await admin
    .from('courses')
    .select('name_normalized');
  if (existingErr) {
    console.error('Could not read existing courses:', existingErr.message);
    process.exit(1);
  }
  const existingNorm = new Set((existingRows ?? []).map((r) => r.name_normalized as string));

  const toInsert: {
    name: string;
    name_normalized: string;
    location: string | null;
    designer: string | null;
    gspro_difficulty: number | null;
    source: 'community';
    confident: boolean;
  }[] = [];

  let skippedCurated = 0;
  let skippedDup = 0;

  for (const row of parsed) {
    const norm = normalizeCourseName(row.name);
    if (!norm) continue;
    if (curated.has(norm)) {
      skippedCurated++;
      continue;
    }
    if (existingNorm.has(norm)) {
      skippedDup++;
      continue;
    }
    existingNorm.add(norm);
    toInsert.push({
      name: row.name,
      name_normalized: norm,
      location: row.location,
      designer: row.designer,
      gspro_difficulty: row.difficulty,
      source: 'community',
      confident: false,
    });
  }

  console.log(
    `Inserting ${toInsert.length} courses (skipped ${skippedCurated} curated overlaps, ${skippedDup} already in DB).`
  );

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { error } = await admin.from('courses').insert(batch);
    if (error) {
      console.error('Insert batch failed at offset', i, error.message);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`  …${inserted}/${toInsert.length}`);
  }

  console.log('Done.');
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  process.argv[1].replace(/\\/g, '/').endsWith('import-gspro-courses.ts');

if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
