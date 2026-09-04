/**
 * Upload final scorecard screenshots for Match Play verification.
 * Path: `{matchId}/{userId}/scorecard.jpg` in bucket `match-scorecards`.
 *
 * TEMP DIAG (Scan Scorecard HEIC investigation): logs conversion metrics and uploads
 * `…/scorecard-diag.json` beside the JPEG. Remove once the failure is diagnosed.
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

/** Flip to false to silence temporary Scan Scorecard conversion diagnostics. */
export const SCORECARD_UPLOAD_DIAG = true;

export type ScorecardUploadDiag = {
  platform: string;
  sourceUriTail: string;
  sourceProbe: {
    width: number;
    height: number;
    uriTail: string;
    /** First ImageManipulator call = HEIC/any → JPEG re-encode via expo-image-manipulator. */
    decoder: 'expo-image-manipulator.manipulateAsync';
  };
  presetsTried: {
    maxDimension: number;
    compress: number;
    width: number;
    height: number;
    bytes: number;
    jpegMagicOk: boolean;
    magicHex: string;
  }[];
  chosen: {
    maxDimension: number;
    compress: number;
    width: number;
    height: number;
    bytes: number;
    jpegMagicOk: boolean;
    magicHex: string;
  } | null;
  uploadedPath?: string;
  diagJsonPath?: string;
  signedUrl?: string;
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

function uriTail(uri: string): string {
  const clean = uri.split('?')[0] ?? uri;
  return clean.length <= 80 ? clean : `…${clean.slice(-80)}`;
}

function jpegMagic(bytes: ArrayBuffer): { ok: boolean; magicHex: string } {
  const u8 = new Uint8Array(bytes);
  const head = u8.slice(0, 4);
  const magicHex = [...head].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const ok = u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff;
  return { ok, magicHex };
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

/**
 * HEIC/any → JPEG happens here via expo-image-manipulator (native ImageIO/UIKit on iOS).
 * First call re-encodes to JPEG; later calls resize+compress from the original URI again.
 */
async function prepareImageForUpload(localUri: string): Promise<{
  body: ArrayBuffer;
  diag: ScorecardUploadDiag;
}> {
  const diag: ScorecardUploadDiag = {
    platform: Platform.OS,
    sourceUriTail: uriTail(localUri),
    sourceProbe: {
      width: 0,
      height: 0,
      uriTail: '',
      decoder: 'expo-image-manipulator.manipulateAsync',
    },
    presetsTried: [],
    chosen: null,
  };

  if (SCORECARD_UPLOAD_DIAG) {
    console.log('[scorecard-diag] prepare start', {
      platform: Platform.OS,
      sourceUriTail: diag.sourceUriTail,
      decoder: diag.sourceProbe.decoder,
    });
  }

  // This is the HEIC → JPEG decode/re-encode step (empty actions, JPEG format).
  const probe = await ImageManipulator.manipulateAsync(localUri, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  diag.sourceProbe = {
    width: probe.width,
    height: probe.height,
    uriTail: uriTail(probe.uri),
    decoder: 'expo-image-manipulator.manipulateAsync',
  };
  if (SCORECARD_UPLOAD_DIAG) {
    console.log('[scorecard-diag] probe after HEIC/any→JPEG', diag.sourceProbe);
  }

  for (const preset of JPEG_UPLOAD_PRESETS) {
    const result = await ImageManipulator.manipulateAsync(
      localUri,
      resizeActionsForMaxDimension(probe.width, probe.height, preset.maxDimension),
      { compress: preset.compress, format: ImageManipulator.SaveFormat.JPEG }
    );
    const body = await readLocalImageBytes(result.uri);
    const magic = jpegMagic(body);
    const attempt = {
      maxDimension: preset.maxDimension,
      compress: preset.compress,
      width: result.width,
      height: result.height,
      bytes: body.byteLength,
      jpegMagicOk: magic.ok,
      magicHex: magic.magicHex,
    };
    diag.presetsTried.push(attempt);
    if (SCORECARD_UPLOAD_DIAG) {
      console.log('[scorecard-diag] preset attempt', attempt);
    }
    if (body.byteLength <= TARGET_UPLOAD_BYTES) {
      diag.chosen = attempt;
      return { body, diag };
    }
  }
  throw new Error('Photo is still too large after compression. Choose a smaller screenshot.');
}

export async function uploadMatchScorecardScreenshot(params: {
  matchId: string;
  userId: string;
  localUri: string;
  accessToken?: string;
}): Promise<
  | { signedUrl: string; path: string; diag?: ScorecardUploadDiag }
  | { error: string; diag?: ScorecardUploadDiag }
> {
  const storage = params.accessToken ? storageClientForAccessToken(params.accessToken) : supabase;
  if (!storage) return { error: 'Supabase is not configured' };

  const path = `${params.matchId}/${params.userId}/scorecard.jpg`;
  const diagJsonPath = `${params.matchId}/${params.userId}/scorecard-diag.json`;

  let diag: ScorecardUploadDiag | undefined;
  try {
    const prepared = await prepareImageForUpload(params.localUri);
    diag = prepared.diag;
    diag.uploadedPath = path;
    diag.diagJsonPath = diagJsonPath;

    const { error: upErr } = await storage.storage.from(BUCKET).upload(path, prepared.body, {
      upsert: true,
      contentType: 'image/jpeg',
    });
    if (upErr) return { error: upErr.message, diag };

    if (SCORECARD_UPLOAD_DIAG) {
      const diagJson = JSON.stringify(diag, null, 2);
      const { error: diagErr } = await storage.storage.from(BUCKET).upload(diagJsonPath, diagJson, {
        upsert: true,
        contentType: 'application/json',
      });
      if (diagErr) {
        console.warn('[scorecard-diag] diag json upload failed', diagErr.message);
      } else {
        console.log('[scorecard-diag] wrote', diagJsonPath);
      }
    }

    const { data: signed, error: signErr } = await storage.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_SEC);
    if (signErr || !signed?.signedUrl) {
      return { error: signErr?.message ?? 'Could not create file URL', diag };
    }
    diag.signedUrl = signed.signedUrl;
    if (SCORECARD_UPLOAD_DIAG) {
      console.log('[scorecard-diag] upload ok', {
        path,
        bytes: diag.chosen?.bytes,
        dims: diag.chosen ? `${diag.chosen.width}x${diag.chosen.height}` : null,
        jpegMagicOk: diag.chosen?.jpegMagicOk,
        magicHex: diag.chosen?.magicHex,
        signedUrlTail: uriTail(signed.signedUrl),
      });
    }
    return { signedUrl: signed.signedUrl, path, diag };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    if (SCORECARD_UPLOAD_DIAG) {
      console.error('[scorecard-diag] prepare/upload failed', message, diag ?? null);
    }
    return { error: message, diag };
  }
}
