import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../../lib/constants';
import type { SimRound } from '../../store/useAppStore';
import { useAppStore } from '../../store/useAppStore';
import { buildShareRoundCardData } from './buildShareRoundCardData';
import { alertShareFailure, captureAndShareRoundCard } from './captureAndShareRoundCard';
import { ShareRoundCard } from './ShareRoundCard';
import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from './types';

type Props = {
  visible: boolean;
  round: SimRound | null;
  onClose: () => void;
};

export function ShareRoundCardModal({ visible, round, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const displayName = useAppStore((s) => s.displayName);
  const rounds = useAppStore((s) => s.rounds);
  const captureRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  const data = useMemo(() => {
    if (!round) return null;
    return buildShareRoundCardData(round, rounds, displayName);
  }, [round, rounds, displayName]);

  const previewWidth = Math.min(320, Platform.OS === 'web' ? 320 : 300);
  const scale = previewWidth / SHARE_CARD_WIDTH;
  const previewHeight = SHARE_CARD_HEIGHT * scale;

  const onShare = useCallback(async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const result = await captureAndShareRoundCard(captureRef);
      if (!result.ok) {
        alertShareFailure(result.error);
        return;
      }
      onClose();
    } finally {
      setSharing(false);
    }
  }, [onClose, sharing]);

  return (
    <Modal
      visible={visible && !!data}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Round complete</Text>
          <Text style={styles.sub}>Share your card, or keep browsing your rounds.</Text>

          {data ? (
            <View style={[styles.previewFrame, { width: previewWidth, height: previewHeight }]}>
              <View
                style={{
                  position: 'absolute',
                  left: (previewWidth - SHARE_CARD_WIDTH) / 2,
                  top: (previewHeight - SHARE_CARD_HEIGHT) / 2,
                  width: SHARE_CARD_WIDTH,
                  height: SHARE_CARD_HEIGHT,
                  transform: [{ scale }],
                }}
                pointerEvents="none"
              >
                <ShareRoundCard data={data} />
              </View>
            </View>
          ) : null}

          {/* Off-screen full-resolution card for capture */}
          {data ? (
            <View style={styles.offscreen} pointerEvents="none">
              <View ref={captureRef} collapsable={false}>
                <ShareRoundCard data={data} />
              </View>
            </View>
          ) : null}

          <Pressable
            style={[styles.primaryBtn, sharing && styles.btnDisabled]}
            onPress={() => void onShare()}
            disabled={sharing}
            accessibilityRole="button"
            accessibilityLabel="Share round card"
          >
            {sharing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryTxt}>Share</Text>
            )}
          </Pressable>
          <Pressable
            style={styles.secondaryBtn}
            onPress={onClose}
            disabled={sharing}
            accessibilityRole="button"
            accessibilityLabel="Not now"
          >
            <Text style={styles.secondaryTxt}>Not Now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 24, 16, 0.72)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.ink,
  },
  sub: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    marginBottom: 14,
  },
  previewFrame: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 16,
    backgroundColor: '#122A1F',
    marginBottom: 16,
  },
  offscreen: {
    position: 'absolute',
    left: -4000,
    top: 0,
  },
  primaryBtn: {
    backgroundColor: colors.header,
    borderRadius: 12,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryTxt: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryBtn: {
    marginTop: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryTxt: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.7,
  },
});
