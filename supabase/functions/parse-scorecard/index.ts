import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, jsonResponse } from '../_shared/http.ts';

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

const EXTRACT_PROMPT = `You are analyzing a GS Pro golf simulator scorecard screenshot.

Extract data from the ROUND SETTINGS bar at the bottom of the scorecard and the player's total score from the rightmost column of their scorecard row.

Return ONLY valid JSON with no preamble, markdown, or explanation. Use this exact shape:
{
  "total_score": number | null,
  "holes_played": number | null,
  "mulligans_raw": string | null,
  "wind_raw": string | null,
  "pin_placement_raw": string | null,
  "putting_mode_raw": string | null,
  "tees_raw": string | null,
  "raw_course_name": string | null
}

Use null for any field you cannot read. raw_course_name is the course name shown in GS Pro only — do not normalize it.`;

type CourseTeeInput = { name: string; yards?: number | null };

type RawExtract = {
  total_score?: number | null;
  holes_played?: number | null;
  mulligans_raw?: string | null;
  wind_raw?: string | null;
  pin_placement_raw?: string | null;
  putting_mode_raw?: string | null;
  tees_raw?: string | null;
  raw_course_name?: string | null;
};

type MappedData = {
  total_score?: number | null;
  holes_played?: number | null;
  mulligans?: boolean | null;
  wind?: 'Off' | 'Light' | 'Strong' | null;
  pin_placement?: 'Thu' | 'Fri' | 'Sat' | 'Sun' | null;
  putting_mode?: 'Auto' | 'Gimme' | 'Putt' | null;
  tees?: string | null;
  date_played?: string | null;
};

function parseAiJson(text: string): RawExtract | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as RawExtract;
  } catch {
    return null;
  }
}

function mapMulligans(raw: string | null | undefined): { value: boolean | null; error?: string } {
  if (!raw?.trim()) return { value: null, error: 'Mulligans not found on scorecard' };
  const t = raw.trim().toUpperCase();
  if (t === 'ON' || t === 'YES' || t === 'ENABLED') return { value: true };
  if (t === 'OFF' || t === 'NO' || t === 'DISABLED') return { value: false };
  return { value: null, error: `Unrecognized mulligans value: ${raw}` };
}

function mapPin(raw: string | null | undefined): { value: MappedData['pin_placement']; error?: string } {
  if (!raw?.trim()) return { value: null, error: 'Pin placement not found on scorecard' };
  const t = raw.trim().toLowerCase();
  if (t.startsWith('thu')) return { value: 'Thu' };
  if (t.startsWith('fri')) return { value: 'Fri' };
  if (t.startsWith('sat')) return { value: 'Sat' };
  if (t.startsWith('sun')) return { value: 'Sun' };
  return { value: null, error: `Unrecognized pin placement: ${raw}` };
}

function mapWind(raw: string | null | undefined): { value: MappedData['wind']; error?: string } {
  if (!raw?.trim()) return { value: null, error: 'Wind not found on scorecard' };
  const t = raw.trim().toLowerCase();
  if (t.includes('no wind') || t === 'calm' || t === 'off' || t === 'none') return { value: 'Off' };
  if (t.includes('breezy') || t === 'light') return { value: 'Light' };
  if (t.includes('moderate') || t.includes('strong') || /\d+\s*mph/.test(t)) return { value: 'Strong' };
  return { value: null, error: `Unrecognized wind: ${raw}` };
}

function mapPutting(raw: string | null | undefined): { value: MappedData['putting_mode']; error?: string } {
  if (!raw?.trim()) return { value: null, error: 'Putting mode not found on scorecard' };
  const t = raw.trim().toLowerCase();
  if (t.startsWith('auto') || t.includes('auto putt')) return { value: 'Auto' };
  if (t.includes('gimme')) return { value: 'Gimme' };
  if (t.includes('manual') || t.includes('putt')) return { value: 'Putt' };
  return { value: null, error: `Unrecognized putting mode: ${raw}` };
}

function extractYardage(raw: string): number | null {
  const m = raw.match(/(\d{3,5})\s*(?:yd|yds|yards?)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function matchTee(
  raw: string | null | undefined,
  courseTees: CourseTeeInput[]
): { value: string | null; error?: string } {
  if (!raw?.trim()) return { value: null, error: 'Tee not found on scorecard' };

  const eligible = courseTees.filter((t) => t.name.trim().toLowerCase() !== 'custom');
  if (eligible.length === 0) {
    return { value: null, error: 'No tee options available for this course' };
  }

  const normalized = raw.trim();
  const lower = normalized.toLowerCase();

  for (const t of eligible) {
    if (t.name.toLowerCase() === lower) return { value: t.name };
  }

  const firstToken = normalized.split(/\s+/)[0] ?? normalized;
  for (const t of eligible) {
    if (t.name.toLowerCase() === firstToken.toLowerCase()) return { value: t.name };
  }

  for (const t of eligible) {
    if (lower.includes(t.name.toLowerCase())) return { value: t.name };
  }

  const yards = extractYardage(normalized);
  if (yards != null) {
    const withYards = eligible.filter((t) => typeof t.yards === 'number' && Number.isFinite(t.yards));
    if (withYards.length === 0) {
      return { value: null, error: 'Could not match tee by name and no yardage data for this course' };
    }
    let best = withYards[0]!;
    let bestDiff = Math.abs((best.yards as number) - yards);
    for (const t of withYards.slice(1)) {
      const diff = Math.abs((t.yards as number) - yards);
      if (diff < bestDiff) {
        best = t;
        bestDiff = diff;
      }
    }
    if (best.name.toLowerCase() === 'custom') {
      return { value: null, error: 'Closest tee match was Custom — please select tee manually' };
    }
    return { value: best.name };
  }

  return { value: null, error: `Unrecognized tee: ${raw}` };
}

function mapExtract(
  raw: RawExtract,
  courseTees: CourseTeeInput[]
): { data: MappedData; errors: string[]; fieldFailures: number } {
  const errors: string[] = [];
  let fieldFailures = 0;

  const bump = (err?: string) => {
    if (err) {
      errors.push(err);
      fieldFailures += 1;
    }
  };

  const total =
    typeof raw.total_score === 'number' && Number.isFinite(raw.total_score)
      ? Math.round(raw.total_score)
      : null;
  if (total == null) bump('Total score not found on scorecard');

  const holes =
    typeof raw.holes_played === 'number' && Number.isFinite(raw.holes_played)
      ? Math.round(raw.holes_played)
      : null;

  const mull = mapMulligans(raw.mulligans_raw);
  bump(mull.error);

  const wind = mapWind(raw.wind_raw);
  bump(wind.error);

  const pin = mapPin(raw.pin_placement_raw);
  bump(pin.error);

  const putting = mapPutting(raw.putting_mode_raw);
  bump(putting.error);

  const tee = matchTee(raw.tees_raw, courseTees);
  bump(tee.error);

  return {
    data: {
      total_score: total,
      holes_played: holes,
      mulligans: mull.value,
      wind: wind.value,
      pin_placement: pin.value,
      putting_mode: putting.value,
      tees: tee.value,
      date_played: null,
    },
    errors,
    fieldFailures,
  };
}

function confidenceFromFailures(fieldFailures: number): 'high' | 'medium' | 'low' {
  if (fieldFailures >= 3) return 'low';
  if (fieldFailures >= 1) return 'medium';
  return 'high';
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
      return jsonResponse({ success: false, error: 'Parse service is not configured' }, 503);
    }

    const body = (await req.json()) as {
      image_url?: string;
      course_tees?: CourseTeeInput[];
    };

    const imageUrl = body.image_url?.trim();
    if (!imageUrl) {
      return jsonResponse({ success: false, error: 'image_url is required' }, 400);
    }

    const courseTees = Array.isArray(body.course_tees) ? body.course_tees : [];

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

    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
      return jsonResponse({
        success: false,
        confidence: 'low',
        data: {},
        errors: ['Could not read scorecard image'],
        error: 'Could not read scorecard image',
      });
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
        max_tokens: 768,
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
      console.error('[parse-scorecard] anthropic', anthropicRes.status, errText);
      return jsonResponse({
        success: false,
        confidence: 'low',
        data: {},
        errors: ['AI parse failed'],
        error: 'AI parse failed. Try again.',
      }, 502);
    }

    const anthropicJson = await anthropicRes.json();
    const textBlock = anthropicJson?.content?.find((b: { type?: string }) => b.type === 'text');
    const rawText = typeof textBlock?.text === 'string' ? textBlock.text : '';
    const extracted = parseAiJson(rawText);

    if (!extracted) {
      return jsonResponse({
        success: false,
        confidence: 'low',
        data: {},
        raw_course_name: null,
        errors: ['Could not read scorecard JSON from image'],
      });
    }

    const { data, errors, fieldFailures } = mapExtract(extracted, courseTees);
    const confidence = confidenceFromFailures(fieldFailures);
    const hasScore = data.total_score != null;

    return jsonResponse({
      success: hasScore,
      confidence,
      data,
      raw_course_name: extracted.raw_course_name ?? null,
      errors,
    });
  } catch (e) {
    console.error('[parse-scorecard]', e);
    return jsonResponse({
      success: false,
      confidence: 'low',
      data: {},
      errors: [e instanceof Error ? e.message : 'Parse failed'],
      error: e instanceof Error ? e.message : 'Parse failed',
    }, 500);
  }
});
