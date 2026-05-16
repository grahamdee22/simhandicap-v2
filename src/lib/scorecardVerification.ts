import Constants from 'expo-constants';
import { supabase } from './supabase';
import type { ScorecardVerificationResult } from './matchVerification';

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

/** Invoke Supabase Edge Function to run Claude scorecard verification. */
export async function invokeScorecardVerification(
  matchId: string,
  accessToken?: string
): Promise<ScorecardVerificationResult> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      verified: false,
      extracted_score: null,
      extracted_course: null,
      confidence: 'low',
      notes: '',
      error: 'Supabase is not configured',
    };
  }

  let token = accessToken;
  if (!token && supabase) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
  }
  if (!token) {
    return {
      verified: false,
      extracted_score: null,
      extracted_course: null,
      confidence: 'low',
      notes: '',
      error: 'Not signed in',
    };
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/verify-scorecard`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ match_id: matchId }),
  });

  const raw = await res.text().catch(() => '');
  let parsed: Partial<ScorecardVerificationResult> & { error?: string } = {};
  try {
    parsed = raw ? (JSON.parse(raw) as ScorecardVerificationResult & { error?: string }) : {};
  } catch {
    return {
      verified: false,
      extracted_score: null,
      extracted_course: null,
      confidence: 'low',
      notes: '',
      error: raw || res.statusText || 'Verification failed',
    };
  }

  if (!res.ok) {
    return {
      verified: false,
      extracted_score: null,
      extracted_course: null,
      confidence: 'low',
      notes: parsed.notes ?? '',
      error: parsed.error ?? raw ?? res.statusText ?? 'Verification failed',
    };
  }

  return {
    verified: !!parsed.verified,
    extracted_score:
      typeof parsed.extracted_score === 'number' && Number.isFinite(parsed.extracted_score)
        ? parsed.extracted_score
        : null,
    extracted_course: parsed.extracted_course ?? null,
    confidence: parsed.confidence ?? 'low',
    notes: parsed.notes ?? '',
    logged_gross: parsed.logged_gross,
  };
}
