/**
 * Upload sim settings screenshot for Match Play (private bucket `match-settings`).
 * Path: `{matchId}/{userId}/{filename}` per RLS migration 022.
 */

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
    const res = await fetch(params.localUri);
    const blob = await res.blob();
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
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
    const msg = e instanceof Error ? e.message : 'Upload failed';
    console.warn('[matchPlayStorage]', msg);
    return { error: msg };
  }
}
