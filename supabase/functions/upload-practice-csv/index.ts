import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import {
  applyClubTakeaways,
  coachingPayload,
  parsePracticeCsv,
  type ParsedPracticeSession,
} from '../_shared/practiceCsv.ts';

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const BUCKET = 'practice-analysis-csvs';
const MAX_CSV_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_CSV_BYTES + 256 * 1024;
const UPLOAD_LIMIT = 20;
const UPLOAD_WINDOW_MS = 15 * 60 * 1000;

const COACHING_PROMPT = `You are a golf coach reviewing a simulator practice session.
The data is already parsed from a CSV (not a photo). Do not invent numbers. Only comment on metrics that are present.

Rules:
- Ignore DistanceToPin. It is not a real pin distance in driving-range mode.
- Columns listed in excluded_columns were 0 on 90% or more of shots (launch monitor not measuring them). Ignore those metrics entirely, including any stray non-zero cells. Do not mention them as zeros or as a real AoA/lie/loft reading.
- GSPro lateral signs (golfer facing the target). Do not reverse:
  - HLA: negative = launched left of the target line, positive = launched right. (GSPro Data Tiles / Users Guide.)
  - Offline: negative = landed left of the aim point, positive = landed right. Same axis as HLA.
  If a takeaway needs left/right, use only HLA and Offline with that convention. Do not assign left/right to Path, FaceToTarget, or FaceToPath.
- For each club with qualifies_for_takeaway=true, write ONE short takeaway (1–2 sentences) about THIS session: consistency/dispersion (carry and offline stdev), start line, spin, or efficiency.
- Do NOT write a takeaway for a club where qualifies_for_takeaway is false. Those clubs do not have enough shots (need 3+).
- session_summary: 2–3 sentences on the whole session. If no club qualifies, say there was not enough of any one club for coaching.
- tips: 2–3 concrete next-session actions.
- Never mention handicap, index, or scoring. This is coaching only.

Return ONLY valid JSON (no markdown) with this shape:
{
  "session_summary": string,
  "club_takeaways": [ { "club": string, "takeaway": string } ],
  "tips": string[]
}`;

type CoachingJson = {
  session_summary?: unknown;
  club_takeaways?: unknown;
  tips?: unknown;
};

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown';
}

async function hashIp(ip: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${secret}:${ip}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function asStringArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = asTrimmedString(item);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function parseAiJson(text: string): CoachingJson | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as CoachingJson;
  } catch {
    return null;
  }
}

function parseClubTakeaways(raw: unknown): Array<{ club: string; takeaway: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ club: string; takeaway: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const club = asTrimmedString(o.club);
    const takeaway = asTrimmedString(o.takeaway) ?? asTrimmedString(o.text);
    if (club && takeaway) out.push({ club, takeaway });
  }
  return out;
}

function looksLikeCsvFilename(name: string): boolean {
  return /\.csv$/i.test(name.trim());
}

function fallbackCoaching(session: ParsedPracticeSession): {
  session_notes: string;
  tips: string[];
} {
  const clubBits = session.clubs.map((c) => `${c.club_label} (${c.shot_count})`).join(', ');
  return {
    session_notes: `${session.shots.length} shots across ${session.clubs.length} club${session.clubs.length === 1 ? '' : 's'}: ${clubBits}. Stats are from the CSV; coaching text was not generated this time.`,
    tips: ['Hit at least 3 shots with a club you want a takeaway on next session.'],
  };
}

async function coachSession(
  anthropicKey: string,
  session: ParsedPracticeSession
): Promise<{ session_notes: string; tips: string[]; session: ParsedPracticeSession }> {
  const fallback = fallbackCoaching(session);
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1200,
        messages: [
          {
            role: 'user',
            content: `${COACHING_PROMPT}\n\nSESSION DATA:\n${JSON.stringify(coachingPayload(session))}`,
          },
        ],
      }),
    });
    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[upload-practice-csv] anthropic', anthropicRes.status, errText);
      return { session_notes: fallback.session_notes, tips: fallback.tips, session };
    }
    const anthropicJson = await anthropicRes.json();
    const textBlock = anthropicJson?.content?.find((b: { type?: string }) => b.type === 'text');
    const rawText = typeof textBlock?.text === 'string' ? textBlock.text : '';
    const extracted = parseAiJson(rawText);
    if (!extracted) {
      return { session_notes: fallback.session_notes, tips: fallback.tips, session };
    }
    const notes = asTrimmedString(extracted.session_summary) ?? fallback.session_notes;
    const tips = asStringArray(extracted.tips, 5);
    const withTakeaways = applyClubTakeaways(session, parseClubTakeaways(extracted.club_takeaways));
    return {
      session_notes: notes,
      tips: tips.length > 0 ? tips : fallback.tips,
      session: withTakeaways,
    };
  } catch (e) {
    console.error('[upload-practice-csv] coach', e);
    return { session_notes: fallback.session_notes, tips: fallback.tips, session };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return optionsResponse();
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  try {
    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ success: false, error: 'File is too large. Max size is 4 MB.' }, 413);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ success: false, error: 'Server is not configured' }, 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const ip = clientIp(req);
    const ipHash = await hashIp(ip, serviceRoleKey);
    const windowStart = new Date(Date.now() - UPLOAD_WINDOW_MS).toISOString();
    const { count, error: countErr } = await admin
      .from('practice_import_rate_events')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'upload')
      .eq('ip_hash', ipHash)
      .gte('created_at', windowStart);
    if (countErr) {
      console.error('[upload-practice-csv] rate count', countErr);
      return jsonResponse({ success: false, error: 'Upload failed' }, 500);
    }
    if ((count ?? 0) >= UPLOAD_LIMIT) {
      return jsonResponse({
        success: false,
        error: 'Too many upload attempts. Wait a few minutes and try again.',
      }, 429);
    }

    await admin.from('practice_import_rate_events').insert({
      kind: 'upload',
      ip_hash: ipHash,
    });

    const form = await req.formData();
    const codeRaw = String(form.get('code') ?? '').replace(/\s+/g, '');
    const file = form.get('file');

    if (!/^\d{6}$/.test(codeRaw)) {
      return jsonResponse({ success: false, error: 'Enter the 6-digit code from the SimCap app.' }, 400);
    }
    if (!(file instanceof File)) {
      return jsonResponse({ success: false, error: 'Choose a CSV file to upload.' }, 400);
    }
    if (file.size > MAX_CSV_BYTES) {
      return jsonResponse({ success: false, error: 'File is too large. Max size is 4 MB.' }, 413);
    }
    if (!looksLikeCsvFilename(file.name) && !/csv|excel|plain/i.test(file.type || '')) {
      return jsonResponse({ success: false, error: 'Upload a .csv file exported from GSPro.' }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_CSV_BYTES) {
      return jsonResponse({ success: false, error: 'File is too large. Max size is 4 MB.' }, 413);
    }
    if (bytes.includes(0)) {
      return jsonResponse({ success: false, error: 'That file is not a valid CSV.' }, 400);
    }

    const csvText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const parsed = parsePracticeCsv(csvText, file.name);
    if (!parsed.ok) {
      return jsonResponse({ success: false, error: parsed.error }, 422);
    }

    const { data: consumed, error: consumeErr } = await admin.rpc('consume_practice_import_code', {
      p_code: codeRaw,
    });
    if (consumeErr) {
      console.error('[upload-practice-csv] consume', consumeErr);
      return jsonResponse({ success: false, error: 'Could not validate that code.' }, 500);
    }
    const consumedRow = Array.isArray(consumed) ? consumed[0] : consumed;
    if (!consumedRow?.user_id || !consumedRow?.id) {
      const { data: existing } = await admin
        .from('practice_import_codes')
        .select('status, expires_at')
        .eq('code', codeRaw)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing?.status === 'consumed') {
        return jsonResponse({ success: false, error: 'That code was already used.' }, 410);
      }
      if (existing && (existing.status === 'expired' || new Date(existing.expires_at as string).getTime() <= Date.now())) {
        if (existing.status === 'pending') {
          await admin.from('practice_import_codes').update({ status: 'expired' }).eq('code', codeRaw).eq('status', 'pending');
        }
        return jsonResponse({ success: false, error: 'That code has expired. Generate a new one in the app.' }, 410);
      }
      return jsonResponse({ success: false, error: 'That code is invalid or expired.' }, 400);
    }

    const userId = consumedRow.user_id as string;
    const codeId = consumedRow.id as string;
    const analysisId = crypto.randomUUID();
    const csvPath = `${userId}/${analysisId}.csv`;

    const { error: upErr } = await admin.storage.from(BUCKET).upload(csvPath, bytes, {
      upsert: false,
      contentType: 'text/csv',
    });
    if (upErr) {
      console.error('[upload-practice-csv] storage', upErr);
      return jsonResponse({ success: false, error: 'Could not store that file.' }, 500);
    }

    const { error: insertErr } = await admin.from('practice_analyses').insert({
      id: analysisId,
      user_id: userId,
      source: 'csv',
      csv_path: csvPath,
      image_path: null,
      platform: parsed.session.platform,
      detected_system: parsed.session.platform_label,
      original_filename: file.name,
      session_played_at: parsed.session.session_played_at,
      status: 'processing',
      extracted_stats: parsed.session,
      takeaways: [],
      tips: [],
    });
    if (insertErr) {
      console.error('[upload-practice-csv] insert', insertErr);
      await admin.storage.from(BUCKET).remove([csvPath]);
      return jsonResponse({ success: false, error: 'Could not save that session.' }, 500);
    }

    await admin
      .from('practice_import_codes')
      .update({ analysis_id: analysisId })
      .eq('id', codeId);

    const coached = anthropicKey
      ? await coachSession(anthropicKey, parsed.session)
      : { session_notes: fallbackCoaching(parsed.session).session_notes, tips: fallbackCoaching(parsed.session).tips, session: parsed.session };

    const clubTakeaways = coached.session.clubs
      .map((c) => c.takeaway)
      .filter((t): t is string => typeof t === 'string' && t.length > 0);

    const { error: updateErr } = await admin
      .from('practice_analyses')
      .update({
        status: 'ready',
        session_notes: coached.session_notes,
        extracted_stats: coached.session,
        takeaways: clubTakeaways,
        tips: coached.tips,
        error_message: null,
      })
      .eq('id', analysisId);

    if (updateErr) {
      console.error('[upload-practice-csv] update', updateErr);
      await admin
        .from('practice_analyses')
        .update({
          status: 'failed',
          error_message: 'Saved the CSV but could not finish analysis.',
        })
        .eq('id', analysisId);
      return jsonResponse({ success: false, error: 'Saved the file but analysis failed. Try a new code.' }, 500);
    }

    return jsonResponse({
      success: true,
      analysis_id: analysisId,
    });
  } catch (e) {
    console.error('[upload-practice-csv]', e);
    return jsonResponse({
      success: false,
      error: e instanceof Error ? e.message : 'Upload failed',
    }, 500);
  }
});
