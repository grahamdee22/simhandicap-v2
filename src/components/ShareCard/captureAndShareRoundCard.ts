import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { showAppAlert } from '../../lib/alertCompat';
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from './types';

export async function captureAndShareRoundCard(
  viewRef: RefObject<View | null>
): Promise<{ ok: boolean; error?: string }> {
  if (!viewRef.current) {
    return { ok: false, error: 'Share card is not ready yet.' };
  }

  try {
    const uri = await captureRef(viewRef, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
      width: SHARE_CARD_WIDTH,
      height: SHARE_CARD_HEIGHT,
    });

    if (Platform.OS === 'web') {
      // Best-effort web: open image in a new tab so the user can save/share manually.
      if (typeof window !== 'undefined') {
        window.open(uri, '_blank', 'noopener,noreferrer');
      }
      return { ok: true };
    }

    const available = await Sharing.isAvailableAsync();
    if (!available) {
      return { ok: false, error: 'Sharing is not available on this device.' };
    }

    const fileUri = uri.startsWith('file://') ? uri : `file://${uri}`;
    await Sharing.shareAsync(fileUri, {
      mimeType: 'image/png',
      dialogTitle: 'Share your SimCap round',
      UTI: 'public.png',
    });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not share this round.';
    return { ok: false, error: message };
  }
}

export function alertShareFailure(error?: string) {
  showAppAlert('Share', error ?? 'Could not share this round.');
}
