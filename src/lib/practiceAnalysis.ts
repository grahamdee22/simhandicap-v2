/**
 * Practice Analyzer client: upload screenshot, invoke Claude edge function, list/detail/delete.
 * Separate from rounds / handicap index — never writes to public.rounds.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import {
  normalizePracticeAnalysisPayload,
  type NormalizedPracticeAnalysis,
  type PracticeExtractedStats,
} from './practiceAnalysisNormalize';

const BUCKET = 'practice-analysis-images';
const SIGNED_URL_SEC = 60 * 60 * 24 * 7;
const STORAGE_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;
const TARGET_UPLOAD_BYTES = STORAGE_FILE_SIZE_LIMIT_BYTES - 128 * 1024;
const JPEG_UPLOAD_PRESETS = [
  { maxDimension: 2200, compress: 0.82 },
  { maxDimension: 1800, compress: 0.72 },
  { maxDimension: 1440, compress: 0.62 },
  { maxDimension: 1280, compress: 0.52 },
] as const;

export type PracticeAnalysisRow = {
  id: string;
  user_id: string;
  image_path: string;
  detected_system: string | null;
  session_notes: string | null;
  extracted_stats: PracticeExtractedStats | Record<string, unknown>;
  takeaways: string[];
  tips: string[];
  created_at: string;
};

export type PracticeAnalysisListItem = Pick<
  PracticeAnalysisRow,
  'id' | 'detected_system' | 'session_notes' | 'created_at' | 'takeaways' | 'tips'
>;

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

function storageClientForAccessToken(accessToken: string) {
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

function resizeActionsForMaxDimension(width: number, height: number, maxDimension: number) {
  const originalMaxDimension = Math.max(width, height);
  if (!Number.isFinite(originalMaxDimension) || originalMaxDimension <= 0) return [];
  if (originalMaxDimension <= maxDimension) return [];
  return width >= height ? [{ resize: { width: maxDimension } }] : [{ resize: { height: maxDimension } }];
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const atobFn = globalThis.atob;
  if (typeof atobFn !== 'function') {
    throw new Error('base64 decode is not available in this environment');
  }
  const binaryString = atobFn(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function readLocalImageBytes(uri: string): Promise<ArrayBuffer> {
  if (uri.startsWith('http://') || uri.startsWith('https://') || Platform.OS === 'web') {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`Could not read image (${res.status})`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) throw new Error('Image is empty');
    return buf;
  }
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const buf = base64ToArrayBuffer(b64);
  if (buf.byteLength === 0) throw new Error('Image file is empty');
  return buf;
}

async function prepareImageForUpload(localUri: string): Promise<ArrayBuffer> {
  const probe = await ImageManipulator.manipulateAsync(localUri, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  for (const preset of JPEG_UPLOAD_PRESETS) {
    const result = await ImageManipulator.manipulateAsync(
      localUri,
      resizeActionsForMaxDimension(probe.width, probe.height, preset.maxDimension),
      { compress: preset.compress, format: ImageManipulator.SaveFormat.JPEG }
    );
    const body = await readLocalImageBytes(result.uri);
    if (body.byteLength <= TARGET_UPLOAD_BYTES) return body;
  }
  throw new Error('Photo is still too large after compression. Choose a smaller screenshot.');
}

function randomId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
}

export function mapPracticeAnalysisRow(row: PracticeAnalysisRow): NormalizedPracticeAnalysis & {
  id: string;
  imagePath: string;
  createdAt: string;
} {
  const normalized = normalizePracticeAnalysisPayload({
    detected_system: row.detected_system,
    session_notes: row.session_notes,
    extracted_stats: row.extracted_stats,
    takeaways: row.takeaways,
    tips: row.tips,
  });
  return {
    ...normalized,
    takeaways: asStringArray(row.takeaways).length ? asStringArray(row.takeaways) : normalized.takeaways,
    tips: asStringArray(row.tips).length ? asStringArray(row.tips) : normalized.tips,
    id: row.id,
    imagePath: row.image_path,
    createdAt: row.created_at,
  };
}

export async function uploadPracticeAnalysisImage(params: {
  userId: string;
  localUri: string;
  accessToken?: string;
}): Promise<{ path: string; signedUrl: string } | { error: string }> {
  const storage = params.accessToken ? storageClientForAccessToken(params.accessToken) : supabase;
  if (!storage) return { error: 'Supabase is not configured' };

  const path = `${params.userId}/${randomId()}.jpg`;
  try {
    const body = await prepareImageForUpload(params.localUri);
    const { error: upErr } = await storage.storage.from(BUCKET).upload(path, body, {
      upsert: false,
      contentType: 'image/jpeg',
    });
    if (upErr) return { error: upErr.message };

    const { data: signed, error: signErr } = await storage.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_SEC);
    if (signErr || !signed?.signedUrl) {
      return { error: signErr?.message ?? 'Could not create file URL' };
    }
    return { path, signedUrl: signed.signedUrl };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Upload failed' };
  }
}

export type InvokeAnalyzePracticeResult =
  | { success: true; analysisId: string }
  | { success: false; error: string };

export async function invokeAnalyzePractice(params: {
  imagePath: string;
  imageUrl: string;
  accessToken?: string;
}): Promise<InvokeAnalyzePracticeResult> {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRestConfig();
  if (!supabaseUrl || !supabaseAnonKey) return { success: false, error: 'Supabase is not configured' };

  let token = params.accessToken;
  if (!token && supabase) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token;
  }
  if (!token) return { success: false, error: 'Not signed in' };

  const res = await fetch(`${supabaseUrl}/functions/v1/analyze-practice`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_path: params.imagePath,
      image_url: params.imageUrl,
    }),
  });

  const raw = await res.text().catch(() => '');
  let parsed: { success?: boolean; analysis_id?: string; error?: string } = {};
  try {
    parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
  } catch {
    return { success: false, error: raw || res.statusText || 'Analysis failed' };
  }

  if (!res.ok || !parsed.success || !parsed.analysis_id) {
    return { success: false, error: parsed.error ?? raw ?? res.statusText ?? 'Analysis failed' };
  }
  return { success: true, analysisId: parsed.analysis_id };
}

export async function listPracticeAnalyses(params?: {
  accessToken?: string;
  limit?: number;
}): Promise<{ data: PracticeAnalysisListItem[]; error?: string }> {
  const limit = params?.limit ?? 40;
  const client = params?.accessToken ? storageClientForAccessToken(params.accessToken) : supabase;
  if (!client) return { data: [], error: 'Supabase is not configured' };

  const { data, error } = await client
    .from('practice_analyses')
    .select('id, detected_system, session_notes, created_at, takeaways, tips')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return { data: [], error: error.message };
  const rows = (data ?? []).map((r) => ({
    id: r.id as string,
    detected_system: (r.detected_system as string | null) ?? null,
    session_notes: (r.session_notes as string | null) ?? null,
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
  const client = accessToken ? storageClientForAccessToken(accessToken) : supabase;
  if (!client) return { data: null, error: 'Supabase is not configured' };

  const { data, error } = await client.from('practice_analyses').select('*').eq('id', id).maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: 'Analysis not found' };

  return {
    data: {
      id: data.id as string,
      user_id: data.user_id as string,
      image_path: data.image_path as string,
      detected_system: (data.detected_system as string | null) ?? null,
      session_notes: (data.session_notes as string | null) ?? null,
      extracted_stats: (data.extracted_stats as PracticeExtractedStats) ?? { summary: [], shots: [] },
      takeaways: asStringArray(data.takeaways),
      tips: asStringArray(data.tips),
      created_at: data.created_at as string,
    },
  };
}

export async function createPracticeAnalysisSignedUrl(
  imagePath: string,
  accessToken?: string
): Promise<{ url: string | null; error?: string }> {
  const client = accessToken ? storageClientForAccessToken(accessToken) : supabase;
  if (!client) return { url: null, error: 'Supabase is not configured' };
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(imagePath, SIGNED_URL_SEC);
  if (error || !data?.signedUrl) return { url: null, error: error?.message ?? 'Could not load image' };
  return { url: data.signedUrl };
}

export async function deletePracticeAnalysis(
  id: string,
  accessToken?: string
): Promise<{ error?: string }> {
  const client = accessToken ? storageClientForAccessToken(accessToken) : supabase;
  if (!client) return { error: 'Supabase is not configured' };

  const { data: row, error: fetchErr } = await client
    .from('practice_analyses')
    .select('id, image_path')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!row) return { error: 'Analysis not found' };

  const path = row.image_path as string;
  const { error: delRowErr } = await client.from('practice_analyses').delete().eq('id', id);
  if (delRowErr) return { error: delRowErr.message };

  if (path) {
    await client.storage.from(BUCKET).remove([path]);
  }
  return {};
}
