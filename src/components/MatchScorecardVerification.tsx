import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from '../lib/constants';
import { showAppAlert } from '../lib/alertCompat';
import {
  matchReadyToFinalize,
  playerIsVerified,
  playerVerificationUiState,
  verificationNotesMessage,
  verificationStatusEmoji,
  verificationStatusLabel,
  type ScorecardVerificationUiState,
} from '../lib/matchVerification';
import type { DbMatchRow } from '../lib/matchPlay';
import { resolveMatchAccessToken, updateMatchById } from '../lib/matchPlay';
import { uploadMatchScorecardScreenshot } from '../lib/matchScorecardStorage';
import { settingsScreenshotPickerOptions } from '../lib/settingsScreenshotPicker';
import { invokeScorecardVerification } from '../lib/scorecardVerification';
import { loggedGrossTotalForPlayer, matchHoleNumbers } from '../lib/matchStrokeMath';
import type { DbMatchHoleRow } from '../lib/matchPlay';

/** Stripped from production builds via `__DEV__` (same pattern as settings screenshot skip). */
const ALLOW_DEV_VERIFY_BYPASS = __DEV__;

type Props = {
  match: DbMatchRow;
  holes: DbMatchHoleRow[];
  userId: string;
  isPlayer1: boolean;
  accessToken?: string;
  onVerified: () => void;
};

export function MatchScorecardVerification({
  match,
  holes,
  userId,
  isPlayer1,
  accessToken,
  onVerified,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [devBypassBusy, setDevBypassBusy] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);

  const uiState: ScorecardVerificationUiState = playerVerificationUiState(match, isPlayer1);
  const verified = playerIsVerified(match, isPlayer1);
  const holeNums = matchHoleNumbers(match);
  const loggedGross = loggedGrossTotalForPlayer(holes, userId, holeNums);
  const notesMsg = verificationNotesMessage(
    isPlayer1 ? match.p1_verification_notes : match.p2_verification_notes
  );

  const bearer = useCallback(
    async () => accessToken ?? (await resolveMatchAccessToken()) ?? undefined,
    [accessToken]
  );

  const patchVerificationFields = useCallback(
    async (fields: {
      screenshotUrl: string;
      notes: string;
      verified: boolean;
    }) => {
      const patch = isPlayer1
        ? {
            p1_screenshot_url: fields.screenshotUrl,
            p1_verification_notes: fields.notes,
            p1_verified: fields.verified,
          }
        : {
            p2_screenshot_url: fields.screenshotUrl,
            p2_verification_notes: fields.notes,
            p2_verified: fields.verified,
          };
      return updateMatchById(match.id, patch, await bearer());
    },
    [isPlayer1, match.id, bearer]
  );

  const onPickAndVerify = useCallback(async () => {
    if (busy || verified) return;
    const pickerOpts = settingsScreenshotPickerOptions();
    let perm = await ImagePicker.getMediaLibraryPermissionsAsync(false);
    if (!perm.granted) perm = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
    if (!perm.granted) {
      showAppAlert('Photos access needed', 'Allow photo library access to upload your scorecard screenshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync(pickerOpts);
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setPreviewUri(asset.uri);
    setBusy(true);

    const tok = await bearer();
    const up = await uploadMatchScorecardScreenshot({
      matchId: match.id,
      userId,
      localUri: asset.uri,
      accessToken: tok,
    });
    if ('error' in up) {
      setBusy(false);
      showAppAlert('Upload failed', up.error);
      return;
    }

    const pendingPatch = await patchVerificationFields({
      screenshotUrl: up.signedUrl,
      notes: 'pending',
      verified: false,
    });
    if (pendingPatch.error) {
      setBusy(false);
      showAppAlert('Could not save screenshot', pendingPatch.error);
      return;
    }

    const ai = await invokeScorecardVerification(match.id, tok);
    setBusy(false);

    if (ai.error && !ai.verified) {
      showAppAlert('Verification unavailable', ai.error);
      onVerified();
      return;
    }

    if (ai.verified) {
      showAppAlert('Scorecard verified', 'Your score matches the screenshot. Waiting for your opponent to verify.');
      onVerified();
      return;
    }

    showAppAlert(
      'Verification failed',
      ai.notes || 'The score on your screenshot does not match what you logged. Re-enter scores or upload a clearer image.'
    );
    onVerified();
  }, [busy, verified, match.id, userId, bearer, patchVerificationFields, onVerified]);

  const onDevBypassVerify = useCallback(async () => {
    if (!ALLOW_DEV_VERIFY_BYPASS || busy || devBypassBusy || verified) return;
    setDevBypassBusy(true);
    const notes = JSON.stringify({
      status: 'verified',
      message: 'Dev bypass: scorecard marked verified without AI review.',
      dev_bypass: true,
    });
    const patch = isPlayer1
      ? { p1_verified: true, p1_verification_notes: notes }
      : { p2_verified: true, p2_verification_notes: notes };
    const res = await updateMatchById(match.id, patch, await bearer());
    setDevBypassBusy(false);
    if (res.error) {
      showAppAlert('Dev bypass failed', res.error);
      return;
    }
    onVerified();
  }, [busy, devBypassBusy, verified, isPlayer1, match.id, bearer, onVerified]);

  if (!match.verification_required) return null;

  const oppVerified = isPlayer1 ? match.p2_verified : match.p1_verified;

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Scorecard verification required</Text>
      <Text style={styles.body}>
        Upload a screenshot of your sim&apos;s final scorecard. We&apos;ll verify your logged gross
        {loggedGross != null ? ` (${loggedGross})` : ''} matches the image before this match can finish.
      </Text>

      <View style={styles.statusRow}>
        <Text style={styles.statusEmoji}>{verificationStatusEmoji(uiState)}</Text>
        <View style={styles.statusTxtCol}>
          <Text style={styles.statusLabel}>{verificationStatusLabel(uiState)}</Text>
          {notesMsg && uiState === 'failed' ? (
            <Text style={styles.statusNotes}>{notesMsg}</Text>
          ) : null}
          {busy ? <Text style={styles.statusNotes}>Analyzing screenshot…</Text> : null}
        </View>
      </View>

      {previewUri && !verified ? (
        <Image source={{ uri: previewUri }} style={styles.preview} resizeMode="contain" />
      ) : null}

      {!verified ? (
        <>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed, busy && styles.btnDisabled]}
            disabled={busy || devBypassBusy}
            onPress={() => void onPickAndVerify()}
            accessibilityRole="button"
            accessibilityLabel="Upload scorecard screenshot for verification"
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnTxt}>
                {uiState === 'failed' ? 'Resubmit scorecard screenshot' : 'Upload scorecard screenshot'}
              </Text>
            )}
          </Pressable>
          {ALLOW_DEV_VERIFY_BYPASS ? (
            <Pressable
              style={({ pressed }) => [
                styles.devBypassBtn,
                pressed && styles.devBypassBtnPressed,
                (busy || devBypassBusy) && styles.btnDisabled,
              ]}
              disabled={busy || devBypassBusy}
              onPress={() => void onDevBypassVerify()}
              accessibilityRole="button"
              accessibilityLabel="Mark scorecard verified without AI, development only"
            >
              {devBypassBusy ? (
                <ActivityIndicator size="small" color="#9a5a00" />
              ) : (
                <Text style={styles.devBypassBtnTxt}>DEV ONLY · Mark verified (skip AI)</Text>
              )}
            </Pressable>
          ) : null}
        </>
      ) : (
        <Text style={styles.doneHint}>
          {matchReadyToFinalize(match)
            ? 'Both players verified — match will finalize shortly.'
            : oppVerified
              ? 'You are verified. Waiting for your opponent.'
              : 'You are verified. Waiting for your opponent to submit their scorecard.'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.forestDeep,
  },
  body: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 6,
    lineHeight: 18,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
  },
  statusEmoji: { fontSize: 22, lineHeight: 26 },
  statusTxtCol: { flex: 1, minWidth: 0 },
  statusLabel: { fontSize: 14, fontWeight: '700', color: colors.ink },
  statusNotes: { fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 17 },
  preview: {
    width: '100%',
    height: 140,
    marginTop: 12,
    borderRadius: 8,
    backgroundColor: colors.bg,
  },
  btn: {
    marginTop: 14,
    backgroundColor: colors.header,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnPressed: { opacity: 0.9 },
  btnDisabled: { opacity: 0.65 },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
  doneHint: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.accentDark,
    marginTop: 12,
    lineHeight: 18,
  },
  devBypassBtn: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d97706',
    backgroundColor: '#fffbeb',
    alignItems: 'center',
  },
  devBypassBtnPressed: { opacity: 0.9 },
  devBypassBtnTxt: { fontSize: 12, fontWeight: '700', color: '#9a5a00' },
});
