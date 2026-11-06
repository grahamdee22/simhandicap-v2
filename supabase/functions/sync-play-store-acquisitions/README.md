# sync-play-store-acquisitions

Reads Play Console bulk CSVs:

`stats/store_performance/store_performance_com.simcap.app_YYYYMM_traffic_source.csv`

and upserts `public.android_store_acquisitions`. Current and previous UTC months only.

**Not scheduled.** A manual invoke before secrets exist returns `{ ok: true, skipped: true }`.

## Secrets

| Name | Format |
| --- | --- |
| `PLAY_REPORTS_BUCKET` | Bucket id only, no `gs://`. Example: `pubsite_prod_rev_0123456789` |
| `PLAY_SERVICE_ACCOUNT_JSON` | Entire service-account key file contents (the JSON with `client_email` and `private_key`) |

```bash
supabase secrets set \
  PLAY_REPORTS_BUCKET='pubsite_prod_rev_…' \
  PLAY_SERVICE_ACCOUNT_JSON="$(cat play-reports-sa.json)"
```

Play Console: invite that service account with account-level **View app information and download bulk reports (read-only)**.
