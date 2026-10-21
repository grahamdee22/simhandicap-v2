# email-daily-acquisition-report

Daily Resend email of Reddit + email channel acquisition (trailing 14 days).

## Schedule

pg_cron job **`email-daily-acquisition-report-daily`**: `0 11 * * *` (**11:00 UTC**), after
`sync-ios-campaign-downloads-daily` at 10:30 UTC.

## Secrets

Reuses existing project secrets (`RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
Recipient matches `daily-report`: `simcapadmin@gmail.com`.
