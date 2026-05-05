/**
 * Match Play (Supabase): typed data access only — no UI.
 * RLS governs visibility; callers must use an authenticated supabase session.
 */

import { supabase } from './supabase';

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
}>;

function asMatchRow(row: unknown): DbMatchRow {
  return row as DbMatchRow;
}

function mapMatchRows(rows: unknown[] | null): DbMatchRow[] {
  return (rows ?? []).map((r) => asMatchRow(r));
}

/**
 * Matches where the current user is player 1 or 2 (incoming, active, history, etc.).
 * Ordered newest first.
 */
export async function listMyMatches(): Promise<MatchListResult> {
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'Not signed in' };

  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .or(`player_1_id.eq.${user.id},player_2_id.eq.${user.id}`)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[matchPlay] listMyMatches', error.message);
    return { data: null, error: error.message };
  }
  return { data: mapMatchRows(data as unknown[]), error: null };
}

/** Display names for all players referenced in the given match rows (for UI lists). */
export async function fetchMatchPlayerDisplayNames(rows: DbMatchRow[]): Promise<Record<string, string>> {
  if (!supabase) return {};
  const ids = new Set<string>();
  for (const m of rows) {
    ids.add(m.player_1_id);
    if (m.player_2_id) ids.add(m.player_2_id);
  }
  if (ids.size === 0) return {};
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
export async function listOpenFeedMatches(): Promise<MatchListResult> {
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'Not signed in' };

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
  return { data: mapMatchRows(data as unknown[]), error: null };
}

/**
 * Single match by id (RLS: participant, open-feed row, or co-group completed).
 */
export async function getMatchById(matchId: string): Promise<MatchSingleResult> {
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
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
  return { data: asMatchRow(data), error: null };
}

/** All hole scores for a match (both players), hole_number ascending. */
export async function listMatchHoles(matchId: string): Promise<MatchHoleListResult> {
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
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
 */
export async function insertMatch(input: InsertMatchInput): Promise<MatchSingleResult> {
  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { data: null, error: 'Not signed in' };

  const payload = {
    player_1_id: user.id,
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
  };

  const { data, error } = await supabase.from('matches').insert(payload).select('*').single();

  if (error) {
    console.warn('[matchPlay] insertMatch', error.message);
    return { data: null, error: error.message };
  }
  return { data: asMatchRow(data), error: null };
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
  return { data: asMatchRow(data), error: null };
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
