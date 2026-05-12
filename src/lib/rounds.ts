import Constants from 'expo-constants';
import { PLATFORMS, type PlatformId } from './constants';
import type { Mulligans, PinDay, PuttingMode, Wind } from './handicap';
import { supabase } from './supabase';
import type { SimRound } from '../store/useAppStore';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCloudRoundId(id: string): boolean {
  return UUID_RE.test(id);
}

const PUTTING: readonly PuttingMode[] = ['auto_2putt', 'gimme_5', 'putt_all'];
const PIN: readonly PinDay[] = ['thu', 'fri', 'sat', 'sun'];
const WIND: readonly Wind[] = ['off', 'light', 'strong'];
const MULL: readonly Mulligans[] = ['on', 'off'];

function asPlatformId(v: string): PlatformId {
  return (PLATFORMS as readonly string[]).includes(v) ? (v as PlatformId) : 'Trackman';
}

function asPutting(v: string): PuttingMode {
  return (PUTTING as readonly string[]).includes(v) ? (v as PuttingMode) : 'auto_2putt';
}

function asPin(v: string): PinDay {
  return (PIN as readonly string[]).includes(v) ? (v as PinDay) : 'thu';
}

function asWind(v: string): Wind {
  return (WIND as readonly string[]).includes(v) ? (v as Wind) : 'off';
}

function asMull(v: string): Mulligans {
  return (MULL as readonly string[]).includes(v) ? (v as Mulligans) : 'off';
}

function normalizeHoleScores(raw: unknown): (number | null)[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: (number | null)[] = [];
  for (let i = 0; i < 18; i++) {
    const x = arr[i];
    if (x == null || x === '') out.push(null);
    else if (typeof x === 'number' && Number.isFinite(x)) out.push(x);
    else if (typeof x === 'string') {
      const n = parseInt(x, 10);
      out.push(Number.isFinite(n) ? n : null);
    } else out.push(null);
  }
  return out;
}

export type DbRoundRow = {
  id: string;
  user_id: string;
  course_id: string;
  course_name: string;
  platform: string;
  gross_score: number;
  hole_scores: unknown;
  putting_mode: string;
  pin_placement: string;
  wind: string;
  mulligans: string;
  difficulty_modifier: number;
  differential: number;
  raw_differential: number | null;
  course_rating: number;
  slope: number;
  tee_name: string | null;
  played_at: string;
  created_at: string;
  h2h_group_id: string | null;
  h2h_opponent_member_id: string | null;
  h2h_opponent_display_name: string | null;
  simcap_index_at_time: number | null;
};

export function dbRowToSimRound(row: DbRoundRow): SimRound {
  const holeScores = normalizeHoleScores(row.hole_scores);
  const base: SimRound = {
    id: row.id,
    courseId: row.course_id,
    courseName: row.course_name,
    platform: asPlatformId(row.platform),
    grossScore: row.gross_score,
    holeScores,
    putting: asPutting(row.putting_mode),
    pin: asPin(row.pin_placement),
    wind: asWind(row.wind),
    mulligans: asMull(row.mulligans),
    playedAt: row.played_at,
    courseRating: row.course_rating,
    slope: row.slope,
    teeName: row.tee_name ?? undefined,
    rawDiff: row.raw_differential ?? 0,
    adjustedDiff: row.differential,
    difficultyModifier: row.difficulty_modifier,
    indexAfter: null,
    indexDelta: null,
    simcapIndexAtTime:
      row.simcap_index_at_time != null && Number.isFinite(Number(row.simcap_index_at_time))
        ? Number(row.simcap_index_at_time)
        : null,
  };
  if (row.h2h_group_id) {
    base.h2hGroupId = row.h2h_group_id;
    if (row.h2h_opponent_member_id) base.h2hOpponentMemberId = row.h2h_opponent_member_id;
    if (row.h2h_opponent_display_name) base.h2hOpponentDisplayName = row.h2h_opponent_display_name;
  }
  return base;
}

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

type RoundDbFields = Omit<SimRound, 'id'>;

function roundToDbInsert(userId: string, r: RoundDbFields) {
  return {
    user_id: userId,
    course_id: r.courseId,
    course_name: r.courseName,
    platform: r.platform,
    gross_score: r.grossScore,
    hole_scores: r.holeScores,
    putting_mode: r.putting,
    pin_placement: r.pin,
    wind: r.wind,
    mulligans: r.mulligans,
    difficulty_modifier: r.difficultyModifier,
    differential: r.adjustedDiff,
    raw_differential: r.rawDiff,
    course_rating: r.courseRating,
    slope: r.slope,
    tee_name: r.teeName ?? null,
    played_at: r.playedAt,
    h2h_group_id: r.h2hGroupId ?? null,
    h2h_opponent_member_id: r.h2hOpponentMemberId ?? null,
    h2h_opponent_display_name: r.h2hOpponentDisplayName ?? null,
    simcap_index_at_time: r.simcapIndexAtTime ?? null,
  };
}

/**
 * Load all rounds for the signed-in user (oldest first for handicap math).
 * Returns null if unconfigured, not signed in, or fetch failed (caller keeps existing store state).
 */
export async function fetchMyRoundsForUser(
  userId?: string,
  accessToken?: string
): Promise<SimRound[] | null> {
  if (!supabase) return null;

  if (userId && accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return null;
    const res = await fetch(
      `${supabaseUrl}/rest/v1/rounds?user_id=eq.${encodeURIComponent(userId)}&order=played_at.asc&select=*`,
      {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (!res.ok) {
      console.warn('[rounds] fetch', res.status, await res.text().catch(() => ''));
      return null;
    }
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return null;
    return rows.map((row) => dbRowToSimRound(row as DbRoundRow));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('rounds')
    .select('*')
    .eq('user_id', user.id)
    .order('played_at', { ascending: true });

  if (error) {
    console.warn('[rounds] fetch', error.message);
    return null;
  }

  return (data ?? []).map((row) => dbRowToSimRound(row as DbRoundRow));
}

export async function insertRoundInSupabase(
  userId: string,
  round: RoundDbFields,
  accessToken?: string
): Promise<{ id: string } | { error: string }> {
  const payload = roundToDbInsert(userId, round);

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return { error: 'Supabase not configured' };
    const res = await fetch(`${supabaseUrl}/rest/v1/rounds`, {
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
      let msg = rawText || res.statusText || 'Insert failed';
      try {
        const j = JSON.parse(rawText) as { message?: string };
        if (j?.message) msg = j.message;
      } catch {
        /* keep msg */
      }
      return { error: msg };
    }
    try {
      const rows = JSON.parse(rawText) as unknown;
      const row = Array.isArray(rows) && rows[0] ? (rows[0] as { id?: string }) : null;
      if (!row?.id) return { error: 'Insert failed' };
      return { id: row.id };
    } catch {
      return { error: 'Invalid response' };
    }
  }

  if (!supabase) return { error: 'Supabase not configured' };
  const { data, error } = await supabase.from('rounds').insert(payload).select('id').single();
  if (error || !data?.id) {
    return { error: error?.message ?? 'Insert failed' };
  }
  return { id: data.id as string };
}

export async function updateRoundInSupabase(
  round: SimRound,
  accessToken?: string
): Promise<string | null> {
  const updateBody = {
    course_id: round.courseId,
    course_name: round.courseName,
    platform: round.platform,
    gross_score: round.grossScore,
    hole_scores: round.holeScores,
    putting_mode: round.putting,
    pin_placement: round.pin,
    wind: round.wind,
    mulligans: round.mulligans,
    difficulty_modifier: round.difficultyModifier,
    differential: round.adjustedDiff,
    raw_differential: round.rawDiff,
    course_rating: round.courseRating,
    slope: round.slope,
    tee_name: round.teeName ?? null,
    played_at: round.playedAt,
    h2h_group_id: round.h2hGroupId ?? null,
    h2h_opponent_member_id: round.h2hOpponentMemberId ?? null,
    h2h_opponent_display_name: round.h2hOpponentDisplayName ?? null,
    simcap_index_at_time: round.simcapIndexAtTime ?? null,
  };

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return 'Supabase not configured';
    const res = await fetch(`${supabaseUrl}/rest/v1/rounds?id=eq.${encodeURIComponent(round.id)}`, {
      method: 'PATCH',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(updateBody),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      let msg = raw || res.statusText || 'Update failed';
      try {
        const j = JSON.parse(raw) as { message?: string };
        if (j?.message) msg = j.message;
      } catch {
        /* keep msg */
      }
      return msg;
    }
    return null;
  }

  if (!supabase) return 'Supabase not configured';
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 'Not signed in';

  const { error } = await supabase.from('rounds').update(updateBody).eq('id', round.id).eq('user_id', user.id);

  if (error) return error.message;
  return null;
}

export async function deleteRoundInSupabase(
  roundId: string,
  accessToken?: string
): Promise<string | null> {
  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return 'Supabase not configured';
    const res = await fetch(`${supabaseUrl}/rest/v1/rounds?id=eq.${encodeURIComponent(roundId)}`, {
      method: 'DELETE',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'return=representation',
      },
    });
    const rawText = await res.text().catch(() => '');
    if (!res.ok) {
      let msg = rawText || res.statusText || 'Delete failed';
      try {
        const j = JSON.parse(rawText) as { message?: string };
        if (j?.message) msg = j.message;
      } catch {
        /* keep msg */
      }
      return msg;
    }
    try {
      const deleted = JSON.parse(rawText) as unknown;
      const rows = Array.isArray(deleted) ? deleted : [];
      if (rows.length === 0) {
        return 'No round was deleted (not found, wrong account, or RLS blocked the delete)';
      }
      return null;
    } catch {
      return null;
    }
  }

  if (!supabase) return 'Supabase not configured';
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 'Not signed in';

  const { data, error } = await supabase
    .from('rounds')
    .delete()
    .eq('id', roundId)
    .eq('user_id', user.id)
    .select('id');

  if (error) return error.message;

  const deleted = data ?? [];
  console.log('[rounds] deleteRoundInSupabase', {
    roundId,
    deletedRowCount: deleted.length,
    deletedIds: deleted.map((row) => (row as { id: string }).id),
  });

  if (deleted.length === 0) {
    return 'No round was deleted (not found, wrong account, or RLS blocked the delete)';
  }

  return null;
}
