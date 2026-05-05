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
import { Platform } from 'react-native';
import { supabase } from './supabase';

const BUCKET = 'match-settings';
/** Signed URL TTL stored in DB so challengers/opponents can view without separate download API. */
const SIGNED_URL_SEC = 60 * 60 * 24 * 365;

function extFromMime(mime: string | null | undefined): string {
  if (!mime) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
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

export async function uploadMatchSettingsScreenshot(params: {
  matchId: string;
  userId: string;
  localUri: string;
  mimeType?: string | null;
}): Promise<{ signedUrl: string; path: string } | { error: string }> {
  if (!supabase) return { error: 'Supabase is not configured' };

  const ext = extFromMime(params.mimeType);
  const path = `${params.matchId}/${params.userId}/settings.${ext}`;
  const contentType = params.mimeType?.startsWith('image/')
    ? params.mimeType
    : ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : 'image/jpeg';

  try {
    const body = await readLocalImageBytes(params.localUri);
    console.log('[matchPlayStorage] upload body byteLength', body.byteLength);
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, body, {
      upsert: true,
      contentType,
    });
    if (upErr) {
      console.warn('[matchPlayStorage] upload', upErr.message);
      return { error: upErr.message };
    }

    const { data: signed, error: signErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_SEC);
    if (signErr || !signed?.signedUrl) {
      console.warn('[matchPlayStorage] sign', signErr?.message);
      return { error: signErr?.message ?? 'Could not create file URL' };
    }

    return { signedUrl: signed.signedUrl, path };
  } catch (e) {
    console.log('[matchPlayStorage] catch', e);
    const msg = e instanceof Error ? e.message : 'Upload failed';
    console.warn('[matchPlayStorage]', msg);
    return { error: msg };
  }
}
