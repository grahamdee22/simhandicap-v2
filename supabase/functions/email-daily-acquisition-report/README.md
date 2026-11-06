# email-daily-acquisition-report

Daily Resend email of combined Reddit + email outreach (trailing 14 days).
iOS downloads are the app-wide first-time total from `ios_downloads_by_source`.
Android downloads are app-wide install-referrer events (`is_duplicate = false`), not outreach-attributed.
Total downloads sums the two.

## Schedule

pg_cron on this project is UTC-only (`cron.schedule` has no timezone argument).

| Job | Cron | Pacific |
| --- | --- | --- |
| `email-daily-acquisition-report-daily` | `0 18 * * *` | 10:00am PST |

During PDT that same UTC time is 11:00am Pacific. On March 14, 2027 move it to `0 17 * * *` to stay at 10:00am, then back to `0 18 * * *` the following November. The iOS column still refreshes at the 10:30 UTC sync (2:30am PST), before this mail.

## Secrets

Reuses existing project secrets (`RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
Recipient matches `daily-report`: `simcapadmin@gmail.com`.
