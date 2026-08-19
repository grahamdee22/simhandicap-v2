/**
 * Practice Analyzer client: pairing-code CSV import, list/detail/delete.
 * Separate from rounds / handicap index — never writes to public.rounds.
 */

import Constants from 'expo-constants';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import {
  PRACTICE_CSV_SCHEMA,
  formatMetricValue,
  metricLabel,
  type ClubSummary,
  type ParsedPracticeSession,
} from './practiceCsv';

const CSV_BUCKET = 'practice-analysis-csvs';

export type PracticeAnalysisStatus = 'processing' | 'ready' | 'failed';

export type PracticeAnalysisRow = {
  id: string;
  user_id: string;
  image_path: string | null;
  csv_path: string | null;
  source: string;
  platform: string | null;
  detected_system: string | null;
  session_notes: string | null;
  original_filename: string | null;
  session_played_at: string | null;
  status: PracticeAnalysisStatus;
  error_message: string | null;
  extracted_stats: ParsedPracticeSession | Record<string, unknown>;
  takeaways: string[];
  tips: string[];
  created_at: string;
};

export type PracticeAnalysisListItem = Pick<
  PracticeAnalysisRow,
  | 'id'
  | 'detected_system'
  | 'platform'
  | 'session_notes'
  | 'session_played_at'
  | 'status'
  | 'created_at'
  | 'takeaways'
  | 'tips'
>;

export type PracticeImportCodeRow = {
  id: string;
  code: string;
  status: 'pending' | 'consumed' | 'expired';
  expires_at: string;
  analysis_id: string | null;
};

export type MappedPracticeAnalysis = {
  id: string;
  createdAt: string;
  platformLabel: string;
  sessionPlayedAt: string | null;
  sessionNotes: string | null;
  status: PracticeAnalysisStatus;
  errorMessage: string | null;
  clubs: ClubSummary[];
  shotCount: number;
  takeaways: string[];
  tips: string[];
  csvSession: ParsedPracticeSession | null;
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

function clientForAccessToken(accessToken: string): SupabaseClient | null {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function activeClient(accessToken?: string): SupabaseClient | null {
  return accessToken ? clientForAccessToken(accessToken) : supabase;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
}

function asStatus(v: unknown): PracticeAnalysisStatus {
  if (v === 'processing' || v === 'failed' || v === 'ready') return v;
  return 'ready';
}

export function isCsvPracticeSession(stats: unknown): stats is ParsedPracticeSession {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return false;
  const o = stats as Record<string, unknown>;
  return o.schema === PRACTICE_CSV_SCHEMA && Array.isArray(o.clubs) && Array.isArray(o.shots);
}

export function mapPracticeAnalysisRow(row: PracticeAnalysisRow): MappedPracticeAnalysis {
  const csvSession = isCsvPracticeSession(row.extracted_stats) ? row.extracted_stats : null;
  const clubs = csvSession?.clubs ?? [];
  const takeaways =
    asStringArray(row.takeaways).length > 0
      ? asStringArray(row.takeaways)
      : clubs.map((c) => c.takeaway).filter((t): t is string => !!t);
  return {
    id: row.id,
    createdAt: row.created_at,
    platformLabel: row.detected_system?.trim() || row.platform?.trim() || csvSession?.platform_label || 'Practice session',
    sessionPlayedAt: row.session_played_at,
    sessionNotes: row.session_notes,
    status: asStatus(row.status),
    errorMessage: row.error_message,
    clubs,
    shotCount: csvSession?.shots.length ?? 0,
    takeaways,
    tips: asStringArray(row.tips),
    csvSession,
  };
}

export { formatMetricValue, metricLabel };

function mapRow(data: Record<string, unknown>): PracticeAnalysisRow {
  return {
    id: data.id as string,
    user_id: data.user_id as string,
    image_path: (data.image_path as string | null) ?? null,
    csv_path: (data.csv_path as string | null) ?? null,
    source: typeof data.source === 'string' ? data.source : 'csv',
    platform: (data.platform as string | null) ?? null,
    detected_system: (data.detected_system as string | null) ?? null,
    session_notes: (data.session_notes as string | null) ?? null,
    original_filename: (data.original_filename as string | null) ?? null,
    session_played_at: (data.session_played_at as string | null) ?? null,
    status: asStatus(data.status),
    error_message: (data.error_message as string | null) ?? null,
    extracted_stats: (data.extracted_stats as ParsedPracticeSession) ?? { clubs: [], shots: [] },
    takeaways: asStringArray(data.takeaways),
    tips: asStringArray(data.tips),
    created_at: data.created_at as string,
  };
}

async function authHeaderToken(accessToken?: string): Promise<string | null> {
  if (accessToken) return accessToken;
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export type GenerateImportCodeResult =
  | { success: true; code: string; codeId: string; expiresAt: string }
  | { success: false; error: string };

export async function generatePracticeImportCode(accessToken?: string): Promise<GenerateImportCodeResult> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) return { success: false, error: 'Supabase is not configured' };
  const token = await authHeaderToken(accessToken);
  if (!token) return { success: false, error: 'Not signed in' };

  const res = await fetch(`${supabaseUrl}/functions/v1/generate-practice-import-code`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const raw = await res.text().catch(() => '');
  let parsed: { success?: boolean; code?: string; code_id?: string; expires_at?: string; error?: string } = {};
  try {
    parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
  } catch {
    return { success: false, error: raw || res.statusText || 'Could not generate a code' };
  }
  if (!res.ok || !parsed.success || !parsed.code || !parsed.code_id || !parsed.expires_at) {
    return { success: false, error: parsed.error ?? raw ?? res.statusText ?? 'Could not generate a code' };
  }
  return { success: true, code: parsed.code, codeId: parsed.code_id, expiresAt: parsed.expires_at };
}

export async function fetchPracticeImportCode(
  codeId: string,
  accessToken?: string
): Promise<{ data: PracticeImportCodeRow | null; error?: string }> {
  const client = activeClient(accessToken);
  if (!client) return { data: null, error: 'Supabase is not configured' };
  const { data, error } = await client
    .from('practice_import_codes')
    .select('id, code, status, expires_at, analysis_id')
    .eq('id', codeId)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: 'Code not found' };
  const status = data.status === 'consumed' || data.status === 'expired' ? data.status : 'pending';
  return {
    data: {
      id: data.id as string,
      code: data.code as string,
      status,
      expires_at: data.expires_at as string,
      analysis_id: (data.analysis_id as string | null) ?? null,
    },
  };
}

export function subscribePracticeImport(params: {
  userId: string;
  codeId: string;
  accessToken?: string;
  onChange: () => void;
}): () => void {
  const client = activeClient(params.accessToken);
  if (!client) return () => undefined;
  const channels: RealtimeChannel[] = [];
  const codeCh = client
    .channel(`practice-import-code:${params.codeId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'practice_import_codes', filter: `id=eq.${params.codeId}` },
      () => params.onChange()
    )
    .subscribe();
  channels.push(codeCh);
  const analysisCh = client
    .channel(`practice-import-analysis:${params.userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'practice_analyses', filter: `user_id=eq.${params.userId}` },
      () => params.onChange()
    )
    .subscribe();
  channels.push(analysisCh);
  return () => {
    for (const ch of channels) void client.removeChannel(ch);
  };
}

export async function listPracticeAnalyses(params?: {
  accessToken?: string;
  limit?: number;
}): Promise<{ data: PracticeAnalysisListItem[]; error?: string }> {
  const limit = params?.limit ?? 40;
  const client = activeClient(params?.accessToken);
  if (!client) return { data: [], error: 'Supabase is not configured' };

  const { data, error } = await client
    .from('practice_analyses')
    .select(
      'id, detected_system, platform, session_notes, session_played_at, status, created_at, takeaways, tips'
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return { data: [], error: error.message };
  const rows = (data ?? []).map((r) => ({
    id: r.id as string,
    detected_system: (r.detected_system as string | null) ?? null,
    platform: (r.platform as string | null) ?? null,
    session_notes: (r.session_notes as string | null) ?? null,
    session_played_at: (r.session_played_at as string | null) ?? null,
    status: asStatus(r.status),
    created_at: r.created_at as string,
    takeaways: asStringArray(r.takeaways),
    tips: asStringArray(r.tips),
  }));
  return { data: rows };
}

export async function fetchPracticeAnalysis(
  id: string,
  accessToken?: string
): Promise<{ data: PracticeAnalysisRow | null; error?: string }> {
  const client = activeClient(accessToken);
  if (!client) return { data: null, error: 'Supabase is not configured' };

  const { data, error } = await client.from('practice_analyses').select('*').eq('id', id).maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: 'Analysis not found' };
  return { data: mapRow(data as Record<string, unknown>) };
}

export async function deletePracticeAnalysis(
  id: string,
  accessToken?: string
): Promise<{ error?: string }> {
  const client = activeClient(accessToken);
  if (!client) return { error: 'Supabase is not configured' };

  const { data: row, error: fetchErr } = await client
    .from('practice_analyses')
    .select('id, image_path, csv_path')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!row) return { error: 'Analysis not found' };

  const { error: delRowErr } = await client.from('practice_analyses').delete().eq('id', id);
  if (delRowErr) return { error: delRowErr.message };

  const csvPath = row.csv_path as string | null;
  const imagePath = row.image_path as string | null;
  if (csvPath) {
    await client.storage.from(CSV_BUCKET).remove([csvPath]);
  }
  if (imagePath) {
    await client.storage.from('practice-analysis-images').remove([imagePath]);
  }
  return {};
}
