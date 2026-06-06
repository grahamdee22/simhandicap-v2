import Constants from 'expo-constants';
import { supabase } from './supabase';

export type ParseScorecardCourseTee = {
  name: string;
  yards?: number | null;
};

export type ParseScorecardData = {
  total_score?: number | null;
  holes_played?: number | null;
  mulligans?: boolean | null;
  wind?: 'Off' | 'Light' | 'Strong' | null;
  pin_placement?: 'Thu' | 'Fri' | 'Sat' | 'Sun' | null;
  putting_mode?: 'Auto' | 'Gimme' | 'Putt' | null;
  tees?: string | null;
  date_played?: string | null;
};

export type ParseScorecardResult = {
  success: boolean;
  confidence: 'high' | 'medium' | 'low';
  data: ParseScorecardData;
  raw_course_name?: string | null;
  errors: string[];
  error?: string;
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

export async function invokeParseScorecard(params: {
  imageUrl: string;
  courseTees: ParseScorecardCourseTee[];
  accessToken?: string;
}): Promise<ParseScorecardResult> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  const fail = (error: string): ParseScorecardResult => ({
    success: false,
    confidence: 'low',
    data: {},
    errors: [error],
    error,
  });

  if (!supabaseUrl || !supabaseAnonKey) return fail('Supabase is not configured');

  let token = params.accessToken;
  if (!token && supabase) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
  }
  if (!token) return fail('Not signed in');

  const res = await fetch(`${supabaseUrl}/functions/v1/parse-scorecard`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_url: params.imageUrl,
      course_tees: params.courseTees,
    }),
  });

  const raw = await res.text().catch(() => '');
  let parsed: Partial<ParseScorecardResult> & { error?: string } = {};
  try {
    parsed = raw ? (JSON.parse(raw) as ParseScorecardResult & { error?: string }) : {};
  } catch {
    return fail(raw || res.statusText || 'Could not parse scorecard');
  }

  if (!res.ok) {
    return fail(parsed.error ?? raw ?? res.statusText ?? 'Could not parse scorecard');
  }

  return {
    success: !!parsed.success,
    confidence: parsed.confidence ?? 'low',
    data: parsed.data ?? {},
    raw_course_name: parsed.raw_course_name ?? null,
    errors: parsed.errors ?? [],
  };
}
