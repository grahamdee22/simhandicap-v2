import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const SCORECARD_PROMPT =
  'You are analyzing a golf simulator scorecard screenshot. Extract the following information and return ONLY a JSON object with no other text: total gross score, course name (if visible), and whether this appears to be a legitimate simulator scorecard. Format: { "verified": boolean, "extracted_score": number, "extracted_course": string, "confidence": "high" | "medium" | "low", "notes": string }';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type AiPayload = {
  verified?: boolean;
  extracted_score?: number;
  extracted_course?: string;
  confidence?: string;
  notes?: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseAiJson(text: string): AiPayload | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as AiPayload;
  } catch {
    return null;
  }
}

function loggedGrossFromHoles(
  rows: { hole_number: number; gross_score: number }[],
  holeNumbers: number[]
): number | null {
  const byHole = new Map(rows.map((r) => [r.hole_number, r.gross_score]));
  let sum = 0;
  for (const h of holeNumbers) {
    const g = byHole.get(h);
    if (g == null || !Number.isFinite(g)) return null;
    sum += g;
  }
  return sum;
}

function holeNumbersForMatch(match: {
  holes: number;
  nine_selection: string | null;
}): number[] {
  if (match.holes === 18) {
    return Array.from({ length: 18 }, (_, i) => i + 1);
  }
  if (match.nine_selection === 'back') {
    return Array.from({ length: 9 }, (_, i) => i + 10);
  }
  return Array.from({ length: 9 }, (_, i) => i + 1);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      return jsonResponse({ error: 'Server configuration error' }, 500);
    }
    if (!anthropicKey) {
      return jsonResponse({ error: 'Verification service is not configured' }, 503);
    }

    const body = (await req.json()) as { match_id?: string };
    const matchId = body.match_id?.trim();
    if (!matchId) {
      return jsonResponse({ error: 'match_id is required' }, 400);
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
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { data: match, error: matchErr } = await userClient
      .from('matches')
      .select(
        'id, player_1_id, player_2_id, course_name, holes, nine_selection, status, verification_required, p1_screenshot_url, p2_screenshot_url, p1_verified, p2_verified'
      )
      .eq('id', matchId)
      .maybeSingle();

    if (matchErr || !match) {
      return jsonResponse({ error: 'Match not found' }, 404);
    }
    if (!match.verification_required) {
      return jsonResponse({ error: 'Verification is not required for this match' }, 400);
    }
    if (match.status !== 'active' && match.status !== 'waiting') {
      return jsonResponse({ error: 'Match is not accepting scorecard verification' }, 400);
    }

    const isP1 = match.player_1_id === user.id;
    const isP2 = match.player_2_id === user.id;
    if (!isP1 && !isP2) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    const screenshotUrl = isP1 ? match.p1_screenshot_url : match.p2_screenshot_url;
    if (!screenshotUrl?.trim()) {
      return jsonResponse({ error: 'Upload a scorecard screenshot first' }, 400);
    }

    const { data: holeRows, error: holesErr } = await userClient
      .from('match_holes')
      .select('hole_number, gross_score, player_id')
      .eq('match_id', matchId)
      .eq('player_id', user.id);

    if (holesErr) {
      return jsonResponse({ error: holesErr.message }, 500);
    }

    const holeNums = holeNumbersForMatch(match);
    const loggedGross = loggedGrossFromHoles(
      (holeRows ?? []).map((r) => ({
        hole_number: r.hole_number,
        gross_score: r.gross_score,
      })),
      holeNums
    );
    if (loggedGross == null) {
      return jsonResponse({ error: 'Enter all hole scores before verifying' }, 400);
    }

    const imageRes = await fetch(screenshotUrl);
    if (!imageRes.ok) {
      return jsonResponse({ error: 'Could not read scorecard image' }, 400);
    }
    const imageBytes = new Uint8Array(await imageRes.arrayBuffer());
    const contentType = imageRes.headers.get('content-type') ?? 'image/jpeg';
    const mediaType =
      contentType.includes('png')
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
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              },
              {
                type: 'text',
                text: `${SCORECARD_PROMPT}\n\nThe player logged a total gross score of ${loggedGross} on course "${match.course_name}". Compare the extracted total gross score to ${loggedGross}. Set verified to true only if the screenshot shows a legitimate simulator scorecard and the total gross score matches ${loggedGross}.`,
              },
            ],
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('[verify-scorecard] anthropic', anthropicRes.status, errText);
      return jsonResponse({ error: 'AI verification failed. Try again.' }, 502);
    }

    const anthropicJson = await anthropicRes.json();
    const textBlock = anthropicJson?.content?.find((b: { type?: string }) => b.type === 'text');
    const rawText = typeof textBlock?.text === 'string' ? textBlock.text : '';
    const ai = parseAiJson(rawText);

    if (!ai) {
      const notes = JSON.stringify({
        status: 'failed',
        reason: 'unreadable',
        message: 'Could not read verification response. Please submit a clearer screenshot.',
        logged_gross: loggedGross,
      });
      const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const patch = isP1
        ? { p1_verified: false, p1_verification_notes: notes }
        : { p2_verified: false, p2_verification_notes: notes };
      await admin.from('matches').update(patch).eq('id', matchId);
      return jsonResponse({
        verified: false,
        extracted_score: null,
        extracted_course: null,
        confidence: 'low',
        notes: 'Could not read the screenshot. Please submit a clearer image.',
        logged_gross: loggedGross,
      });
    }

    const extracted =
      typeof ai.extracted_score === 'number' && Number.isFinite(ai.extracted_score)
        ? Math.round(ai.extracted_score)
        : null;
    const scoreMatches = extracted != null && extracted === loggedGross;
    const confidence = String(ai.confidence ?? '').toLowerCase();
    const aiSaysVerified = ai.verified === true;
    const legible = confidence !== 'low';
    const finalVerified = aiSaysVerified && scoreMatches && legible && extracted != null;

    let userMessage = ai.notes ?? '';
    if (!legible) {
      userMessage = 'Could not read the screenshot clearly. Please submit a clearer image.';
    } else if (!scoreMatches) {
      userMessage = `Screenshot shows ${extracted ?? '—'} but you logged ${loggedGross}. Re-enter your scores or upload a matching scorecard.`;
    } else if (!aiSaysVerified) {
      userMessage = ai.notes || 'Scorecard could not be verified. Please resubmit.';
    }

    const notesPayload = JSON.stringify({
      status: finalVerified ? 'verified' : 'failed',
      ai,
      logged_gross: loggedGross,
      score_matches: scoreMatches,
      message: userMessage,
    });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const patch = isP1
      ? { p1_verified: finalVerified, p1_verification_notes: notesPayload }
      : { p2_verified: finalVerified, p2_verification_notes: notesPayload };
    const { error: updErr } = await admin.from('matches').update(patch).eq('id', matchId);
    if (updErr) {
      return jsonResponse({ error: updErr.message }, 500);
    }

    return jsonResponse({
      verified: finalVerified,
      extracted_score: extracted,
      extracted_course: ai.extracted_course ?? null,
      confidence: ai.confidence ?? 'low',
      notes: userMessage,
      logged_gross: loggedGross,
    });
  } catch (e) {
    console.error('[verify-scorecard]', e);
    return jsonResponse({ error: e instanceof Error ? e.message : 'Verification failed' }, 500);
  }
});
