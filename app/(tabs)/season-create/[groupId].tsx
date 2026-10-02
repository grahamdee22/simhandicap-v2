import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth/AuthContext';
import { ContentWidth } from '../../../src/components/ContentWidth';
import { DatePlayedField } from '../../../src/components/DatePlayedField';
import { showAppAlert } from '../../../src/lib/alertCompat';
import { colors } from '../../../src/lib/constants';
import { todayLocalYmd } from '../../../src/lib/dates';
import { googleOAuthAccessToken } from '../../../src/lib/googleOAuthAccessToken';
import { useResponsive } from '../../../src/lib/responsive';
import { resolveSocialGroupsAccessToken } from '../../../src/lib/socialGroups';
import { createSeason } from '../../../src/lib/seasons';
import { useAppStore } from '../../../src/store/useAppStore';

export default function SeasonCreateScreen() {
  const { groupId: rawGroupId } = useLocalSearchParams<{ groupId: string | string[] }>();
  const groupId = typeof rawGroupId === 'string' ? rawGroupId : rawGroupId?.[0] ?? '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user } = useAuth();
  const groups = useAppStore((s) => s.groups);
  const group = useMemo(() => groups.find((g) => g.id === groupId), [groups, groupId]);

  const [name, setName] = useState('');
  const [startDateYmd, setStartDateYmd] = useState(todayLocalYmd);
  const [openEnded, setOpenEnded] = useState(true);
  const [endDateYmd, setEndDateYmd] = useState(todayLocalYmd);
  const [everyEventCounts, setEveryEventCounts] = useState(true);
  const [eventsThatCount, setEventsThatCount] = useState(6);
  const [busy, setBusy] = useState(false);

  const onSave = async () => {
    if (!user?.id || !group) return;
    const trimmed = name.trim();
    if (!trimmed) {
      showAppAlert('Season name', 'Give this season a name.');
      return;
    }
    if (!openEnded && endDateYmd < startDateYmd) {
      showAppAlert('Dates', 'The end date has to be on or after the start date.');
      return;
    }
    setBusy(true);
    const accessToken =
      googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
    const res = await createSeason(
      {
        groupId,
        name: trimmed,
        startDate: startDateYmd,
        endDate: openEnded ? null : endDateYmd,
        eventsThatCount: everyEventCounts ? null : eventsThatCount,
        createdBy: user.id,
      },
      accessToken
    );
    setBusy(false);
    if (res.error || !res.data) {
      showAppAlert('Could not start season', res.error ?? 'Try again.');
      return;
    }
    router.replace(`/(tabs)/season/${res.data.id}` as never);
  };

  return (
    <ContentWidth bg={colors.surface}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingTop: 16,
            paddingBottom: insets.bottom + 32,
          }}
        >
          <Text style={styles.head}>Start a season</Text>
          <Text style={styles.helper}>
            A season ties this crew’s tournaments together and awards points for where each player
            finishes. One season can be active at a time.
          </Text>
          <Text style={styles.lbl}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Summer 2026"
            placeholderTextColor={colors.subtle}
            maxLength={80}
          />
          <DatePlayedField
            label="Start date"
            hint={null}
            large
            value={startDateYmd}
            onChange={setStartDateYmd}
          />
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLbl}>Open-ended</Text>
            <Switch
              value={openEnded}
              onValueChange={setOpenEnded}
              trackColor={{ false: colors.pillBorder, true: colors.sage }}
              thumbColor={Platform.OS === 'android' ? colors.surface : undefined}
              ios_backgroundColor={colors.pillBorder}
            />
          </View>
          {openEnded ? null : (
            <DatePlayedField
              label="End date"
              hint={null}
              large
              value={endDateYmd}
              onChange={setEndDateYmd}
            />
          )}
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLbl}>Every event counts</Text>
            <Switch
              value={everyEventCounts}
              onValueChange={setEveryEventCounts}
              trackColor={{ false: colors.pillBorder, true: colors.sage }}
              thumbColor={Platform.OS === 'android' ? colors.surface : undefined}
              ios_backgroundColor={colors.pillBorder}
            />
          </View>
          {everyEventCounts ? (
            <Text style={styles.helper}>Every finished tournament in the season adds its points.</Text>
          ) : (
            <>
              <Text style={styles.lbl}>Events that count</Text>
              <View style={styles.stepperRow}>
                <Pressable
                  style={styles.stepperBtn}
                  onPress={() => setEventsThatCount((n) => Math.max(1, n - 1))}
                >
                  <Text style={styles.stepperBtnTxt}>−</Text>
                </Pressable>
                <Text style={styles.stepperVal}>{eventsThatCount}</Text>
                <Pressable
                  style={styles.stepperBtn}
                  onPress={() => setEventsThatCount((n) => Math.min(52, n + 1))}
                >
                  <Text style={styles.stepperBtnTxt}>+</Text>
                </Pressable>
              </View>
              <Text style={styles.helper}>
                Best {eventsThatCount} finishes count. A skipped tournament is left out, not scored
                as zero.
              </Text>
            </>
          )}
          <Pressable
            style={[styles.primaryBtn, busy && styles.btnDisabled]}
            disabled={busy}
            onPress={() => void onSave()}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnTxt}>Start season</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  head: { fontSize: 22, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  helper: { fontSize: 13, color: colors.muted, lineHeight: 18, marginBottom: 12 },
  lbl: { fontSize: 13, fontWeight: '700', color: colors.ink, marginBottom: 6, marginTop: 8 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.ink,
    marginBottom: 12,
    backgroundColor: colors.bg,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 12,
  },
  toggleLbl: { fontSize: 15, fontWeight: '600', color: colors.ink, flex: 1, paddingRight: 12 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 8 },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stepperBtnTxt: { fontSize: 20, color: colors.ink, fontWeight: '600' },
  stepperVal: { fontSize: 20, fontWeight: '700', color: colors.ink, minWidth: 28, textAlign: 'center' },
  primaryBtn: {
    marginTop: 16,
    backgroundColor: colors.header,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.6 },
});
