/**
 * Upload final scorecard screenshots for Match Play verification.
 * Path: `{matchId}/{userId}/scorecard.jpg` in bucket `match-scorecards`.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

const BUCKET = 'match-scorecards';
const SIGNED_URL_SEC = 60 * 60 * 24 * 365;
const STORAGE_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;
const TARGET_UPLOAD_BYTES = STORAGE_FILE_SIZE_LIMIT_BYTES - 128 * 1024;
const JPEG_UPLOAD_PRESETS = [
  { maxDimension: 2200, compress: 0.82 },
  { maxDimension: 1800, compress: 0.72 },
  { maxDimension: 1440, compress: 0.62 },
  { maxDimension: 1280, compress: 0.52 },
] as const;

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

export async function uploadMatchScorecardScreenshot(params: {
  matchId: string;
  userId: string;
  localUri: string;
  accessToken?: string;
}): Promise<{ signedUrl: string; path: string } | { error: string }> {
  const storage = params.accessToken ? storageClientForAccessToken(params.accessToken) : supabase;
  if (!storage) return { error: 'Supabase is not configured' };

  const path = `${params.matchId}/${params.userId}/scorecard.jpg`;

  try {
    const body = await prepareImageForUpload(params.localUri);
    const { error: upErr } = await storage.storage.from(BUCKET).upload(path, body, {
      upsert: true,
      contentType: 'image/jpeg',
    });
    if (upErr) return { error: upErr.message };

    const { data: signed, error: signErr } = await storage.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_SEC);
    if (signErr || !signed?.signedUrl) {
      return { error: signErr?.message ?? 'Could not create file URL' };
    }
    return { signedUrl: signed.signedUrl, path };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Upload failed' };
  }
}
