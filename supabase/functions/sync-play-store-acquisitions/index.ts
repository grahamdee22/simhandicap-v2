/**
 * Play Console store_performance traffic_source CSV → android_store_acquisitions.
 *
 * Not scheduled. Invoking without secrets returns ok/skipped (no-op).
 *
 * Secrets (set when Play Console access is ready):
 *   PLAY_REPORTS_BUCKET       bucket id only, e.g. pubsite_prod_rev_0123456789
 *   PLAY_SERVICE_ACCOUNT_JSON full service-account JSON key (one line or raw)
 * Also SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (present on hosted functions).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5.9.6'
import { parseStorePerformanceTrafficSource } from '../_shared/attributionReports.ts'

const LOG = '[sync-play-store-acquisitions]'
const PACKAGE_NAME = 'com.simcap.app'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only'

function requireEnv(name: string): string {
  const v = Deno.env.get(name)?.trim()
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

function yyyymm(d: Date): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  return `${y}${m < 10 ? '0' : ''}${m}`
}

async function googleAccessToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as { client_email?: string; private_key?: string }
  if (!sa.client_email || !sa.private_key) {
    throw new Error('PLAY_SERVICE_ACCOUNT_JSON is missing client_email or private_key')
  }
  const key = await importPKCS8(sa.private_key, 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key)

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google token ${res.status}: ${body.slice(0, 400)}`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('Google token response missing access_token')
  return json.access_token
}

Deno.serve(async () => {
  const started = Date.now()
  const bucket = Deno.env.get('PLAY_REPORTS_BUCKET')?.trim()
  const saJson = Deno.env.get('PLAY_SERVICE_ACCOUNT_JSON')?.trim()
  if (!bucket || !saJson) {
    const body = {
      ok: true,
      skipped: true,
      reason:
        'Missing PLAY_REPORTS_BUCKET and/or PLAY_SERVICE_ACCOUNT_JSON. Cron is not scheduled; this invoke is a no-op.',
      ms: Date.now() - started,
    }
    console.log(LOG, JSON.stringify(body))
    return Response.json(body)
  }

  try {
    const token = await googleAccessToken(saJson)
    const now = new Date()
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const months = new Set([yyyymm(now), yyyymm(prev)])
    const prefix = `stats/store_performance/store_performance_${PACKAGE_NAME}_`
    const listUrl =
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?prefix=${encodeURIComponent(prefix)}`
    const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!listRes.ok) {
      const text = await listRes.text()
      throw new Error(`GCS list ${listRes.status}: ${text.slice(0, 400)}`)
    }
    const listed = (await listRes.json()) as { items?: { name: string }[] }
    const names = (listed.items ?? [])
      .map((i) => i.name)
      .filter((name) => name.endsWith('_traffic_source.csv'))
      .filter((name) => [...months].some((m) => name.includes(`_${m}_`)))

    const parsed = []
    for (const name of names) {
      const media =
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(name)}?alt=media`
      const fileRes = await fetch(media, { headers: { Authorization: `Bearer ${token}` } })
      if (!fileRes.ok) {
        const text = await fileRes.text()
        throw new Error(`GCS get ${name} ${fileRes.status}: ${text.slice(0, 300)}`)
      }
      parsed.push(...parseStorePerformanceTrafficSource(await fileRes.text()))
    }

    const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    })
    const syncedAt = new Date().toISOString()
    let upserted = 0
    const chunkSize = 200
    for (let i = 0; i < parsed.length; i += chunkSize) {
      const chunk = parsed.slice(i, i + chunkSize).map((r) => ({ ...r, synced_at: syncedAt }))
      const { error, count } = await supabase.from('android_store_acquisitions').upsert(chunk, {
        onConflict: 'date,traffic_source,search_term,utm_source,utm_campaign',
        count: 'exact',
      })
      if (error) throw new Error(`upsert failed: ${error.message}`)
      upserted += typeof count === 'number' ? count : chunk.length
    }

    const body = {
      ok: true,
      skipped: false,
      files: names,
      rowsAttempted: parsed.length,
      upserted,
      ms: Date.now() - started,
    }
    console.log(LOG, JSON.stringify(body))
    return Response.json(body)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(LOG, message)
    return Response.json({ ok: false, error: message, ms: Date.now() - started }, { status: 500 })
  }
})
