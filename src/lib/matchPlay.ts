/**
 * Match Play (Supabase): typed data access only — no UI.
 * RLS governs visibility; callers must use an authenticated supabase session.
 */

import Constants from 'expo-constants';
import { canonicalPlatformId } from './constants';
import { supabase } from './supabase';

function getSupabaseRestConfig(): { supabaseUrl: string; supabaseAnonKey: string } {
  const extra = Constants.expoConfig?.extra as
    | { supabaseUrl?: string; supabaseAnonKey?: string; supabasePublishableKey?: string }
    | undefined;
  return {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra?.supabaseUrl ?? '',
    supabaseAnonKey:
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.EXPO_PUBLIC_SUPABASE_KEY ??
      extra?.supabaseAnonKey ??
      extra?.supabasePublishableKey ??
      '',
  };
}

export const MATCH_STATUSES = [
  'pending',
  'open',
  'active',
  'waiting',
  'complete',
  'abandoned',
  'declined',
] as const;

export type MatchStatus = (typeof MATCH_STATUSES)[number];
export const OPEN_CHALLENGE_STATUSES = ['scheduled', 'awaiting_photo', 'active', 'expired'] as const;
export type OpenChallengeStatus = (typeof OPEN_CHALLENGE_STATUSES)[number];

export const MATCH_NINE_SELECTIONS = ['front', 'back'] as const;
export type MatchNineSelection = (typeof MATCH_NINE_SELECTIONS)[number];

/** Row shape returned from `public.matches` (snake_case). */
export type DbMatchRow = {
  id: string;
  created_at: string;
  player_1_id: string;
  player_2_id: string | null;
  is_open: boolean;
  course_name: string;
  player_1_course_rating: number;
  player_1_course_slope: number;
  player_1_tee: string;
  player_2_course_rating: number | null;
  player_2_course_slope: number | null;
  player_2_tee: string | null;
  putting_mode: string;
  pin_placement: string;
  wind: string;
  mulligans: string;
  format: string;
  holes: number;
  nine_selection: MatchNineSelection | null;
  status: MatchStatus;
  winner_id: string | null;
  abandoned_by_id: string | null;
  player_1_net_score: number | null;
  player_2_net_score: number | null;
  player_1_finished: boolean;
  player_2_finished: boolean;
  player_1_settings_photo_url: string | null;
  player_2_settings_photo_url: string | null;
  /** Prior match id when this row is a direct rematch created from a completed match. */
  rematch_from?: string | null;
  /** Challenger index snapshot at post time (open-feed handicap filter). */
  player_1_ghin_index_at_post?: number | null;
  /** Challenger sim platform at post time (open-feed platform filter). */
  player_1_platform?: string | null;
  /** Future open-challenge publish time; null for immediate opens/direct challenges. */
  scheduled_for?: string | null;
  /** Open-challenge lifecycle state (scheduled/awaiting_photo/active/expired). */
  challenge_status?: OpenChallengeStatus | null;
};

export type MatchListResult = { data: DbMatchRow[] | null; error: string | null };

export type MatchSingleResult = { data: DbMatchRow | null; error: string | null };

/** Allowed emoji reactions on an opponent's hole score (must match `set_match_hole_reaction` RPC). */
export const MATCH_HOLE_REACTION_EMOJIS = ['🔥', '💀', '😤', '🫡', '😂', '💩'] as const;
export type MatchHoleReactionEmoji = (typeof MATCH_HOLE_REACTION_EMOJIS)[number];

/** Row from `public.match_holes`. */
export type DbMatchHoleRow = {
  id: string;
  match_id: string;
  player_id: string;
  hole_number: number;
  gross_score: number;
  created_at: string;
  /** Present when `player_id` is player 2: emoji from player 1 reacting to this gross score. */
  player_1_reaction?: string | null;
  /** Present when `player_id` is player 1: emoji from player 2 reacting to this gross score. */
  player_2_reaction?: string | null;
};

/** Reaction the opponent left on the viewer’s hole row (viewer must have posted this hole). */
export function reactionReceivedOnMyHoleRow(
  myRow: DbMatchHoleRow | undefined,
  viewerIsPlayer1: boolean
): string | null {
  if (!myRow) return null;
  const r = viewerIsPlayer1 ? myRow.player_2_reaction : myRow.player_1_reaction;
  const t = typeof r === 'string' ? r.trim() : '';
  return t.length > 0 ? t : null;
}

/** Reaction the viewer sent on the opponent’s hole row (opponent must have posted this hole). */
export function reactionSentOnOpponentRow(
  opponentRow: DbMatchHoleRow | undefined,
  viewerIsPlayer1: boolean
): string | null {
  if (!opponentRow) return null;
  const r = viewerIsPlayer1 ? opponentRow.player_1_reaction : opponentRow.player_2_reaction;
  const t = typeof r === 'string' ? r.trim() : '';
  return t.length > 0 ? t : null;
}

export type MatchHoleListResult = { data: DbMatchHoleRow[] | null; error: string | null };

export type MatchHoleSingleResult = { data: DbMatchHoleRow | null; error: string | null };

function asMatchHoleRow(row: unknown): DbMatchHoleRow {
  return row as DbMatchHoleRow;
}

/**
 * Fields accepted on insert. `player_1_id` is set from the signed-in user.
 * Omit DB-only columns: id, created_at.
 */
export type InsertMatchInput = {
  player_2_id?: string | null;
  is_open: boolean;
  course_name: string;
  player_1_course_rating: number;
  player_1_course_slope: number;
  player_1_tee: string;
  player_2_course_rating?: number | null;
  player_2_course_slope?: number | null;
  player_2_tee?: string | null;
  putting_mode: string;
  pin_placement: string;
  wind: string;
  mulligans: string;
  /** Defaults to `'stroke'` if omitted. */
  format?: string;
  holes: 9 | 18;
  nine_selection: MatchNineSelection | null;
  status: MatchStatus;
  winner_id?: string | null;
  abandoned_by_id?: string | null;
  player_1_net_score?: number | null;
  player_2_net_score?: number | null;
  player_1_finished?: boolean;
  player_2_finished?: boolean;
  player_1_settings_photo_url?: string | null;
  player_2_settings_photo_url?: string | null;
  rematch_from?: string | null;
  player_1_ghin_index_at_post?: number | null;
  player_1_platform?: string | null;
  scheduled_for?: string | null;
  challenge_status?: OpenChallengeStatus | null;
};

/** Updatable subset (RLS still applies). */
export type MatchUpdatePatch = Partial<{
  player_2_id: string | null;
  is_open: boolean;
  course_name: string;
  player_1_course_rating: number;
  player_1_course_slope: number;
  player_1_tee: string;
  player_2_course_rating: number | null;
  player_2_course_slope: number | null;
  player_2_tee: string | null;
  putting_mode: string;
  pin_placement: string;
  wind: string;
  mulligans: string;
  format: string;
  holes: 9 | 18;
  nine_selection: MatchNineSelection | null;
  status: MatchStatus;
  winner_id: string | null;
  abandoned_by_id: string | null;
  player_1_net_score: number | null;
  player_2_net_score: number | null;
  player_1_finished: boolean;
  player_2_finished: boolean;
  player_1_settings_photo_url: string | null;
  player_2_settings_photo_url: string | null;
  scheduled_for: string | null;
  challenge_status: OpenChallengeStatus | null;
}>;

function asMatchRow(row: unknown): DbMatchRow {
  return row as DbMatchRow;
}

/**
 * Normalizes API/DB fields: platform uses canonical id when known, otherwise trimmed raw text
 * (so open-feed cards still show values PostgREST returns). GHIN index is coerced to a finite number.
 */
function normalizeMatchRow(record: unknown): DbMatchRow {
  const r = record as Record<string, unknown>;
  const base = asMatchRow(record);
  const rawPlat = r.player_1_platform;
  let player_1_platform: string | null = null;
  if (rawPlat != null) {
    const s = String(rawPlat).trim();
    if (s.length > 0) player_1_platform = canonicalPlatformId(s) ?? s;
  }
  const rawGhin = r.player_1_ghin_index_at_post;
  let player_1_ghin_index_at_post: number | null = null;
  if (rawGhin != null && rawGhin !== '') {
    const n = Number(rawGhin);
    if (Number.isFinite(n)) player_1_ghin_index_at_post = n;
  }
  const rawScheduledFor = r.scheduled_for;
  const scheduled_for = rawScheduledFor == null ? null : String(rawScheduledFor);
  const rawChallengeStatus = r.challenge_status;
  let challenge_status: OpenChallengeStatus | null = null;
  if (rawChallengeStatus != null) {
    const v = String(rawChallengeStatus).trim();
    if ((OPEN_CHALLENGE_STATUSES as readonly string[]).includes(v)) {
      challenge_status = v as OpenChallengeStatus;
    }
  }
  return {
    ...base,
    player_1_platform,
    player_1_ghin_index_at_post,
    scheduled_for,
    challenge_status,
  };
}

function mapMatchRows(rows: unknown[] | null): DbMatchRow[] {
  return (rows ?? []).map((row) => normalizeMatchRow(row));
}

/**
 * Matches where the current user is player 1 or 2 (incoming, active, history, etc.).
 * Ordered newest first.
 */
export async function listMyMatches(userId?: string, accessToken?: string): Promise<MatchListResult> {
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const uid = userId ?? (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return { data: null, error: 'Not signed in' };

  if (userId && accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured' };
    const orFilter = `(player_1_id.eq.${userId},player_2_id.eq.${userId})`;
    const url = `${supabaseUrl}/rest/v1/matches?select=*&or=${encodeURIComponent(orFilter)}&order=created_at.desc`;
    const res = await fetch(url, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[matchPlay] listMyMatches', res.status, body);
      return { data: null, error: body || res.statusText || 'Request failed' };
    }
    const parsed: unknown = await res.json();
    const rows = Array.isArray(parsed) ? parsed : [];
    return { data: mapMatchRows(rows as unknown[]), error: null };
  }

  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .or(`player_1_id.eq.${uid},player_2_id.eq.${uid}`)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[matchPlay] listMyMatches', error.message);
    return { data: null, error: error.message };
  }
  return { data: mapMatchRows(data as unknown[]), error: null };
}

/** Display names for all players referenced in the given match rows (for UI lists). */
export async function fetchMatchPlayerDisplayNames(
  rows: DbMatchRow[],
  accessToken?: string
): Promise<Record<string, string>> {
  const ids = new Set<string>();
  for (const m of rows) {
    ids.add(m.player_1_id);
    if (m.player_2_id) ids.add(m.player_2_id);
  }
  if (ids.size === 0) return {};

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return {};
    const idList = [...ids].join(',');
    const res = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=in.(${idList})&select=id,display_name`,
      { headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[matchPlay] fetchMatchPlayerDisplayNames', res.status, body);
      return {};
    }
    const data = await res.json();
    if (!Array.isArray(data)) return {};
    const map: Record<string, string> = {};
    for (const row of data as { id: string; display_name?: string }[]) {
      map[row.id] = row.display_name?.trim() || 'Golfer';
    }
    return map;
  }

  if (!supabase) return {};
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', [...ids]);
  if (error || !data) return {};
  const map: Record<string, string> = {};
  for (const row of data as { id: string; display_name?: string }[]) {
    map[row.id] = row.display_name?.trim() || 'Golfer';
  }
  return map;
}

/**
 * Open challenge feed: public listings waiting for an acceptor.
 * Newest first (brief: chronological, newest at top).
 */
export async function listOpenFeedMatches(userId?: string, accessToken?: string): Promise<MatchListResult> {
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const uid = userId ?? (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return { data: null, error: 'Not signed in' };

  if (userId && accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured' };
    const url = `${supabaseUrl}/rest/v1/matches?select=*&is_open=eq.true&status=eq.open&order=created_at.desc`;
    const res = await fetch(url, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[matchPlay] listOpenFeedMatches', res.status, body);
      return { data: null, error: body || res.statusText || 'Request failed' };
    }
    const parsed: unknown = await res.json();
    const rows = Array.isArray(parsed) ? parsed : [];
    const mapped = mapMatchRows(rows as unknown[]);
    const visible = mapped.filter((m) => {
      const cs = m.challenge_status ?? 'active';
      return cs === 'active' || cs === 'scheduled';
    });
    return { data: visible, error: null };
  }

  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('is_open', true)
    .eq('status', 'open')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[matchPlay] listOpenFeedMatches', error.message);
    return { data: null, error: error.message };
  }
  const mapped = mapMatchRows(data as unknown[]);
  const visible = mapped.filter((m) => {
    const cs = m.challenge_status ?? 'active';
    return cs === 'active' || cs === 'scheduled';
  });
  return { data: visible, error: null };
}

/**
 * Single match by id (RLS: participant, open-feed row, or co-group completed).
 */
export async function getMatchById(matchId: string, accessToken?: string): Promise<MatchSingleResult> {
  if (!supabase) return { data: null, error: 'Supabase is not configured' };

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured' };
    const q = `id=eq.${encodeURIComponent(matchId)}&select=*&limit=1`;
    const res = await fetch(`${supabaseUrl}/rest/v1/matches?${q}`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[matchPlay] getMatchById', res.status, body);
      return { data: null, error: body || res.statusText || 'Request failed' };
    }
    const parsed: unknown = await res.json();
    const rows = Array.isArray(parsed) ? parsed : [];
    const row = rows.length > 0 ? rows[0] : null;
    return { data: row ? normalizeMatchRow(row) : null, error: null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'Not signed in' };

  const { data, error } = await supabase.from('matches').select('*').eq('id', matchId).maybeSingle();

  if (error) {
    console.warn('[matchPlay] getMatchById', error.message);
    return { data: null, error: error.message };
  }
  if (!data) return { data: null, error: null };
  return { data: normalizeMatchRow(data), error: null };
}

/** All hole scores for a match (both players), hole_number ascending. */
export async function listMatchHoles(matchId: string, accessToken?: string): Promise<MatchHoleListResult> {
  if (!supabase) return { data: null, error: 'Supabase is not configured' };

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured' };
    const q = `match_id=eq.${encodeURIComponent(matchId)}&select=*&order=hole_number.asc`;
    const res = await fetch(`${supabaseUrl}/rest/v1/match_holes?${q}`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[matchPlay] listMatchHoles', res.status, body);
      return { data: null, error: body || res.statusText || 'Request failed' };
    }
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return { data: null, error: 'Failed to fetch holes' };
    return { data: rows.map((r) => asMatchHoleRow(r)), error: null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'Not signed in' };

  const { data, error } = await supabase
    .from('match_holes')
    .select('*')
    .eq('match_id', matchId)
    .order('hole_number', { ascending: true });

  if (error) {
    console.warn('[matchPlay] listMatchHoles', error.message);
    return { data: null, error: error.message };
  }
  return { data: (data as unknown[]).map(asMatchHoleRow), error: null };
}

/** Insert or update the signed-in player’s gross score for one hole. */
export async function upsertMatchHoleScore(params: {
  matchId: string;
  holeNumber: number;
  grossScore: number;
}): Promise<MatchHoleSingleResult> {
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'Not signed in' };

  const { data: existing, error: selErr } = await supabase
    .from('match_holes')
    .select('id')
    .eq('match_id', params.matchId)
    .eq('player_id', user.id)
    .eq('hole_number', params.holeNumber)
    .maybeSingle();

  if (selErr) {
    console.warn('[matchPlay] upsertMatchHoleScore select', selErr.message);
    return { data: null, error: selErr.message };
  }

  const rowId = (existing as { id?: string } | null)?.id;
  if (rowId) {
    const { data, error } = await supabase
      .from('match_holes')
      .update({ gross_score: params.grossScore })
      .eq('id', rowId)
      .select('*')
      .single();
    if (error) {
      console.warn('[matchPlay] upsertMatchHoleScore update', error.message);
      return { data: null, error: error.message };
    }
    return { data: asMatchHoleRow(data), error: null };
  }

  const { data, error } = await supabase
    .from('match_holes')
    .insert({
      match_id: params.matchId,
      player_id: user.id,
      hole_number: params.holeNumber,
      gross_score: params.grossScore,
    })
    .select('*')
    .single();

  if (error) {
    console.warn('[matchPlay] upsertMatchHoleScore insert', error.message);
    return { data: null, error: error.message };
  }
  return { data: asMatchHoleRow(data), error: null };
}

export type SetMatchHoleReactionResult = { ok: boolean; error: string | null };

/** Lock one emoji on the opponent’s hole row after they have posted that hole (RPC; active/waiting only). */
export async function setMatchHoleReaction(params: {
  matchId: string;
  holeNumber: number;
  emoji: string;
}): Promise<SetMatchHoleReactionResult> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured' };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const { data, error } = await supabase.rpc('set_match_hole_reaction', {
    p_match_id: params.matchId,
    p_hole_number: params.holeNumber,
    p_emoji: params.emoji,
  });
  if (error) {
    console.warn('[matchPlay] setMatchHoleReaction', error.message);
    return { ok: false, error: error.message };
  }
  const payload = data as { ok?: boolean; error?: string } | null;
  if (!payload?.ok) {
    return { ok: false, error: payload?.error ?? 'Could not save reaction' };
  }
  return { ok: true, error: null };
}

/**
 * Create a match as the signed-in user (always `player_1_id`).
 * Pass `userId` + `accessToken` for native Google OAuth when the Supabase client session is not hydrated.
 */
export async function insertMatch(
  input: InsertMatchInput,
  userId?: string,
  accessToken?: string
): Promise<MatchSingleResult> {
  let player1Id: string;
  if (accessToken) {
    if (!userId) return { data: null, error: 'Not signed in' };
    player1Id = userId;
  } else {
    if (!supabase) return { data: null, error: 'Supabase is not configured' };
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { data: null, error: 'Not signed in' };
    player1Id = user.id;
  }

  const payload = {
    player_1_id: player1Id,
    player_2_id: input.player_2_id ?? null,
    is_open: input.is_open,
    course_name: input.course_name,
    player_1_course_rating: input.player_1_course_rating,
    player_1_course_slope: input.player_1_course_slope,
    player_1_tee: input.player_1_tee,
    player_2_course_rating: input.player_2_course_rating ?? null,
    player_2_course_slope: input.player_2_course_slope ?? null,
    player_2_tee: input.player_2_tee ?? null,
    putting_mode: input.putting_mode,
    pin_placement: input.pin_placement,
    wind: input.wind,
    mulligans: input.mulligans,
    format: input.format ?? 'stroke',
    holes: input.holes,
    nine_selection: input.nine_selection,
    status: input.status,
    winner_id: input.winner_id ?? null,
    abandoned_by_id: input.abandoned_by_id ?? null,
    player_1_net_score: input.player_1_net_score ?? null,
    player_2_net_score: input.player_2_net_score ?? null,
    player_1_finished: input.player_1_finished ?? false,
    player_2_finished: input.player_2_finished ?? false,
    player_1_settings_photo_url: input.player_1_settings_photo_url ?? null,
    player_2_settings_photo_url: input.player_2_settings_photo_url ?? null,
    rematch_from: input.rematch_from ?? null,
    player_1_ghin_index_at_post: input.player_1_ghin_index_at_post ?? null,
    player_1_platform:
      input.player_1_platform == null
        ? null
        : canonicalPlatformId(String(input.player_1_platform)),
    scheduled_for: input.scheduled_for ?? null,
    challenge_status: input.challenge_status ?? null,
  };

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured' };
    const res = await fetch(`${supabaseUrl}/rest/v1/matches`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify([payload]),
    });
    const rawText = await res.text().catch(() => '');
    if (!res.ok) {
      let msg = rawText || res.statusText || 'Request failed';
      try {
        const j = JSON.parse(rawText) as { message?: string };
        if (j?.message) msg = j.message;
      } catch {
        /* use msg */
      }
      console.warn('[matchPlay] insertMatch', msg);
      return { data: null, error: msg };
    }
    let rows: unknown;
    try {
      rows = rawText ? JSON.parse(rawText) : null;
    } catch {
      return { data: null, error: 'Invalid response' };
    }
    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!row) return { data: null, error: 'Could not create match' };
    return { data: normalizeMatchRow(row), error: null };
  }

  if (!supabase) return { data: null, error: 'Supabase is not configured' };

  const { data, error } = await supabase.from('matches').insert(payload).select('*').single();

  if (error) {
    console.warn('[matchPlay] insertMatch', error.message);
    return { data: null, error: error.message };
  }
  return { data: normalizeMatchRow(data), error: null };
}

/**
 * Patch a match row by id (RLS must allow the update).
 * Returns the updated row when PostgREST returns one.
 */
export async function updateMatchById(
  matchId: string,
  patch: MatchUpdatePatch
): Promise<MatchSingleResult> {
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'Not signed in' };

  const { data, error } = await supabase
    .from('matches')
    .update(patch)
    .eq('id', matchId)
    .select('*')
    .single();

  if (error) {
    console.warn('[matchPlay] updateMatchById', error.message);
    return { data: null, error: error.message };
  }
  return { data: normalizeMatchRow(data), error: null };
}

/** Remove a match row (RLS: e.g. poster deleting an unclaimed open challenge). */
export async function deleteMatchById(matchId: string): Promise<{ ok: boolean; error: string | null }> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured' };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const { error } = await supabase.from('matches').delete().eq('id', matchId);
  if (error) {
    console.warn('[matchPlay] deleteMatchById', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

export type AbandonMatchResult = { ok: boolean; error: string | null };

/**
 * Abandon an active/waiting stroke match (RPC): `status` → abandoned, `abandoned_by_id` → caller,
 * increments caller `match_losses` + `match_forfeits` only.
 */
export async function abandonMatch(matchId: string): Promise<AbandonMatchResult> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured' };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const { data, error } = await supabase.rpc('abandon_match', { p_match_id: matchId });
  if (error) {
    console.warn('[matchPlay] abandonMatch', error.message);
    return { ok: false, error: error.message };
  }
  const payload = data as { ok?: boolean; error?: string } | null;
  if (!payload?.ok) {
    return { ok: false, error: payload?.error ?? 'Could not abandon match' };
  }
  return { ok: true, error: null };
}

export type AcceptOpenChallengeResult = { ok: boolean; error: string | null };

export type ProcessFutureOpenChallengesResult = {
  ok: boolean;
  activatedCount: number;
  expiredCount: number;
  readyForUid: boolean;
  error: string | null;
};

/** Runs server-side lifecycle transitions for future open challenges. */
export async function processFutureOpenChallenges(): Promise<ProcessFutureOpenChallengesResult> {
  if (!supabase) {
    return { ok: false, activatedCount: 0, expiredCount: 0, readyForUid: false, error: 'Supabase is not configured' };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, activatedCount: 0, expiredCount: 0, readyForUid: false, error: 'Not signed in' };

  const { data, error } = await supabase.rpc('process_future_open_challenges');
  if (error) {
    console.warn('[matchPlay] processFutureOpenChallenges', error.message);
    return { ok: false, activatedCount: 0, expiredCount: 0, readyForUid: false, error: error.message };
  }
  const payload = data as
    | { ok?: boolean; activated_count?: number; expired_count?: number; ready_for_uid?: boolean; error?: string }
    | null;
  if (!payload?.ok) {
    return {
      ok: false,
      activatedCount: 0,
      expiredCount: 0,
      readyForUid: false,
      error: payload?.error ?? 'Could not process future challenges',
    };
  }
  return {
    ok: true,
    activatedCount: Number(payload.activated_count ?? 0),
    expiredCount: Number(payload.expired_count ?? 0),
    readyForUid: !!payload.ready_for_uid,
    error: null,
  };
}

/** Atomically claims an open challenge (RPC); concurrent acceptors get `Challenge already taken`. */
export async function acceptOpenChallenge(params: {
  matchId: string;
  player2Tee: string;
  player2CourseRating: number;
  player2CourseSlope: number;
  player2SettingsPhotoUrl: string | null;
}): Promise<AcceptOpenChallengeResult> {
  if (!supabase) return { ok: false, error: 'Supabase is not configured' };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const { data, error } = await supabase.rpc('accept_open_challenge', {
    p_match_id: params.matchId,
    p_player_2_tee: params.player2Tee,
    p_player_2_course_rating: params.player2CourseRating,
    p_player_2_course_slope: params.player2CourseSlope,
    p_player_2_settings_photo_url: params.player2SettingsPhotoUrl ?? '',
  });
  if (error) {
    console.warn('[matchPlay] acceptOpenChallenge', error.message);
    return { ok: false, error: error.message };
  }
  const payload = data as { ok?: boolean; error?: string } | null;
  if (!payload?.ok) {
    return { ok: false, error: payload?.error ?? 'Could not accept challenge' };
  }
  return { ok: true, error: null };
}
