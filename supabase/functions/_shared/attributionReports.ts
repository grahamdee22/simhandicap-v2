/**
 * Pure parsers for attribution sync jobs (no network, no Deno APIs).
 */

export type SourceDownloadRow = {
  date: string
  source_type: string
  source_info: string
  downloads: number
}

export type ProcessingBatch<T> = {
  processingDate: string
  rows: T[]
}

/**
 * Apple's daily instances overlap. A later processingDate replaces earlier rows
 * for the same key; rows from the same processingDate are combined.
 * Summing across processing dates double-counts.
 */
export function keepLatestProcessingDate<T extends { downloads: number }>(
  batches: ProcessingBatch<T>[],
  keyOf: (row: T) => string,
  combine: (base: T, extra: T) => void,
): T[] {
  const grouped = new Map<string, { processingDate: string; row: T }>()
  for (const batch of batches) {
    const processingDate = batch.processingDate || ''
    for (const row of batch.rows) {
      const key = keyOf(row)
      const prev = grouped.get(key)
      if (!prev || processingDate > prev.processingDate) {
        grouped.set(key, { processingDate, row: { ...row } })
      } else if (processingDate === prev.processingDate) {
        combine(prev.row, row)
      }
    }
  }
  return [...grouped.values()].map((entry) => entry.row)
}

export type AndroidStoreAcquisitionRow = {
  date: string
  package_name: string
  traffic_source: string
  search_term: string
  utm_source: string
  utm_campaign: string
  store_listing_acquisitions: number
  store_listing_visitors: number
  store_listing_conversion_rate: number | null
}

export type RedditAdsDailyRow = {
  date: string
  campaign_id: string
  impressions: number
  clicks: number
  spend_micros: number
  spend: number
  ctr: number | null
  cpc: number | null
}

function colIndex(header: string[], candidates: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase())
  for (const c of candidates) {
    const i = lower.indexOf(c.toLowerCase())
    if (i >= 0) return i
  }
  return -1
}

/** First-time downloads aggregated by date + source type + source info. */
export function parseFirstTimeDownloadsBySource(tsv: string): SourceDownloadRow[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const header = lines[0].split('\t')
  const iDate = colIndex(header, ['Date'])
  const iType = colIndex(header, ['Download Type'])
  const iSource = colIndex(header, ['Source Type'])
  const iInfo = colIndex(header, ['Source Info'])
  const iCounts = colIndex(header, ['Counts', 'Downloads', 'Total Downloads'])
  if (iDate < 0 || iType < 0 || iSource < 0 || iCounts < 0) {
    throw new Error(
      `Unexpected downloads TSV headers for source sync: ${header.slice(0, 16).join(' | ')}`,
    )
  }

  const map = new Map<string, SourceDownloadRow>()
  for (const line of lines.slice(1)) {
    const cols = line.split('\t')
    const downloadType = (cols[iType] ?? '').trim().toLowerCase()
    if (downloadType !== 'first-time download') continue
    const date = (cols[iDate] ?? '').trim()
    const sourceType = (cols[iSource] ?? '').trim() || 'Unavailable'
    const sourceInfo = iInfo >= 0 ? (cols[iInfo] ?? '').trim() : ''
    const downloads = Number.parseInt((cols[iCounts] ?? '0').replace(/,/g, ''), 10)
    if (!date || !Number.isFinite(downloads)) continue
    const key = `${date}\0${sourceType}\0${sourceInfo}`
    const prev = map.get(key)
    if (prev) prev.downloads += downloads
    else map.set(key, { date, source_type: sourceType, source_info: sourceInfo, downloads })
  }
  return [...map.values()]
}

/** Minimal RFC-style CSV (Play bulk reports quote cells that contain commas). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      if (row.some((c) => c.trim().length > 0)) rows.push(row)
      row = []
      cell = ''
      continue
    }
    cell += ch
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    if (row.some((c) => c.trim().length > 0)) rows.push(row)
  }
  return rows
}

export function parseStorePerformanceTrafficSource(csv: string): AndroidStoreAcquisitionRow[] {
  const table = parseCsv(csv)
  if (table.length < 2) return []
  const header = table[0]
  const iDate = colIndex(header, ['Date'])
  const iPkg = colIndex(header, ['Package name', 'Package Name'])
  const iTraffic = colIndex(header, ['Traffic source'])
  const iSearch = colIndex(header, ['Search term'])
  const iUtmSource = colIndex(header, ['UTM source'])
  const iUtmCampaign = colIndex(header, ['UTM campaign'])
  const iAcq = colIndex(header, ['Store listing acquisitions'])
  const iVis = colIndex(header, ['Store listing visitors'])
  const iCvr = colIndex(header, ['Store listing conversion rate'])
  if (iDate < 0 || iTraffic < 0 || iAcq < 0) {
    throw new Error(`Unexpected store_performance headers: ${header.join(' | ')}`)
  }

  const out: AndroidStoreAcquisitionRow[] = []
  for (const cols of table.slice(1)) {
    const date = (cols[iDate] ?? '').trim()
    const traffic = (cols[iTraffic] ?? '').trim()
    if (!date || !traffic) continue
    const acquisitions = Number.parseInt((cols[iAcq] ?? '0').replace(/,/g, ''), 10)
    const visitors = iVis >= 0 ? Number.parseInt((cols[iVis] ?? '0').replace(/,/g, ''), 10) : 0
    const cvrRaw = iCvr >= 0 ? Number.parseFloat(cols[iCvr] ?? '') : NaN
    if (!Number.isFinite(acquisitions)) continue
    out.push({
      date,
      package_name: iPkg >= 0 ? (cols[iPkg] ?? '').trim() : '',
      traffic_source: traffic,
      search_term: iSearch >= 0 ? (cols[iSearch] ?? '').trim() : '',
      utm_source: iUtmSource >= 0 ? (cols[iUtmSource] ?? '').trim() : '',
      utm_campaign: iUtmCampaign >= 0 ? (cols[iUtmCampaign] ?? '').trim() : '',
      store_listing_acquisitions: acquisitions,
      store_listing_visitors: Number.isFinite(visitors) ? visitors : 0,
      store_listing_conversion_rate: Number.isFinite(cvrRaw) ? cvrRaw : null,
    })
  }
  return out
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function pickMetric(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (key in obj) {
      const n = num(obj[key])
      if (n != null) return n
    }
  }
  const metrics = obj.metrics
  if (metrics && typeof metrics === 'object') {
    return pickMetric(metrics as Record<string, unknown>, keys)
  }
  return null
}

/**
 * Normalize a Reddit Ads v3 report payload into daily campaign rows.
 * Spend and CPC arrive in micro-units; this converts them to currency units.
 */
export function parseRedditAdsReport(payload: unknown): RedditAdsDailyRow[] {
  const root = payload as { data?: unknown; rows?: unknown } | unknown[] | null
  const rawRows = Array.isArray(root)
    ? root
    : Array.isArray((root as { data?: unknown })?.data)
      ? ((root as { data: unknown[] }).data)
      : Array.isArray((root as { rows?: unknown })?.rows)
        ? ((root as { rows: unknown[] }).rows)
        : Array.isArray((root as { data?: { metrics?: unknown[] } })?.data?.metrics)
          ? ((root as { data: { metrics: unknown[] } }).data.metrics)
          : []

  const map = new Map<string, RedditAdsDailyRow>()
  for (const item of rawRows) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const dateRaw = String(row.date ?? row.DATE ?? row.day ?? '').slice(0, 10)
    const campaignId = String(row.campaign_id ?? row.CAMPAIGN_ID ?? row.campaignId ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || !campaignId) continue
    const impressions = pickMetric(row, ['impressions', 'IMPRESSIONS']) ?? 0
    const clicks = pickMetric(row, ['clicks', 'CLICKS']) ?? 0
    const spendMicros = pickMetric(row, ['spend', 'SPEND']) ?? 0
    const ctr = pickMetric(row, ['ctr', 'CTR'])
    const cpcMicros = pickMetric(row, ['cpc', 'CPC'])
    const key = `${dateRaw}\0${campaignId}`
    map.set(key, {
      date: dateRaw,
      campaign_id: campaignId,
      impressions: Math.round(impressions),
      clicks: Math.round(clicks),
      spend_micros: Math.round(spendMicros),
      spend: spendMicros / 1_000_000,
      ctr,
      cpc: cpcMicros == null ? null : cpcMicros / 1_000_000,
    })
  }
  return [...map.values()]
}
