/**
 * Reddit Ads daily campaign metrics → reddit_ads_daily.
 *
 * Scheduled daily at 10:45 UTC (pg_cron job sync-reddit-ads-daily).
 * Invoking without secrets returns ok/skipped (no-op).
 * Each run re-reads the last 2 UTC days plus today (metrics can revise for ~6h).
 *
 * Secrets:
 *   REDDIT_ADS_CLIENT_ID
 *   REDDIT_ADS_CLIENT_SECRET
 *   REDDIT_ADS_REFRESH_TOKEN   permanent refresh token from an adsread OAuth grant
 *   REDDIT_ADS_ACCOUNT_ID      ad account id (the path segment, not the full URL)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseRedditAdsReport } from '../_shared/attributionReports.ts'

const LOG = '[sync-reddit-ads]'
const USER_AGENT = 'simcap-ads-sync/1.0'

function requireEnv(name: string): string {
  const v = Deno.env.get(name)?.trim()
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

function utcDate(daysAgo: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

async function accessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const basic = btoa(`${clientId}:${clientSecret}`)
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Reddit token ${res.status}: ${body.slice(0, 400)}`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('Reddit token response missing access_token')
  return json.access_token
}

Deno.serve(async () => {
  const started = Date.now()
  const clientId = Deno.env.get('REDDIT_ADS_CLIENT_ID')?.trim()
  const clientSecret = Deno.env.get('REDDIT_ADS_CLIENT_SECRET')?.trim()
  const refreshToken = Deno.env.get('REDDIT_ADS_REFRESH_TOKEN')?.trim()
  const accountId = Deno.env.get('REDDIT_ADS_ACCOUNT_ID')?.trim()
  if (!clientId || !clientSecret || !refreshToken || !accountId) {
    const body = {
      ok: true,
      skipped: true,
      reason:
        'Missing REDDIT_ADS_CLIENT_ID, REDDIT_ADS_CLIENT_SECRET, REDDIT_ADS_REFRESH_TOKEN, and/or REDDIT_ADS_ACCOUNT_ID. Not scheduled; this invoke is a no-op.',
      ms: Date.now() - started,
    }
    console.log(LOG, JSON.stringify(body))
    return Response.json(body)
  }

  try {
    const token = await accessToken(clientId, clientSecret, refreshToken)
    const startsAt = `${utcDate(2)}T00:00:00Z`
    const endsAt = `${utcDate(-1)}T00:00:00Z`
    const res = await fetch(
      `https://ads-api.reddit.com/api/v3/ad_accounts/${encodeURIComponent(accountId)}/reports`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          data: {
            breakdowns: ['DATE', 'CAMPAIGN_ID'],
            fields: ['IMPRESSIONS', 'CLICKS', 'SPEND', 'CTR', 'CPC'],
            starts_at: startsAt,
            ends_at: endsAt,
            time_zone_id: 'GMT',
          },
        }),
      },
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Reddit report ${res.status}: ${text.slice(0, 500)}`)
    }
    const payload = await res.json()
    const rows = parseRedditAdsReport(payload)
    const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    })
    const syncedAt = new Date().toISOString()
    let upserted = 0
    if (rows.length > 0) {
      const { error, count } = await supabase.from('reddit_ads_daily').upsert(
        rows.map((r) => ({ ...r, synced_at: syncedAt })),
        { onConflict: 'date,campaign_id', count: 'exact' },
      )
      if (error) throw new Error(`upsert failed: ${error.message}`)
      upserted = typeof count === 'number' ? count : rows.length
    }

    const body = {
      ok: true,
      skipped: false,
      startsAt,
      endsAt,
      rowsAttempted: rows.length,
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
