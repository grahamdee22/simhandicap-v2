/**
 * Daily Reddit + email acquisition email (marketing forwardable).
 * Same Resend path as daily-report. Scheduled via pg_cron
 * `email-daily-acquisition-report-daily` at 0 11 * * * (11:00 UTC).
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
  ios_downloads: number | null
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

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    })

    const tableRows =
      rows.length === 0
        ? `<tr><td colspan="6" style="padding:8px;">No reddit/email activity in the last 14 days.</td></tr>`
        : rows
            .map(
              (r) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(String(r.day))}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${escapeHtml(r.channel)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${cell(r.get_redirects)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${cell(r.android_signups)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${cell(r.first_rounds_posted)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${cell(r.ios_downloads)}</td>
      </tr>`,
            )
            .join('')

    const html = `
      <p style="font-family:sans-serif;font-size:14px;color:#333;max-width:720px;">
        <b>Note:</b> Android signups and iOS downloads are separate, non-comparable metrics — don’t combine them into a conversion rate.
      </p>
      <h2 style="font-family:sans-serif;">Reddit / Email acquisition — last 14 days (UTC) — ${escapeHtml(today)}</h2>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
        <thead>
          <tr>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:left;">Day</th>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:left;">Channel</th>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:right;">Get redirects</th>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:right;">Android signups</th>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:right;">First rounds</th>
            <th style="padding:8px;border-bottom:2px solid #ccc;text-align:right;">iOS downloads (ASC)</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
      <p style="font-family:sans-serif;font-size:12px;color:#666;margin-top:16px;">
        Get redirects = sim-cap.com/get hits. Android signups / first rounds = per-user attribution.
        iOS downloads = App Store Connect Analytics campaign bucket (privacy threshold may suppress small days).
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
        subject: `SimCap Reddit/Email acquisition — ${today}`,
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
