/** PakGolf Master Course List HTML/markdown parsers (mirror of scripts/import-gspro-courses.ts). */

export type ParsedRow = {
  name: string
  difficulty: number | null
  location: string | null
  designer: string | null
}

function parseDifficulty(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&apos;/g, "'")
}

function stripHtmlTags(fragment: string): string {
  return fragment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function cellText(htmlFragment: string): string {
  return decodeHtmlEntities(stripHtmlTags(htmlFragment))
}

export function parsePakGolfHtml(html: string): ParsedRow[] {
  const tableMatch = html.match(/<table[^>]*\bid=["']table_1["'][^>]*>([\s\S]*?)<\/table>/i)
  if (!tableMatch) return []

  const rows: ParsedRow[] = []
  for (const tr of tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]))
    if (cells.length < 7) continue
    const name = cells[0]?.trim()
    if (!name || name.toLowerCase() === 'name') continue
    rows.push({
      name,
      difficulty: parseDifficulty(cells[1] ?? ''),
      location: cells[5]?.trim() || null,
      designer: cells[6]?.trim() || null,
    })
  }
  return rows
}

export function parsePakGolfMarkdown(html: string): ParsedRow[] {
  const rows: ParsedRow[] = []
  for (const line of html.split('\n')) {
    if (!line.startsWith('| ') || line.includes('---') || line.includes('Name | Difficulty')) continue
    const parts = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((p) => p.trim())
    if (parts.length < 7) continue
    const name = parts[0]
    if (!name) continue
    rows.push({
      name,
      difficulty: parseDifficulty(parts[1]),
      location: parts[5] || null,
      designer: parts[6] || null,
    })
  }
  return rows
}

export function parsePakGolfCourseList(html: string): ParsedRow[] {
  const fromHtml = parsePakGolfHtml(html)
  if (fromHtml.length > 0) return fromHtml
  return parsePakGolfMarkdown(html)
}
