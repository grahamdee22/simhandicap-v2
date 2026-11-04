/**
 * Round handicap snapshots for Match Play Skins / Stableford (full-CH nets).
 */

import Constants from 'expo-constants';
import { supabase } from './supabase';

export type SideGameRoundSnap = {
  id: string;
  simcap_index_at_time: number | null;
};

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

export async function fetchSideGameRoundSnaps(
  roundIds: string[],
  accessToken?: string
): Promise<{ data: SideGameRoundSnap[] | null; error: string | null }> {
  if (roundIds.length === 0) return { data: [], error: null };
  const inList = roundIds.map(encodeURIComponent).join(',');
  const path = `rounds?id=in.(${inList})&select=id,simcap_index_at_time`;

  if (accessToken) {
    const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
    if (!supabaseUrl || !supabaseAnonKey) {
      return { data: null, error: 'Supabase is not configured' };
    }
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { data: null, error: body || res.statusText };
    }
    const parsed = (await res.json()) as SideGameRoundSnap[];
    return { data: Array.isArray(parsed) ? parsed : [], error: null };
  }

  if (!supabase) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await supabase
    .from('rounds')
    .select('id,simcap_index_at_time')
    .in('id', roundIds);
  if (error) return { data: null, error: error.message };
  return { data: (data ?? []) as SideGameRoundSnap[], error: null };
}
