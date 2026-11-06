/**
 * Outreach acquisition email (reddit + email combined).
 * Same Resend path as daily-report. pg_cron job
 * email-daily-acquisition-report-daily at 18:00 UTC (10:00am PST).
 * pg_cron here is UTC-only. During PDT this fires at 11:00am Pacific
 * unless the cron is moved to 17:00 UTC.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

type ReportRow = {
  day: string
  channel: string
  get_redirects: number | null
  android_signups: number | null
  first_rounds_posted: number | null
  android_downloads: number | null
  ios_downloads: number | null
  total_downloads: number | null
}

function cell(n: number | null | undefined): string {
  if (n == null) return '—'
  return String(n)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

Deno.serve(async () => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }
    if (!RESEND_API_KEY) {
      throw new Error('Missing RESEND_API_KEY')
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    const { data, error } = await supabase.rpc('reddit_email_acquisition_report', {
      p_days: 14,
    })
    if (error) throw new Error(`rpc failed: ${error.message}`)

    const rows = (data ?? []) as ReportRow[]

    const today = new Date().toLocaleString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
      hour12: false,
    })

    const tableRows =
      rows.length === 0
        ? `<tr><td colspan="8" style="padding:8px;">No outreach activity or downloads in the last 14 days.</td></tr>`
        : rows
            .map(
              (r) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(String(r.day))}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(r.channel)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${cell(r.get_redirects)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${cell(r.android_signups)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${cell(r.first_rounds_posted)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${cell(r.android_downloads)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${cell(r.ios_downloads)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${cell(r.total_downloads)}</td>
      </tr>`,
            )
            .join('')

    const html = `
      <p style="font-family:sans-serif;font-size:14px;color:#333;max-width:720px;">
        <b>Note:</b> Android signups and iOS downloads are separate, non-comparable metrics — don’t combine them into a conversion rate.
        Android downloads (all sources) and iOS downloads (all sources) are both total app-wide installs that day, not outreach-attributed.
        Android’s figure comes from the install-referrer event log across every channel, same non-attribution caveat as the iOS number.
        Total downloads just sums the two for a quick glance, not a measure of outreach performance.
      </p>
      <h2 style="font-family:sans-serif;">Outreach (Reddit + email) — last 14 days — ${escapeHtml(today)} UTC</h2>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
        <thead>
          <tr>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:left;">Day</th>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:left;">Channel</th>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:right;">Get redirects</th>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:right;">Android signups</th>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:right;">First rounds</th>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:right;">Android downloads (all sources)</th>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:right;">iOS downloads (all sources)</th>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:right;">Total downloads</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      <p style="font-family:sans-serif;font-size:12px;color:#666;margin-top:16px;">
        One row per day. Get redirects, Android signups, and first rounds sum Reddit and email together.
        Android downloads count install-referrer events for every channel, excluding flagged duplicates.
        iOS downloads sum every source type in the App Store report for that day.
        Total downloads adds those two, treating a missing side as zero.
      </p>
    `

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SimCap <onboarding@resend.dev>',
        to: 'simcapadmin@gmail.com',
        subject: `SimCap outreach acquisition — ${today} UTC`,
        html,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Resend ${res.status}: ${body.slice(0, 400)}`)
    }

    return Response.json({ ok: true, rows: rows.length })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[email-daily-acquisition-report]', message)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
})
