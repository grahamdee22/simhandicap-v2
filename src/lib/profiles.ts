import Constants from 'expo-constants';
import { PLATFORMS, type PlatformId } from './constants';
import { supabase } from './supabase';

export type UserProfileRow = {
  id: string;
  simcap_id: string;
  display_name: string;
  preferred_platform: string | null;
  ghin_index: number | null;
  match_wins: number;
  match_losses: number;
  match_draws: number;
  match_forfeits: number;
};

function isPlatformId(v: string): v is PlatformId {
  return (PLATFORMS as readonly string[]).includes(v);
}

function parseNonNegInt(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
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

function mapProfileRowToUserProfileRow(data: {
  id: string;
  simcap_id: string;
  display_name: string;
  preferred_platform: string | null;
  ghin_index: number | string | null;
  match_wins?: number | string | null;
  match_losses?: number | string | null;
  match_draws?: number | string | null;
  match_forfeits?: number | string | null;
}): UserProfileRow {
  const rawGhin = data.ghin_index;
  const ghin_index =
    rawGhin === null || rawGhin === undefined || rawGhin === ''
      ? null
      : Number(rawGhin);
  return {
    id: data.id,
    simcap_id: data.simcap_id,
    display_name: data.display_name,
    preferred_platform: data.preferred_platform,
    ghin_index: Number.isFinite(ghin_index) ? ghin_index : null,
    match_wins: parseNonNegInt(data.match_wins),
    match_losses: parseNonNegInt(data.match_losses),
    match_draws: parseNonNegInt(data.match_draws),
    match_forfeits: parseNonNegInt(data.match_forfeits),
  };
}

/** Fetches the signed-in user's profile row (RLS scopes to auth.uid()). */
export async function fetchMyProfile(
  userId?: string,
  accessToken?: string
): Promise<UserProfileRow | null> {
  if (!supabase) return null;

  if (userId && accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return null;
    const select =
      'id,simcap_id,display_name,preferred_platform,ghin_index,match_wins,match_losses,match_draws,match_forfeits';
    const res = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=${encodeURIComponent(select)}`,
      {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (!res.ok) {
      console.warn('[profiles] fetch', res.status, await res.text().catch(() => ''));
      return null;
    }
    const parsed: unknown = await res.json();
    const rows = Array.isArray(parsed) ? parsed : null;
    if (!rows?.length) return null;
    const row = rows[0] as {
      id: string;
      simcap_id: string;
      display_name: string;
      preferred_platform: string | null;
      ghin_index: number | string | null;
      match_wins?: number | string | null;
      match_losses?: number | string | null;
      match_draws?: number | string | null;
      match_forfeits?: number | string | null;
    };
    return mapProfileRowToUserProfileRow(row);
  }

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, simcap_id, display_name, preferred_platform, ghin_index, match_wins, match_losses, match_draws, match_forfeits'
    )
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.warn('[profiles] fetch', error.message);
    return null;
  }
  if (!data) return null;
  return mapProfileRowToUserProfileRow(
    data as {
      id: string;
      simcap_id: string;
      display_name: string;
      preferred_platform: string | null;
      ghin_index: number | string | null;
      match_wins?: number | string | null;
      match_losses?: number | string | null;
      match_draws?: number | string | null;
      match_forfeits?: number | string | null;
    }
  );
}

export type ProfilePatch = {
  display_name?: string;
  preferred_platform?: PlatformId | null;
  ghin_index?: number | null;
};

/** Upserts the current user's profile (RLS: only own id). Merges with existing row so partial updates never break NOT NULL on insert. */
export async function upsertMyProfile(
  patch: ProfilePatch,
  userId?: string,
  accessToken?: string
): Promise<{ error?: string }> {
  if (accessToken) {
    if (!userId) return { error: 'Not signed in' };
    const existing = await fetchMyProfile(userId, accessToken);
    const display_name =
      patch.display_name !== undefined ? patch.display_name : (existing?.display_name ?? 'Golfer');
    const preferred_platform =
      patch.preferred_platform !== undefined
        ? patch.preferred_platform
        : (existing?.preferred_platform ?? null);
    const ghin_index =
      patch.ghin_index !== undefined ? patch.ghin_index : (existing?.ghin_index ?? null);

    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) return { error: 'Supabase is not configured' };
    const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        display_name,
        preferred_platform,
        ghin_index,
        updated_at: new Date().toISOString(),
      }),
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
      return { error: msg };
    }
    return {};
  }

  if (!supabase) return { error: 'Supabase is not configured' };
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) return { error: 'Not signed in' };

  const existing = await fetchMyProfile();
  const display_name =
    patch.display_name !== undefined ? patch.display_name : (existing?.display_name ?? 'Golfer');
  const preferred_platform =
    patch.preferred_platform !== undefined
      ? patch.preferred_platform
      : (existing?.preferred_platform ?? null);
  const ghin_index =
    patch.ghin_index !== undefined ? patch.ghin_index : (existing?.ghin_index ?? null);

  const { error } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      display_name,
      preferred_platform,
      ghin_index,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (error) return { error: error.message };
  return {};
}

/** Applies server profile fields into local Zustand (call from auth bootstrap / after save). */
export function applyProfileRowToStore(
  p: UserProfileRow | null,
  actions: {
    setDisplayName: (n: string) => void;
    setPreferredLogPlatform: (plat: PlatformId) => void;
    /** Only updates GHIN snapshots when the server value differs (avoids duplicate chart points on refetch). */
    syncGhinFromProfileIfChanged: (n: number) => void;
  }
): void {
  if (!p) return;
  if (p.display_name) actions.setDisplayName(p.display_name);
  if (p.preferred_platform && isPlatformId(p.preferred_platform)) {
    actions.setPreferredLogPlatform(p.preferred_platform);
  }
  const g = p.ghin_index != null ? Number(p.ghin_index) : NaN;
  if (Number.isFinite(g)) {
    actions.syncGhinFromProfileIfChanged(g);
  }
}
