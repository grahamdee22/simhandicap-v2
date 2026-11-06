# sync-reddit-ads

Pulls `POST /api/v3/ad_accounts/{REDDIT_ADS_ACCOUNT_ID}/reports` for the last 2 UTC days plus today and upserts `public.reddit_ads_daily`. Spend and CPC are stored in currency units (API micro-units / 1,000,000). `spend_micros` keeps the raw value.

**Scheduled.** pg_cron job `sync-reddit-ads-daily` at 10:45 UTC.

## Secrets

| Name | Format |
| --- | --- |
| `REDDIT_ADS_CLIENT_ID` | Developer app id |
| `REDDIT_ADS_CLIENT_SECRET` | Developer app secret |
| `REDDIT_ADS_REFRESH_TOKEN` | Refresh token from an OAuth grant with scope `adsread` and `duration=permanent` |
| `REDDIT_ADS_ACCOUNT_ID` | Ad account id only (not a URL) |

```bash
supabase secrets set \
  REDDIT_ADS_CLIENT_ID='…' \
  REDDIT_ADS_CLIENT_SECRET='…' \
  REDDIT_ADS_REFRESH_TOKEN='…' \
  REDDIT_ADS_ACCOUNT_ID='…'
```
