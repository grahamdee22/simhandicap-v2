# sync-ios-campaign-downloads

Scheduled edge function that upserts App Store Connect campaign download totals into
`public.ios_campaign_downloads`.

## Secrets (do not commit `.p8`)

Set on the Supabase project (same pattern as `RESEND_API_KEY` for `daily-report`):

| Secret | Value |
|--------|--------|
| `ASC_KEY_ID` | `QZ3R9GZRA5` |
| `ASC_ISSUER_ID` | `5cccbe20-952a-4b04-96bd-1adf776af074` |
| `ASC_PRIVATE_KEY` | Full PEM from `AuthKey_QZ3R9GZRA5.p8` (multiline or `\n`-escaped) |
| `ASC_APP_APPLE_ID` | Optional numeric App Store Connect app id; otherwise resolved via bundle `com.simcap.app` |

Also requires the usual `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.

Example (from a machine that has the `.p8`, never commit it):

```bash
supabase secrets set \
  ASC_KEY_ID=QZ3R9GZRA5 \
  ASC_ISSUER_ID=5cccbe20-952a-4b04-96bd-1adf776af074 \
  ASC_PRIVATE_KEY="$(cat /path/to/AuthKey_QZ3R9GZRA5.p8)"
```

## First-time ASC setup

1. An **Admin** must create an `ONGOING` analytics report request for the app once
   (Analytics → Reports, or `POST /v1/analyticsReportRequests`). The project’s
   **Sales and Reports** key cannot create this; the sync job treats a missing request as
   success with `upserted: 0` and a note until Admin completes this step.
2. After ~24–48h, daily **App Downloads Detailed** instances appear under COMMERCE.
3. Keys with **Sales and Reports** can then download those instances (this job’s path).
4. Apple may return **empty** Campaign cells when a campaign has fewer than ~5 first-time
   downloads, or when no App Analytics **Campaign Link** exists for that `ct=` token.
   Organic rows still appear (Source Type populated, Campaign blank). The sync skips blank
   Campaign rows and returns `ok: true` with `warning` + counters (`dataRows`,
   `skippedEmptyCampaign`, `downloadsSkippedEmptyCampaign`, `upserted`) so this is visible
   in edge logs / `net._http_response` instead of a silent `instances:N, upserted:0`.
5. Create Campaign Links in App Store Connect Analytics for each channel token you use
   (`reddit`, `homepage`, `email`, `kevin`, …) so `ct=` traffic can populate the Campaign
   column. Until that column is non-empty, `ios_campaign_downloads` will stay at 0 rows
   even though the job is downloading TSVs successfully.

## Schedule

`config.toml`: `30 10 * * *` (daily). Deploy with:

```bash
supabase functions deploy sync-ios-campaign-downloads
```

## Reporting

Query `public.channel_attribution_report`. The iOS column is deliberately named
`ios_downloads_asc_bucket_not_a_user_join` — it is **not** a per-user join to signups.

The same run upserts first-time downloads into `public.ios_downloads_by_source`
from **App Downloads Standard** (Source Type is on that report, and it is not
row-thresholded). Detailed reports omit slices under 5 users, which left the
table stuck on the one day that cleared the threshold. `source_info` stays `''`
because that column exists only on the detailed report.

Apple republishes overlapping dates on later `processingDate` instances. The job
keeps the latest processing date for each key instead of summing every instance.
