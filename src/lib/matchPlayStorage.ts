/**
 * Upload sim settings screenshot for Match Play (private bucket `match-settings`).
 * Path: `{matchId}/{userId}/{filename}` per RLS migration 022.
 *
 * React Native: `fetch(fileUri).blob()` often yields 0 bytes for local `file://` assets.
 * On native we read via `FileSystem.readAsStringAsync` with base64, then decode to `ArrayBuffer`.
 * On web we use `fetch().arrayBuffer()`.
 *
 * Note: In expo-file-system v19+, `readAsStringAsync` on the main `expo-file-system` entry throws
 * (deprecated stub). The working API lives on the `expo-file-system/legacy` subpath; we import
 * `* as FileSystem` from there so `FileSystem.readAsStringAsync` is the real implementation.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

const BUCKET = 'match-settings';
/** Signed URL TTL stored in DB so challengers/opponents can view without separate download API. */
const SIGNED_URL_SEC = 60 * 60 * 24 * 365;
const STORAGE_FILE_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;
const TARGET_UPLOAD_BYTES = STORAGE_FILE_SIZE_LIMIT_BYTES - 128 * 1024;
const IMAGE_PROCESSING_FAILED_MESSAGE = 'Could not process that photo. Please choose a different screenshot.';
const IMAGE_TOO_LARGE_MESSAGE =
  'That photo is still too large after compression. Please choose a smaller screenshot.';
const JPEG_UPLOAD_PRESETS = [
  { maxDimension: 2200, compress: 0.82 },
  { maxDimension: 1800, compress: 0.72 },
  { maxDimension: 1440, compress: 0.62 },
  { maxDimension: 1280, compress: 0.52 },
  { maxDimension: 1080, compress: 0.42 },
  { maxDimension: 900, compress: 0.34 },
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

/** Storage API calls with a user JWT when the singleton Supabase client has no session (native Google OAuth). */
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
  if (!Number.isFinite(originalMaxDimension) || originalMaxDimension <= 0) {
    return [];
  }
  if (originalMaxDimension <= maxDimension) {
    return [];
  }
  return width >= height ? [{ resize: { width: maxDimension } }] : [{ resize: { height: maxDimension } }];
}

function friendlyUploadErrorMessage(message: string, mimeType?: string | null): string {
  const lower = message.toLowerCase();
  if (
    lower.includes('image/heic') ||
    lower.includes('image/heif') ||
    lower.includes('mime type not supported') ||
    lower.includes('unsupported image format')
  ) {
    return IMAGE_PROCESSING_FAILED_MESSAGE;
  }
  if (lower.includes('object exceeded maximum allowed size') || lower.includes('payload too large')) {
    return IMAGE_TOO_LARGE_MESSAGE;
  }
  return message;
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
  console.log('[matchPlayStorage] read uri', uri);

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    const res = await fetch(uri);
    if (!res.ok) {
      throw new Error(`Could not read image (${res.status})`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) {
      throw new Error('Image is empty');
    }
    return buf;
  }

  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    if (!res.ok) {
      throw new Error(`Could not read image (${res.status})`);
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) {
      throw new Error('Image is empty');
    }
    return buf;
  }

  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  console.log('[matchPlayStorage] readAsStringAsync base64 length', b64.length);
  const buf = base64ToArrayBuffer(b64);
  if (buf.byteLength === 0) {
    throw new Error('Image file is empty');
  }
  return buf;
}

async function prepareImageForUpload(localUri: string): Promise<{
  body: ArrayBuffer;
  contentType: 'image/jpeg';
  ext: 'jpg';
}> {
  const probe = await ImageManipulator.manipulateAsync(localUri, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  for (const preset of JPEG_UPLOAD_PRESETS) {
    const result = await ImageManipulator.manipulateAsync(
      localUri,
      resizeActionsForMaxDimension(probe.width, probe.height, preset.maxDimension),
      {
        compress: preset.compress,
        format: ImageManipulator.SaveFormat.JPEG,
      }
    );
    const body = await readLocalImageBytes(result.uri);
    console.log('[matchPlayStorage] prepared image byteLength', body.byteLength, preset);
    if (body.byteLength <= TARGET_UPLOAD_BYTES) {
      return {
        body,
        contentType: 'image/jpeg',
        ext: 'jpg',
      };
    }
  }

  throw new Error(IMAGE_TOO_LARGE_MESSAGE);
}

export async function uploadMatchSettingsScreenshot(params: {
  matchId: string;
  userId: string;
  localUri: string;
  mimeType?: string | null;
  /** Native Google OAuth: JWT for Storage + PostgREST (singleton client may have no session). */
  accessToken?: string;
}): Promise<{ signedUrl: string; path: string } | { error: string }> {
  const storage = params.accessToken
    ? storageClientForAccessToken(params.accessToken)
    : supabase;
  if (!storage) return { error: 'Supabase is not configured' };
  const ext = 'jpg';
  const path = `${params.matchId}/${params.userId}/settings.${ext}`;

  try {
    const prepared = await prepareImageForUpload(params.localUri);
    const body = prepared.body;
    console.log('[matchPlayStorage] upload body byteLength', body.byteLength);
    const { error: upErr } = await storage.storage.from(BUCKET).upload(path, body, {
      upsert: true,
      contentType: prepared.contentType,
    });
    if (upErr) {
      console.warn('[matchPlayStorage] upload', upErr.message);
      return { error: friendlyUploadErrorMessage(upErr.message, params.mimeType) };
    }

    const { data: signed, error: signErr } = await storage.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_SEC);
    if (signErr || !signed?.signedUrl) {
      console.warn('[matchPlayStorage] sign', signErr?.message);
      return { error: signErr?.message ?? 'Could not create file URL' };
    }

    return { signedUrl: signed.signedUrl, path };
  } catch (e) {
    console.log('[matchPlayStorage] catch', e);
    const msg =
      e instanceof Error && e.message ? friendlyUploadErrorMessage(e.message, params.mimeType) : 'Upload failed';
    console.warn('[matchPlayStorage]', msg);
    return { error: msg };
  }
}
