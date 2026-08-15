import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/http.ts';

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const BUCKET = 'practice-analysis-images';

const EXTRACT_PROMPT = `You are analyzing a photo of a golf simulator practice / driving-range stats screen.
Layouts vary widely (GSPro, TrackMan, Uneekor, Foresight, Full Swing, E6, Garmin, and others). Do NOT assume a fixed layout or brand.

Extract whatever launch-monitor / ball-flight stats are actually readable in the image. Common fields include (when shown): ball speed, club speed, smash factor, carry distance, total distance, back spin, side spin, spin axis, launch angle, launch direction / azimuth, side direction, apex height, landing angle, curve / face-to-path / face angle, and club face data.

Then write plain-language coaching:
- A few takeaways about patterns in THIS session (dispersion / consistency, smash-factor efficiency, spin outliers, distance gapping between shots or clubs). Only comment on what the numbers support.
- 2–3 concrete tips for their next range session or round (sim or outdoors).

Rules:
- Preserve visible labels and units when possible. Do not invent numbers that are not on screen.
- If a value is unreadable, omit it (do not guess).
- If there is too little data for a conclusion, say so briefly in a takeaway instead of fabricating patterns.
- Be flexible: summary averages OR per-shot tables are both fine; include whichever the screen shows.
- Return ONLY valid JSON (no markdown fences, no preamble) with this shape:
{
  "detected_system": string | null,
  "session_notes": string | null,
  "extracted_stats": {
    "summary": [ { "label": string, "value": string, "unit": string | null } ],
    "shots": [
      {
        "shot": string | null,
        "club": string | null,
        "stats": [ { "label": string, "value": string, "unit": string | null } ]
      }
    ]
  },
  "takeaways": string[],
  "tips": string[]
}
- takeaways: 2–4 short sentences. tips: 2–3 actionable tips.
- detected_system: brand/name if identifiable from the UI, else null.
- session_notes: optional short context (club focus, # of shots) if visible.`;

type StatVal = { label: string; value: string; unit: string | null };
type ShotRow = { shot: string | null; club: string | null; stats: StatVal[] };

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

function formatLooseValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  return null;
}

function normalizeStat(raw: unknown): StatVal | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const label =
    asTrimmedString(o.label) ??
    asTrimmedString(o.name) ??
    asTrimmedString(o.key) ??
    asTrimmedString(o.metric);
  const value =
    formatLooseValue(o.value) ??
    formatLooseValue(o.val) ??
    formatLooseValue(o.reading) ??
    formatLooseValue(o.amount);
  if (!label || value == null) return null;
  return {
    label,
    value,
    unit: asTrimmedString(o.unit) ?? asTrimmedString(o.units),
  };
}

function normalizeStatList(raw: unknown, max: number): StatVal[] {
  if (!Array.isArray(raw)) return [];
  const out: StatVal[] = [];
  for (const item of raw) {
    const s = normalizeStat(item);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeShot(raw: unknown): ShotRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  let stats = normalizeStatList(o.stats ?? o.metrics ?? o.values, 24);
  if (stats.length === 0) {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'shot' || k === 'club' || k === 'label' || k === 'name' || k === 'index') continue;
      const value = formatLooseValue(v);
      if (value == null) continue;
      stats.push({ label: k.replace(/_/g, ' '), value, unit: null });
      if (stats.length >= 24) break;
    }
  }
  if (stats.length === 0) return null;
  return {
    shot: asTrimmedString(o.shot) ?? asTrimmedString(o.label) ?? asTrimmedString(o.name),
    club: asTrimmedString(o.club),
    stats,
  };
}

function normalizeShots(raw: unknown, max: number): ShotRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ShotRow[] = [];
  for (const item of raw) {
    const s = normalizeShot(item);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function parseAiJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizePayload(obj: Record<string, unknown>) {
  const statsRoot =
    (obj.extracted_stats && typeof obj.extracted_stats === 'object'
      ? (obj.extracted_stats as Record<string, unknown>)
      : null) ??
    (obj.stats && typeof obj.stats === 'object' ? (obj.stats as Record<string, unknown>) : null) ??
    obj;

  const summary = normalizeStatList(
    statsRoot.summary ?? statsRoot.summary_stats ?? statsRoot.averages ?? statsRoot.session_stats,
    40
  );
  const shots = normalizeShots(statsRoot.shots ?? statsRoot.shot_list ?? statsRoot.per_shot, 60);
  const topLevelStats = normalizeStatList(obj.stats, 40);

  return {
    detected_system:
      asTrimmedString(obj.detected_system) ??
      asTrimmedString(obj.system) ??
      asTrimmedString(obj.simulator) ??
      asTrimmedString(obj.platform),
    session_notes:
      asTrimmedString(obj.session_notes) ??
      asTrimmedString(obj.sessionNotes) ??
      asTrimmedString(obj.notes) ??
      asTrimmedString(obj.club_context),
    extracted_stats: {
      summary: summary.length > 0 ? summary : topLevelStats,
      shots,
    },
    takeaways: asStringArray(obj.takeaways ?? obj.insights ?? obj.patterns, 6),
    tips: asStringArray(obj.tips ?? obj.recommendations ?? obj.next_session_tips, 5),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ success: false, error: 'Server configuration error' }, 500);
    }
    if (!anthropicKey) {
      return jsonResponse({ success: false, error: 'Practice analysis service is not configured' }, 503);
    }

    const body = (await req.json()) as {
      image_path?: string;
      image_url?: string;
    };

    const imagePath = body.image_path?.trim();
    const imageUrl = body.image_url?.trim();
    if (!imagePath) {
      return jsonResponse({ success: false, error: 'image_path is required' }, 400);
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    // Path must be owned by the caller: `{user_id}/...`
    if (!imagePath.startsWith(`${user.id}/`)) {
      return jsonResponse({ success: false, error: 'Invalid image path' }, 403);
    }

    let fetchUrl = imageUrl ?? '';
    if (!fetchUrl) {
      const { data: signed, error: signErr } = await userClient.storage
        .from(BUCKET)
        .createSignedUrl(imagePath, 60 * 10);
      if (signErr || !signed?.signedUrl) {
        return jsonResponse({ success: false, error: 'Could not read practice image' }, 400);
      }
      fetchUrl = signed.signedUrl;
    }

    const imageRes = await fetch(fetchUrl);
    if (!imageRes.ok) {
      return jsonResponse({ success: false, error: 'Could not read practice image' }, 400);
    }

    const imageBytes = new Uint8Array(await imageRes.arrayBuffer());
    const contentType = imageRes.headers.get('content-type') ?? 'image/jpeg';
    const mediaType = contentType.includes('png')
      ? 'image/png'
      : contentType.includes('webp')
        ? 'image/webp'
        : 'image/jpeg';

    let binary = '';
    for (let i = 0; i < imageBytes.length; i++) {
      binary += String.fromCharCode(imageBytes[i]);
    }
    const base64 = btoa(binary);

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              },
              { type: 'text', text: EXTRACT_PROMPT },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[analyze-practice] anthropic', anthropicRes.status, errText);
      return jsonResponse({ success: false, error: 'AI analysis failed. Try again.' }, 502);
    }

    const anthropicJson = await anthropicRes.json();
    const textBlock = anthropicJson?.content?.find((b: { type?: string }) => b.type === 'text');
    const rawText = typeof textBlock?.text === 'string' ? textBlock.text : '';
    const extracted = parseAiJson(rawText);
    if (!extracted) {
      return jsonResponse({ success: false, error: 'Could not read stats from that photo' }, 422);
    }

    const normalized = normalizePayload(extracted);
    const hasContent =
      normalized.extracted_stats.summary.length > 0 ||
      normalized.extracted_stats.shots.length > 0 ||
      normalized.takeaways.length > 0;

    if (!hasContent) {
      return jsonResponse({
        success: false,
        error: 'No readable practice stats found in that photo. Try a clearer screenshot.',
      }, 422);
    }

    // Soft-fill tips/takeaways if the model returned stats but skipped coaching.
    if (normalized.takeaways.length === 0) {
      normalized.takeaways = [
        'Stats were readable, but there was not enough pattern detail for a strong session diagnosis. Try a screen that shows several shots or club averages.',
      ];
    }
    if (normalized.tips.length === 0) {
      normalized.tips = [
        'On your next session, capture a full shot table (or club averages) so tips can target dispersion and distance gaps.',
      ];
    }

    const { data: inserted, error: insertErr } = await userClient
      .from('practice_analyses')
      .insert({
        user_id: user.id,
        image_path: imagePath,
        detected_system: normalized.detected_system,
        session_notes: normalized.session_notes,
        extracted_stats: normalized.extracted_stats,
        takeaways: normalized.takeaways,
        tips: normalized.tips,
      })
      .select('id')
      .single();

    if (insertErr || !inserted?.id) {
      console.error('[analyze-practice] insert', insertErr);
      return jsonResponse({ success: false, error: insertErr?.message ?? 'Could not save analysis' }, 500);
    }

    return jsonResponse({
      success: true,
      analysis_id: inserted.id,
    });
  } catch (e) {
    console.error('[analyze-practice]', e);
    return jsonResponse({
      success: false,
      error: e instanceof Error ? e.message : 'Analysis failed',
    }, 500);
  }
});
