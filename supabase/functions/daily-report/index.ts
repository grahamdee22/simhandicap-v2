import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

/** Exclude rows whose user/creator is a test profile (`profiles.is_test = true`). */
function excludeTestUserIds<T extends { not: (column: string, operator: string, value: string) => T }>(
  query: T,
  column: string,
  testIds: string[],
): T {
  if (testIds.length === 0) return query
  return query.not(column, 'in', `(${testIds.join(',')})`)
}

Deno.serve(async () => {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

  const since24h = new Date(Date.now() - 86400000).toISOString()
  const since7d = new Date(Date.now() - 604800000).toISOString()

  const { data: testProfiles } = await supabase
    .from('profiles')
    .select('id')
    .eq('is_test', true)
  const testIds = (testProfiles ?? []).map((p: { id: string }) => p.id)

  const [
    { count: totalUsers },
    { count: newSignups },
    { count: totalRounds },
    { count: rounds24h },
    { count: activeUsers7d },
    { count: totalGroups },
    { count: newGroups24h },
  ] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('is_test', false),
    supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('is_test', false)
      .gte('updated_at', since24h),
    excludeTestUserIds(
      supabase.from('rounds').select('*', { count: 'exact', head: true }).eq('is_active', true),
      'user_id',
      testIds,
    ),
    excludeTestUserIds(
      supabase
        .from('rounds')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)
        .gte('created_at', since24h),
      'user_id',
      testIds,
    ),
    excludeTestUserIds(
      supabase
        .from('rounds')
        .select('user_id', { count: 'exact', head: true })
        .eq('is_active', true)
        .gte('created_at', since7d),
      'user_id',
      testIds,
    ),
    // social_groups.created_by = profiles.id (both reference auth.users)
    excludeTestUserIds(
      supabase.from('social_groups').select('*', { count: 'exact', head: true }).eq('is_active', true),
      'created_by',
      testIds,
    ),
    excludeTestUserIds(
      supabase
        .from('social_groups')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', since24h),
      'created_by',
      testIds,
    ),
  ])

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  const html = `
    <h2>SimCap Daily Report — ${today}</h2>
    <table style="border-collapse:collapse;font-family:sans-serif;">
      <tr><td style="padding:8px;border-bottom:1px solid #eee;"><b>Total Users</b></td><td style="padding:8px;border-bottom:1px solid #eee;">${totalUsers}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee;">New Signups (24h)</td><td style="padding:8px;border-bottom:1px solid #eee;">${newSignups}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee;"><b>Total Rounds</b></td><td style="padding:8px;border-bottom:1px solid #eee;">${totalRounds}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee;">Rounds Logged (24h)</td><td style="padding:8px;border-bottom:1px solid #eee;">${rounds24h}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee;">Active Users (7d)</td><td style="padding:8px;border-bottom:1px solid #eee;">${activeUsers7d}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee;"><b>Total Groups</b></td><td style="padding:8px;border-bottom:1px solid #eee;">${totalGroups}</td></tr>
      <tr><td style="padding:8px;">New Groups (24h)</td><td style="padding:8px;">${newGroups24h}</td></tr>
    </table>
  `

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'SimCap <onboarding@resend.dev>',
      to: 'simcapadmin@gmail.com',
      subject: `SimCap Daily Report — ${today}`,
      html,
    }),
  })

  return new Response('OK', { status: 200 })
})
