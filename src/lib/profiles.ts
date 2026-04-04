import { PLATFORMS, type PlatformId } from './constants';
import { supabase } from './supabase';

export type UserProfileRow = {
  id: string;
  display_name: string;
  preferred_platform: string | null;
  ghin_index: number | null;
};

function isPlatformId(v: string): v is PlatformId {
  return (PLATFORMS as readonly string[]).includes(v);
}

/** Fetches the signed-in user's profile row (RLS scopes to auth.uid()). */
export async function fetchMyProfile(): Promise<UserProfileRow | null> {
  if (!supabase) return null;
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, preferred_platform, ghin_index')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.warn('[profiles] fetch', error.message);
    return null;
  }
  if (!data) return null;
  const row = data as {
    id: string;
    display_name: string;
    preferred_platform: string | null;
    ghin_index: number | string | null;
  };
  const rawGhin = row.ghin_index;
  const ghin_index =
    rawGhin === null || rawGhin === undefined || rawGhin === ''
      ? null
      : Number(rawGhin);
  return {
    id: row.id,
    display_name: row.display_name,
    preferred_platform: row.preferred_platform,
    ghin_index: Number.isFinite(ghin_index) ? ghin_index : null,
  };
}

export type ProfilePatch = {
  display_name?: string;
  preferred_platform?: PlatformId | null;
  ghin_index?: number | null;
};

/** Upserts the current user's profile (RLS: only own id). Merges with existing row so partial updates never break NOT NULL on insert. */
export async function upsertMyProfile(patch: ProfilePatch): Promise<{ error?: string }> {
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
