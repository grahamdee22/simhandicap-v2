/**
 * Supabase REST / RPC / edge-function helpers for tournament scoring.
 */

import Constants from 'expo-constants';
import { supabase } from './supabase';

export function getSupabaseRestConfig(): { supabaseUrl: string; supabaseAnonKey: string } {
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

function restErrorMessage(rawText: string, statusText: string): string {
  let msg = rawText || statusText || 'Request failed';
  try {
    const j = JSON.parse(rawText) as { message?: string };
    if (j?.message) msg = j.message;
  } catch {
    /* keep msg */
  }
  return msg;
}

export async function restSelect<T>(
  path: string,
  accessToken?: string
): Promise<{ data: T[] | null; error: string | null }> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured' };
  const headers: Record<string, string> = { apikey: supabaseAnonKey };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { data: null, error: restErrorMessage(body, res.statusText) };
  }
  const parsed = (await res.json()) as T[];
  return { data: Array.isArray(parsed) ? parsed : [], error: null };
}

/** PostgREST RPC via REST (Google OAuth when the JS client has no session). */
export async function restRpcPost<T = unknown>(
  accessToken: string,
  rpcName: string,
  body: Record<string, unknown>
): Promise<{ data: T | null; error: string | null }> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) return { data: null, error: 'Supabase is not configured' };
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const rawText = await res.text().catch(() => '');
  if (!res.ok) return { data: null, error: restErrorMessage(rawText, res.statusText) };
  const t = rawText.trim();
  if (!t) return { data: null, error: null };
  try {
    return { data: JSON.parse(t) as T, error: null };
  } catch {
    return { data: null, error: 'Invalid RPC response' };
  }
}

export async function resolveTournamentAccessToken(
  accessToken?: string
): Promise<string | null> {
  if (accessToken) return accessToken;
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function invokeTournamentEdgeFunction<T extends Record<string, unknown>>(
  functionName: string,
  body: Record<string, unknown>,
  accessToken?: string
): Promise<{ data: T | null; error: string | null }> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { data: null, error: 'Supabase is not configured' };
  }

  const token = await resolveTournamentAccessToken(accessToken);
  if (!token) return { data: null, error: 'Not signed in' };

  const res = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text().catch(() => '');
  let parsed: T & { error?: string } = {} as T & { error?: string };
  try {
    parsed = raw ? (JSON.parse(raw) as T & { error?: string }) : ({} as T);
  } catch {
    return { data: null, error: raw || res.statusText || 'Request failed' };
  }

  if (!res.ok) {
    return { data: null, error: parsed.error ?? raw ?? res.statusText ?? 'Request failed' };
  }

  return { data: parsed as T, error: null };
}
