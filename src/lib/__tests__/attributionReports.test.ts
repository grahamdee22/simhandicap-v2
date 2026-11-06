import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  keepLatestProcessingDate,
  parseFirstTimeDownloadsBySource,
  parseRedditAdsReport,
  parseStorePerformanceTrafficSource,
} from '../../../supabase/functions/_shared/attributionReports.ts'

describe('iOS first-time downloads by source', () => {
  it('keeps first-time rows with a blank campaign and sums source info', () => {
    const tsv = [
      'Date\tDownload Type\tSource Type\tSource Info\tCampaign\tCounts',
      '2026-11-01\tFirst-time download\tApp Store search\t\t\t10',
      '2026-11-01\tFirst-time download\tApp referrer\t\t\t20',
      '2026-11-01\tFirst-time download\tApp referrer\tMessages\t\t12',
      '2026-11-01\tRedownload\tApp Store search\t\t\t99',
      '2026-11-01\tFirst-time download\tApp Store search\t\treddit\t3',
    ].join('\n')
    const rows = parseFirstTimeDownloadsBySource(tsv)
    const search = rows.find((r) => r.source_type === 'App Store search')
    assert.equal(search?.downloads, 13)
    const named = rows.find((r) => r.source_info === 'Messages')
    assert.equal(named?.downloads, 12)
    const blankReferrer = rows.find((r) => r.source_type === 'App referrer' && r.source_info === '')
    assert.equal(blankReferrer?.downloads, 20)
    assert.equal(rows.some((r) => r.downloads === 99), false)
  })

  it('keeps the latest Apple processing date and sums rows from that instance only', () => {
    const rows = keepLatestProcessingDate(
      [
        {
          processingDate: '2026-11-01',
          rows: [
            { date: '2026-10-30', source_type: 'App Store search', source_info: '', downloads: 10 },
            { date: '2026-10-30', source_type: 'App Store search', source_info: '', downloads: 2 },
          ],
        },
        {
          processingDate: '2026-11-02',
          rows: [
            { date: '2026-10-30', source_type: 'App Store search', source_info: '', downloads: 14 },
            { date: '2026-10-31', source_type: 'App Store browse', source_info: '', downloads: 6 },
          ],
        },
      ],
      (row) => `${row.date}\0${row.source_type}\0${row.source_info}`,
      (base, extra) => {
        base.downloads += extra.downloads
      },
    )
    const search = rows.find((row) => row.date === '2026-10-30')
    assert.equal(search?.downloads, 14)
    assert.equal(rows.find((row) => row.date === '2026-10-31')?.downloads, 6)
  })
})

describe('Play store performance traffic source', () => {
  it('reads traffic source and UTM columns', () => {
    const csv = [
      'Date,Package name,Traffic source,Search term,UTM source,UTM campaign,Store listing acquisitions,Store listing visitors,Store listing conversion rate',
      '2026-11-01,com.simcap.app,Third-party referrals,,reddit,fall,4,20,0.2',
      '2026-11-01,com.simcap.app,Google Play search,golf sim,,,8,40,0.2',
    ].join('\n')
    const rows = parseStorePerformanceTrafficSource(csv)
    assert.equal(rows.length, 2)
    assert.equal(rows[0].utm_source, 'reddit')
    assert.equal(rows[0].store_listing_acquisitions, 4)
    assert.equal(rows[1].traffic_source, 'Google Play search')
    assert.equal(rows[1].search_term, 'golf sim')
  })
})

describe('Reddit ads report', () => {
  it('converts spend and CPC from micro-units', () => {
    const rows = parseRedditAdsReport({
      data: [
        {
          date: '2026-11-01',
          campaign_id: 'cmp_1',
          impressions: 1000,
          clicks: 25,
          spend: 2_500_000,
          ctr: 0.025,
          cpc: 100_000,
        },
      ],
    })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].spend, 2.5)
    assert.equal(rows[0].cpc, 0.1)
    assert.equal(rows[0].spend_micros, 2_500_000)
    assert.equal(rows[0].impressions, 1000)
  })
})
