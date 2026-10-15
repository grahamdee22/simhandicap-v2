/**
 * Scheduled PakGolf → community courses refresh (Mon/Wed/Fri).
 * Mirrors scripts/import-gspro-courses.ts + emails a short Resend summary.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { CURATED_NORMALIZED_NAMES } from '../_shared/curatedNormalizedNames.ts'
import { normalizeCourseName } from '../_shared/courseNameNormalize.ts'
import { parsePakGolfCourseList } from '../_shared/pakgolfParse.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const PAKGOLF_URL = 'https://pakgolfstudios.com/gspro-course-list/'
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const DEFAULT_SANITY_CAP = 300
const BATCH_SIZE = 100
const EXISTING_PAGE = 1000
const REPORT_TO = 'simcapadmin@gmail.com'

const GSPRO_DIFF_P5 = 24
const GSPRO_DIFF_P95 = 62
const GSPRO_DIFF_MAX_USABLE = 80

type InsertRow = {
  name: string
  name_normalized: string
  location: string | null
  designer: string | null
  gspro_difficulty: number | null
  source: 'community'
  confident: false
}

async function sendEmail(subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.error('[refresh-gspro-courses] RESEND_API_KEY missing; skip email:', subject)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'SimCap <onboarding@resend.dev>',
      to: REPORT_TO,
      subject,
      html,
    }),
  })
  if (!res.ok) {
    console.error('[refresh-gspro-courses] Resend failed', res.status, await res.text().catch(() => ''))
  }
}

function mapDifficultyToSlope(difficulty: number): number {
  const t = (difficulty - GSPRO_DIFF_P5) / (GSPRO_DIFF_P95 - GSPRO_DIFF_P5)
  const slope = 55 + t * (155 - 55)
  return Math.round(Math.min(155, Math.max(55, slope)))
}

function teeForDifficulty(difficulty: number | null): {
  tier: 3 | 4
  source: string
  name: string
  rating: number
  slope: number
} {
  if (difficulty != null && Number.isFinite(difficulty) && difficulty > 0 && difficulty <= GSPRO_DIFF_MAX_USABLE) {
    return {
      tier: 3,
      source: 'gspro_difficulty',
      name: 'Estimated',
      rating: 72,
      slope: mapDifficultyToSlope(difficulty),
    }
  }
  return { tier: 4, source: 'default', name: 'Default', rating: 72, slope: 113 }
}

function requestParams(req: Request): { sanityCap: number; forceWouldInsert: number | null } {
  let sanityCap = DEFAULT_SANITY_CAP
  let forceWouldInsert: number | null = null
  let hasQueryCap = false
  try {
    const url = new URL(req.url)
    const q = url.searchParams.get('sanity_cap')
    if (q != null && q !== '') {
      const n = Number(q)
      if (Number.isFinite(n) && n > 0) {
        sanityCap = Math.floor(n)
        hasQueryCap = true
      }
    }
    const force = url.searchParams.get('force_would_insert')
    if (force != null && force !== '') {
      const n = Number(force)
      if (Number.isFinite(n) && n >= 0) forceWouldInsert = Math.floor(n)
    }
  } catch {
    /* ignore */
  }
  if (!hasQueryCap) {
    const env = Number(Deno.env.get('GSPRO_REFRESH_SANITY_CAP') ?? '')
    if (Number.isFinite(env) && env > 0) sanityCap = Math.floor(env)
  }
  return { sanityCap, forceWouldInsert }
}

Deno.serve(async (req) => {
  const { sanityCap, forceWouldInsert } = requestParams(req)
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const msg = 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    await sendEmail(`GSPro refresh FAILED — ${today}`, `<p>${msg}</p>`)
    return new Response(msg, { status: 500 })
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let html: string
  try {
    const res = await fetch(PAKGOLF_URL, {
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    if (!res.ok) {
      const msg = `PakGolf fetch failed: HTTP ${res.status} ${res.statusText}`
      await sendEmail(`GSPro refresh FAILED — ${today}`, `<p>${msg}</p>`)
      return new Response(msg, { status: 502 })
    }
    html = await res.text()
  } catch (e) {
    const msg = `PakGolf fetch error: ${e instanceof Error ? e.message : String(e)}`
    await sendEmail(`GSPro refresh FAILED — ${today}`, `<p>${msg}</p>`)
    return new Response(msg, { status: 502 })
  }

  const parsed = parsePakGolfCourseList(html)
  if (parsed.length === 0) {
    const msg = 'Parsed 0 courses from PakGolf HTML (page structure may have changed).'
    await sendEmail(`GSPro refresh FAILED — ${today}`, `<p>${msg}</p>`)
    return new Response(msg, { status: 500 })
  }

  const curated = new Set(CURATED_NORMALIZED_NAMES)
  const existingNorm = new Set<string>()
  for (let offset = 0; ; offset += EXISTING_PAGE) {
    const { data, error } = await admin
      .from('courses')
      .select('name_normalized')
      .order('name_normalized', { ascending: true })
      .range(offset, offset + EXISTING_PAGE - 1)
    if (error) {
      const msg = `Could not read existing courses: ${error.message}`
      await sendEmail(`GSPro refresh FAILED — ${today}`, `<p>${msg}</p>`)
      return new Response(msg, { status: 500 })
    }
    const page = data ?? []
    for (const r of page) {
      if (r.name_normalized) existingNorm.add(r.name_normalized as string)
    }
    if (page.length < EXISTING_PAGE) break
  }

  const toInsert: InsertRow[] = []
  let skippedCurated = 0
  let skippedDup = 0

  for (const row of parsed) {
    const norm = normalizeCourseName(row.name)
    if (!norm) continue
    if (curated.has(norm)) {
      skippedCurated++
      continue
    }
    if (existingNorm.has(norm)) {
      skippedDup++
      continue
    }
    existingNorm.add(norm)
    toInsert.push({
      name: row.name,
      name_normalized: norm,
      location: row.location,
      designer: row.designer,
      gspro_difficulty: row.difficulty,
      source: 'community',
      confident: false,
    })
  }

  const wouldInsert = forceWouldInsert ?? toInsert.length
  if (wouldInsert > sanityCap) {
    const msg =
      `Sanity cap: would insert ${wouldInsert} courses (cap ${sanityCap}). ` +
      `Aborting — likely a PakGolf parse regression, not organic growth.`
    await sendEmail(
      `GSPro refresh FAILED — ${today}`,
      `<p><b>${msg}</b></p>
       <p>Parsed: ${parsed.length}<br/>Skipped curated: ${skippedCurated}<br/>Skipped duplicates: ${skippedDup}</p>`,
    )
    return new Response(JSON.stringify({ ok: false, error: msg, wouldInsert, sanityCap }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (forceWouldInsert != null) {
    // Test hook only — do not insert when simulating a large diff.
    const summaryHtml = `
      <h3>GSPro course refresh (dry) — ${today}</h3>
      <p>force_would_insert=${forceWouldInsert} under cap ${sanityCap}; no rows inserted.</p>
    `
    await sendEmail(`GSPro refresh — 0 new — ${today}`, summaryHtml)
    return new Response(
      JSON.stringify({
        ok: true,
        dryRun: true,
        parsed: parsed.length,
        skippedCurated,
        skippedDup,
        inserted: 0,
        wouldInsert,
        sanityCap,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let inserted = 0
  const insertedIds: { id: string; gspro_difficulty: number | null }[] = []

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE)
    const { data, error } = await admin.from('courses').insert(batch).select('id, gspro_difficulty')
    if (error) {
      const msg = `Insert failed at offset ${i}: ${error.message}`
      await sendEmail(`GSPro refresh FAILED — ${today}`, `<p>${msg}</p>`)
      return new Response(msg, { status: 500 })
    }
    for (const row of data ?? []) {
      insertedIds.push({
        id: row.id as string,
        gspro_difficulty: row.gspro_difficulty as number | null,
      })
    }
    inserted += batch.length
  }

  // New rows need enrichment_tier + course_tees or they stay hidden from the app catalog.
  const now = new Date().toISOString()
  for (const row of insertedIds) {
    const tee = teeForDifficulty(row.gspro_difficulty)
    const { error: teeErr } = await admin.from('course_tees').insert({
      course_id: row.id,
      name: tee.name,
      rating: tee.rating,
      slope: tee.slope,
      yards: null,
    })
    if (teeErr) {
      console.error('[refresh-gspro-courses] tee insert failed', row.id, teeErr.message)
      continue
    }
    const { error: updErr } = await admin
      .from('courses')
      .update({
        enrichment_tier: tee.tier,
        enrichment_source: tee.source,
        enrichment_at: now,
      })
      .eq('id', row.id)
    if (updErr) {
      console.error('[refresh-gspro-courses] enrich update failed', row.id, updErr.message)
    }
  }

  const summaryHtml = `
    <h3>GSPro course refresh — ${today}</h3>
    <p>
      Parsed: ${parsed.length}<br/>
      Skipped curated: ${skippedCurated}<br/>
      Skipped duplicates: ${skippedDup}<br/>
      Inserted: ${inserted}
    </p>
  `
  await sendEmail(`GSPro refresh — ${inserted} new — ${today}`, summaryHtml)

  return new Response(
    JSON.stringify({
      ok: true,
      parsed: parsed.length,
      skippedCurated,
      skippedDup,
      inserted,
      sanityCap,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
})
