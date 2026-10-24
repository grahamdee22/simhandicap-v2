# reset-facility-demo

Wipe + reseed the facility pitch demo account (`demo@seed.simcap.test`) and companion
crew members. Used for facility sales demos — not shipped in the app bundle.

## Auth

Either:

1. **Manual:** header `x-facility-demo-reset-secret` matching project secret `FACILITY_DEMO_RESET_SECRET`
2. **Cron:** `Authorization: Bearer <service_role>` (same vault pattern as other scheduled jobs)

Demo login credentials alone cannot reset.

## Schedule

pg_cron job **`reset-facility-demo-nightly`**: `0 7 * * *` (**07:00 UTC**), before US
business hours.

## Secrets

```bash
supabase secrets set FACILITY_DEMO_RESET_SECRET='…'
```

## Manual reset

Gateway still needs an `Authorization` / `apikey` header (anon or service role). The
demo secret is what authorizes the reset itself — do not put the service role in a
shared note if you can avoid it.

```bash
curl -sS -X POST \
  "$SUPABASE_URL/functions/v1/reset-facility-demo" \
  -H "Authorization: Bearer $EXPO_PUBLIC_SUPABASE_ANON_KEY" \
  -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY" \
  -H "x-facility-demo-reset-secret: $FACILITY_DEMO_RESET_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Or: `node scripts/reset-facility-demo.js` (reads `.env`).

## Seed contents

- Demo user + 7 companions (8 players total; `is_test=true`, not app admins)
- ~20 personal rounds with snapshotted diffs / `simcap_index_at_time`
- Crew **SimCap Crew**, season **2026 Open Season**
- Completed: **Spring Open** (stroke), **Clubhouse Scramble**, **Fairway Best Ball**,
  **Bracket Championship** (match play, 8-player bracket)
- Active/open: **Midsummer Cup** (stroke)
