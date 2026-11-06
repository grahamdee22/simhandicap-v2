/**
 * One-time Reddit Ads OAuth callback.
 *
 * Reddit redirects the browser here after Allow. This function exchanges the
 * code for tokens using REDDIT_ADS_CLIENT_ID / REDDIT_ADS_CLIENT_SECRET and
 * shows the refresh token so it can be saved as REDDIT_ADS_REFRESH_TOKEN.
 *
 * Public (verify_jwt = false). Redirect URI registered on the developer app
 * must be exactly REDDIT_OAUTH_CALLBACK_URL.
 */

const USER_AGENT = 'simcap-ads-sync/1.0'
const CALLBACK_URL =
  'https://alwsdzvqvwxvmzcyfvra.supabase.co/functions/v1/reddit-oauth-callback'

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 40px auto; max-width: 640px; padding: 0 16px; color: #1a1a1a; }
    h1 { font-size: 22px; }
    code, textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
    textarea { width: 100%; min-height: 88px; }
    p { line-height: 1.45; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${body}
</body>
</html>`
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (url.searchParams.get('error')) {
    return page(
      'Reddit authorization was not completed',
      `<p>${esc(url.searchParams.get('error_description') || url.searchParams.get('error') || 'denied')}</p>`,
      400,
    )
  }

  const code = url.searchParams.get('code')?.trim()
  if (!code) {
    return page(
      'Reddit Ads callback is ready',
      `<p>This address is the redirect URI. Open the Reddit authorize link and click Allow. Nothing to copy on this page until then.</p>`,
    )
  }

  const clientId = Deno.env.get('REDDIT_ADS_CLIENT_ID')?.trim()
  const clientSecret = Deno.env.get('REDDIT_ADS_CLIENT_SECRET')?.trim()
  if (!clientId || !clientSecret) {
    return page(
      'Reddit secrets are not set yet',
      `<p>Set <code>REDDIT_ADS_CLIENT_ID</code> and <code>REDDIT_ADS_CLIENT_SECRET</code> on the Supabase project, then click Allow again. The code in this URL can only be used once, so start a new authorize visit after the secrets are saved.</p>`,
      500,
    )
  }

  const redirectUri = Deno.env.get('REDDIT_ADS_REDIRECT_URI')?.trim() || CALLBACK_URL
  const basic = btoa(`${clientId}:${clientSecret}`)
  const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })
  const raw = await tokenRes.text()
  if (!tokenRes.ok) {
    console.error('[reddit-oauth-callback]', tokenRes.status, raw.slice(0, 500))
    return page(
      'Reddit token exchange failed',
      `<p>Reddit returned ${tokenRes.status}.</p><pre>${esc(raw.slice(0, 800))}</pre>`,
      502,
    )
  }

  let parsed: { refresh_token?: string; access_token?: string; scope?: string; expires_in?: number }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return page('Reddit token exchange failed', `<pre>${esc(raw.slice(0, 800))}</pre>`, 502)
  }
  if (!parsed.refresh_token) {
    return page(
      'No refresh token came back',
      `<p>The authorize URL needs <code>duration=permanent</code>. Response:</p><pre>${esc(raw.slice(0, 800))}</pre>`,
      502,
    )
  }

  console.log('[reddit-oauth-callback] refresh token issued', {
    scope: parsed.scope ?? null,
    expires_in: parsed.expires_in ?? null,
  })

  return page(
    'Reddit Ads connected',
    `<p>Copy this refresh token into the Supabase secret <code>REDDIT_ADS_REFRESH_TOKEN</code>. This is the only copy step. The authorization code was exchanged on the server.</p>
<textarea readonly>${esc(parsed.refresh_token)}</textarea>
<p>Scope: ${esc(parsed.scope || 'unknown')}</p>`,
  )
})
