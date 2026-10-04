import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const ACTIVE_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE',
]);

type RcEvent = {
  type?: string;
  app_user_id?: string;
  entitlement_ids?: string[] | null;
  product_id?: string | null;
  store?: string | null;
  period_type?: string | null;
  will_renew?: boolean | null;
  expiration_at_ms?: number | null;
  purchased_at_ms?: number | null;
  [key: string]: unknown;
};

type RcWebhookBody = {
  api_version?: string;
  event?: RcEvent;
};

function expiresAtIso(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }

  const expected = Deno.env.get('REVENUECAT_WEBHOOK_AUTH_HEADER') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!expected || authHeader !== expected) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let body: RcWebhookBody;
    try {
      body = (await req.json()) as RcWebhookBody;
    } catch {
      console.warn('[revenuecat-webhook] invalid JSON body');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const event = body.event;
    if (!event || typeof event !== 'object') {
      console.warn('[revenuecat-webhook] missing event');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const eventType = typeof event.type === 'string' ? event.type : '';
    const userId = typeof event.app_user_id === 'string' ? event.app_user_id.trim() : '';

    if (!ACTIVE_EVENT_TYPES.has(eventType) && eventType !== 'EXPIRATION' && eventType !== 'CANCELLATION') {
      console.log('[revenuecat-webhook] unrecognized event type', eventType || '(empty)');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!userId) {
      console.warn('[revenuecat-webhook] missing app_user_id', eventType);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const entitlementIds =
      Array.isArray(event.entitlement_ids) && event.entitlement_ids.length > 0
        ? event.entitlement_ids.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
        : ['pro'];

    if (entitlementIds.length === 0) {
      entitlementIds.push('pro');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[revenuecat-webhook] missing Supabase env');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const nowIso = new Date().toISOString();
    const productId = typeof event.product_id === 'string' ? event.product_id : null;
    const store = typeof event.store === 'string' ? event.store : null;
    const periodType = typeof event.period_type === 'string' ? event.period_type : null;
    const expiresAt = expiresAtIso(event.expiration_at_ms);

    let willRenew: boolean | null =
      typeof event.will_renew === 'boolean' ? event.will_renew : null;
    if (eventType === 'CANCELLATION' || eventType === 'EXPIRATION') {
      willRenew = false;
    } else if (willRenew == null && ACTIVE_EVENT_TYPES.has(eventType)) {
      willRenew = true;
    }

    try {
      for (const entitlementId of entitlementIds) {
        const row: Record<string, unknown> = {
          user_id: userId,
          entitlement_id: entitlementId,
          product_id: productId,
          store,
          period_type: periodType,
          will_renew: willRenew,
          expires_at: expiresAt,
          last_event_type: eventType,
          last_event_at: nowIso,
          raw_event: event,
          updated_at: nowIso,
        };

        if (ACTIVE_EVENT_TYPES.has(eventType)) {
          row.is_active = true;
        } else if (eventType === 'EXPIRATION') {
          row.is_active = false;
        }
        // CANCELLATION: leave is_active unchanged (omit from upsert conflict update of is_active)
        // Use select-then-update for cancellation so we don't flip is_active.

        if (eventType === 'CANCELLATION') {
          const { data: existing, error: selErr } = await admin
            .from('subscription_entitlements')
            .select('id')
            .eq('user_id', userId)
            .eq('entitlement_id', entitlementId)
            .maybeSingle();
          if (selErr) throw selErr;
          if (existing?.id) {
            const { error: updErr } = await admin
              .from('subscription_entitlements')
              .update({
                product_id: productId,
                store,
                period_type: periodType,
                will_renew: willRenew,
                expires_at: expiresAt,
                last_event_type: eventType,
                last_event_at: nowIso,
                raw_event: event,
                updated_at: nowIso,
              })
              .eq('id', existing.id);
            if (updErr) throw updErr;
          } else {
            const { error: insErr } = await admin.from('subscription_entitlements').insert({
              ...row,
              is_active: false,
            });
            if (insErr) throw insErr;
          }
        } else {
          const { error: upsertErr } = await admin.from('subscription_entitlements').upsert(row, {
            onConflict: 'user_id,entitlement_id',
          });
          if (upsertErr) throw upsertErr;
        }
      }
    } catch (writeErr) {
      console.error('[revenuecat-webhook] write failed', writeErr);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[revenuecat-webhook] unhandled', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
