/**
 * Sync iOS App Store campaign download totals into ios_campaign_downloads.
 *
 * Auth: App Store Connect API key (ES256 JWT). Secrets (never commit .p8):
 *   ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (PEM), optional ASC_APP_APPLE_ID
 *   (+ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *
 * First-time: an Admin must create an ONGOING analyticsReportRequest for the app
 * (or this job will POST one). Sales and Reports can then download instances.
 *
 * Empty / privacy-suppressed ASC windows are treated as success with zero upserts.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5.9.6'

const ASC_BASE = 'https://api.appstoreconnect.apple.com'
const BUNDLE_ID = 'com.simcap.app'

type JsonApiList<T> = { data: T[]; links?: { next?: string } }
type ReportRequest = { id: string; type: string; attributes?: { accessType?: string } }
type Report = { id: string; type: string; attributes?: { name?: string; category?: string } }
type Instance = { id: string; type: string; attributes?: { granularity?: string; processingDate?: string } }
type Segment = { id: string; type: string; attributes?: { url?: string } }

function requireEnv(name: string): string {
  const v = Deno.env.get(name)?.trim()
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

function normalizePem(raw: string): string {
  // Support literal \n from secret stores, or raw multiline PEM.
  let pem = raw.replace(/\\n/g, '\n').trim()
  if (!pem.includes('BEGIN')) {
    pem = `-----BEGIN PRIVATE KEY-----\n${pem}\n-----END PRIVATE KEY-----`
  }
  return pem
}

async function createAscToken(): Promise<string> {
  const keyId = requireEnv('ASC_KEY_ID')
  const issuerId = requireEnv('ASC_ISSUER_ID')
  const privateKey = await importPKCS8(normalizePem(requireEnv('ASC_PRIVATE_KEY')), 'ES256')
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    .setIssuer(issuerId)
    .setIssuedAt(now)
    .setExpirationTime(now + 20 * 60)
    .setAudience('appstoreconnect-v1')
    .sign(privateKey)
}

async function ascFetch(path: string, token: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith('http') ? path : `${ASC_BASE}${path}`
  return await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

async function ascJson<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await ascFetch(path, token, init)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`ASC ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 500)}`)
  }
  return (await res.json()) as T
}

async function resolveAppAppleId(token: string): Promise<string> {
  const override = Deno.env.get('ASC_APP_APPLE_ID')?.trim()
  if (override) return override
  const list = await ascJson<JsonApiList<{ id: string }>>(
    `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`,
    token,
  )
  const id = list.data?.[0]?.id
  if (!id) throw new Error(`No ASC app found for bundleId=${BUNDLE_ID}`)
  return id
}

/**
 * Return an existing ONGOING analyticsReportRequest id, or try to create one.
 * Creating requires an ASC Admin key; Sales and Reports can only download after an Admin
 * has requested ONGOING once. Returns null when none exists and create is forbidden.
 */
async function ensureOngoingRequest(token: string, appId: string): Promise<string | null> {
  const existing = await ascJson<JsonApiList<ReportRequest>>(
    `/v1/apps/${appId}/analyticsReportRequests?filter[accessType]=ONGOING&limit=10`,
    token,
  )
  if (existing.data?.length) return existing.data[0].id

  const res = await ascFetch(`/v1/analyticsReportRequests`, token, {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'analyticsReportRequests',
        attributes: { accessType: 'ONGOING' },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    }),
  })
  if (res.status === 403 || res.status === 401) {
    console.warn(
      '[sync-ios-campaign-downloads] Cannot create ONGOING analyticsReportRequest (need ASC Admin once). Sales and Reports key can download after that.',
    )
    return null
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`ASC POST /v1/analyticsReportRequests → ${res.status}: ${body.slice(0, 500)}`)
  }
  const created = (await res.json()) as { data: ReportRequest }
  return created.data.id
}

async function findDownloadsDetailedReport(token: string, requestId: string): Promise<string | null> {
  // Campaign token column exists only on detailed downloads reports.
  const reports = await ascJson<JsonApiList<Report>>(
    `/v1/analyticsReportRequests/${requestId}/reports?filter[category]=COMMERCE&limit=50`,
    token,
  )
  const preferred =
    reports.data.find((r) => /app\s*downloads/i.test(r.attributes?.name ?? '') && /detailed/i.test(r.attributes?.name ?? '')) ??
    reports.data.find((r) => /app\s*downloads/i.test(r.attributes?.name ?? '') && /detail/i.test(r.attributes?.name ?? '')) ??
    reports.data.find((r) => /downloads/i.test(r.attributes?.name ?? '') && /detailed/i.test(r.attributes?.name ?? ''))
  return preferred?.id ?? null
}

async function listDailyInstances(token: string, reportId: string, limit = 14): Promise<Instance[]> {
  const res = await ascJson<JsonApiList<Instance>>(
    `/v1/analyticsReports/${reportId}/instances?filter[granularity]=DAILY&limit=${limit}`,
    token,
  )
  return res.data ?? []
}

async function listSegmentUrls(token: string, instanceId: string): Promise<string[]> {
  const res = await ascJson<JsonApiList<Segment>>(
    `/v1/analyticsReportInstances/${instanceId}/segments?fields[analyticsReportSegments]=url&limit=50`,
    token,
  )
  return (res.data ?? []).map((s) => s.attributes?.url).filter((u): u is string => !!u)
}

async function downloadGunzipText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Segment download ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  try {
    const ds = new DecompressionStream('gzip')
    const stream = new Blob([buf]).stream().pipeThrough(ds)
    return await new Response(stream).text()
  } catch {
    // Some environments return already-decoded text.
    return new TextDecoder().decode(buf)
  }
}

function colIndex(header: string[], candidates: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase())
  for (const c of candidates) {
    const i = lower.indexOf(c.toLowerCase())
    if (i >= 0) return i
  }
  return -1
}

type AggRow = { date: string; campaign_token: string; downloads: number; product_page_views: number | null }

/** Aggregate TSV rows by (date, campaign). Empty / missing Campaign → skip (organic bucket not tracked here). */
function parseDownloadsTsv(tsv: string): AggRow[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const header = lines[0].split('\t')
  const iDate = colIndex(header, ['Date', 'date'])
  const iCampaign = colIndex(header, ['Campaign', 'Campaign Token', 'campaign'])
  const iCounts = colIndex(header, ['Counts', 'Downloads', 'Total Downloads', 'counts'])
  const iPageViews = colIndex(header, ['Product Page Views', 'Page Views', 'product page views'])
  if (iDate < 0 || iCampaign < 0 || iCounts < 0) {
    // Wrong report shape — surface clearly rather than silently writing zeros.
    throw new Error(
      `Unexpected downloads TSV headers: ${header.slice(0, 12).join(' | ')} (need Date, Campaign, Counts)`,
    )
  }

  const map = new Map<string, AggRow>()
  for (const line of lines.slice(1)) {
    const cols = line.split('\t')
    const date = (cols[iDate] ?? '').trim()
    const campaign = (cols[iCampaign] ?? '').trim().toLowerCase()
    const downloads = Number.parseInt((cols[iCounts] ?? '0').replace(/,/g, ''), 10)
    if (!date || !campaign || !Number.isFinite(downloads)) continue
    const ppvRaw = iPageViews >= 0 ? Number.parseInt((cols[iPageViews] ?? '').replace(/,/g, ''), 10) : NaN
    const key = `${date}\0${campaign}`
    const prev = map.get(key)
    if (prev) {
      prev.downloads += downloads
      if (Number.isFinite(ppvRaw)) {
        prev.product_page_views = (prev.product_page_views ?? 0) + ppvRaw
      }
    } else {
      map.set(key, {
        date,
        campaign_token: campaign,
        downloads,
        product_page_views: Number.isFinite(ppvRaw) ? ppvRaw : null,
      })
    }
  }
  return [...map.values()]
}

Deno.serve(async (_req) => {
  const started = Date.now()
  try {
    const token = await createAscToken()
    const appId = await resolveAppAppleId(token)
    const requestId = await ensureOngoingRequest(token, appId)
    if (!requestId) {
      return Response.json({
        ok: true,
        note:
          'No ONGOING analyticsReportRequest yet. An ASC Admin must create one once in App Store Connect (Analytics → Reports / API). This Sales and Reports key cannot create it; sync will succeed after that exists.',
        appId,
        upserted: 0,
        ms: Date.now() - started,
      })
    }

    const reportId = await findDownloadsDetailedReport(token, requestId)

    if (!reportId) {
      return Response.json({
        ok: true,
        note: 'No COMMERCE App Downloads Detailed report yet (ONGOING first instance usually 24–48h after request). Treated as empty, not an error.',
        appId,
        requestId,
        upserted: 0,
        ms: Date.now() - started,
      })
    }

    const instances = await listDailyInstances(token, reportId, 21)
    if (instances.length === 0) {
      return Response.json({
        ok: true,
        note: 'No DAILY instances yet (Apple may withhold <5 download windows). Empty result, not an error.',
        appId,
        requestId,
        reportId,
        upserted: 0,
        ms: Date.now() - started,
      })
    }

    const aggregated = new Map<string, AggRow>()
    for (const inst of instances) {
      const urls = await listSegmentUrls(token, inst.id)
      for (const url of urls) {
        const text = await downloadGunzipText(url)
        for (const row of parseDownloadsTsv(text)) {
          const key = `${row.date}\0${row.campaign_token}`
          const prev = aggregated.get(key)
          if (prev) {
            prev.downloads += row.downloads
            if (row.product_page_views != null) {
              prev.product_page_views = (prev.product_page_views ?? 0) + row.product_page_views
            }
          } else {
            aggregated.set(key, { ...row })
          }
        }
      }
    }

    const rows = [...aggregated.values()]
    const supabase = createClient(
      requireEnv('SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false } },
    )

    const syncedAt = new Date().toISOString()
    let upserted = 0
    // Chunk upserts to stay under payload limits.
    const chunkSize = 200
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize).map((r) => ({
        date: r.date,
        campaign_token: r.campaign_token,
        downloads: r.downloads,
        product_page_views: r.product_page_views,
        synced_at: syncedAt,
      }))
      const { error } = await supabase.from('ios_campaign_downloads').upsert(chunk, {
        onConflict: 'date,campaign_token',
      })
      if (error) throw new Error(`upsert failed: ${error.message}`)
      upserted += chunk.length
    }

    return Response.json({
      ok: true,
      appId,
      requestId,
      reportId,
      instances: instances.length,
      upserted,
      ms: Date.now() - started,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[sync-ios-campaign-downloads]', message)
    return Response.json({ ok: false, error: message, ms: Date.now() - started }, { status: 500 })
  }
})
