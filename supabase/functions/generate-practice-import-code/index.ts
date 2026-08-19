import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';

const CODE_TTL_MS = 10 * 60 * 1000;
const GENERATE_LIMIT = 8;
const GENERATE_WINDOW_MS = 60 * 60 * 1000;

function randomSixDigit(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, '0');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return jsonResponse({ success: false, error: 'Server is not configured' }, 500);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) {
      return jsonResponse({ success: false, error: 'Not signed in' }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const windowStart = new Date(Date.now() - GENERATE_WINDOW_MS).toISOString();
    const { count, error: countErr } = await admin
      .from('practice_import_rate_events')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'generate')
      .eq('user_id', user.id)
      .gte('created_at', windowStart);
    if (countErr) {
      console.error('[generate-practice-import-code] rate count', countErr);
      return jsonResponse({ success: false, error: 'Could not generate a code' }, 500);
    }
    if ((count ?? 0) >= GENERATE_LIMIT) {
      return jsonResponse({
        success: false,
        error: 'Too many import codes in the last hour. Try again later.',
      }, 429);
    }

    await admin.from('practice_import_rate_events').insert({
      kind: 'generate',
      user_id: user.id,
    });

    await admin
      .from('practice_import_codes')
      .update({ status: 'expired' })
      .eq('user_id', user.id)
      .eq('status', 'pending');

    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
    let inserted: { id: string; code: string; expires_at: string } | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = randomSixDigit();
      const { data, error } = await admin
        .from('practice_import_codes')
        .insert({
          code,
          user_id: user.id,
          expires_at: expiresAt,
          status: 'pending',
        })
        .select('id, code, expires_at')
        .single();
      if (!error && data) {
        inserted = data as { id: string; code: string; expires_at: string };
        break;
      }
      if (error && !/duplicate|unique/i.test(error.message)) {
        console.error('[generate-practice-import-code] insert', error);
        return jsonResponse({ success: false, error: 'Could not generate a code' }, 500);
      }
    }

    if (!inserted) {
      return jsonResponse({ success: false, error: 'Could not generate a unique code' }, 500);
    }

    return jsonResponse({
      success: true,
      code: inserted.code,
      code_id: inserted.id,
      expires_at: inserted.expires_at,
    });
  } catch (e) {
    console.error('[generate-practice-import-code]', e);
    return jsonResponse({
      success: false,
      error: e instanceof Error ? e.message : 'Could not generate a code',
    }, 500);
  }
});
