import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '../i18n';
import { colors } from '../lib/constants';
import { useKeyboardBottomInset } from '../lib/useKeyboardBottomInset';
import {
  createCustomCourse,
  type CustomCourseRow,
  type CustomTeeInput,
} from '../lib/customCourses';
import { DEFAULT_UNRATED_SLOPE } from '../lib/ratingSource';
import { showAppAlert } from '../lib/alertCompat';

type TeeDraft = {
  key: string;
  name: string;
  par: string;
  yards: string;
  knowOfficial: boolean;
  rating: string;
  slope: string;
};

function emptyTee(key: string): TeeDraft {
  return {
    key,
    name: '',
    par: '72',
    yards: '',
    knowOfficial: false,
    rating: '',
    slope: '',
  };
}

type Props = {
  visible: boolean;
  userId: string;
  initialName?: string;
  onClose: () => void;
  onCreated: (course: CustomCourseRow) => void;
};

export function CustomCourseCreateModal({
  visible,
  userId,
  initialName = '',
  onClose,
  onCreated,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const keyboardBottomInset = useKeyboardBottomInset();
  const [name, setName] = useState(initialName);
  const [tees, setTees] = useState<TeeDraft[]>([emptyTee('t0')]);
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setName(initialName);
    setTees([emptyTee('t0')]);
    setBusy(false);
  }, [initialName]);

  const close = () => {
    Keyboard.dismiss();
    reset();
    onClose();
  };

  const updateTee = (key: string, patch: Partial<TeeDraft>) => {
    setTees((prev) => prev.map((tee) => (tee.key === key ? { ...tee, ...patch } : tee)));
  };

  const onSave = async () => {
    if (busy) return;
    const teeInputs: CustomTeeInput[] = [];
    for (const tee of tees) {
      const par = parseInt(tee.par.replace(/,/g, '').trim(), 10);
      const yardsRaw = tee.yards.replace(/,/g, '').trim();
      const yards = yardsRaw ? parseInt(yardsRaw, 10) : null;
      teeInputs.push({
        name: tee.name.trim() || 'White',
        par,
        yards: yards != null && Number.isFinite(yards) ? yards : null,
        ratingRaw: tee.knowOfficial ? tee.rating : '',
        slopeRaw: tee.knowOfficial ? tee.slope : '',
      });
    }

    setBusy(true);
    try {
      const result = await createCustomCourse({
        name: name.trim() || initialName.trim(),
        tees: teeInputs,
        userId,
      });
      if ('error' in result) {
        showAppAlert(t('log.round.customCourse.alerts.createTitle'), result.error);
        return;
      }
      onCreated(result.course);
      reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType={Platform.OS === 'web' ? 'none' : 'slide'}
      transparent
      onRequestClose={close}
      onShow={() => {
        setName(initialName);
        setTees([emptyTee('t0')]);
      }}
    >
      <View
        style={[
          styles.modalRoot,
          { paddingBottom: keyboardBottomInset > 0 ? keyboardBottomInset : 0 },
        ]}
      >
        <Pressable style={styles.backdrop} onPress={close} />
        <View
          style={[
            styles.sheet,
            { paddingBottom: keyboardBottomInset > 0 ? 12 : insets.bottom + 16 },
          ]}
        >
          <Text style={styles.title}>{t('log.round.customCourse.title')}</Text>
          <Text style={styles.hint}>{t('log.round.customCourse.hint')}</Text>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
          >
            <Text style={styles.label}>{t('log.round.customCourse.name')}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('log.round.customCourse.namePlaceholder')}
              placeholderTextColor={colors.subtle}
              autoCapitalize="words"
            />

            {tees.map((tee, idx) => (
              <View key={tee.key} style={styles.teeBlock}>
                <Text style={styles.teeHeading}>
                  {t('log.round.customCourse.teeN', { n: idx + 1 })}
                </Text>
                <Text style={styles.label}>{t('log.round.customCourse.teeName')}</Text>
                <TextInput
                  style={styles.input}
                  value={tee.name}
                  onChangeText={(v) => updateTee(tee.key, { name: v })}
                  placeholder={t('log.round.customCourse.teeNamePlaceholder')}
                  placeholderTextColor={colors.subtle}
                />
                <View style={styles.row}>
                  <View style={styles.half}>
                    <Text style={styles.label}>{t('log.round.customCourse.par')}</Text>
                    <TextInput
                      style={styles.input}
                      value={tee.par}
                      onChangeText={(v) => updateTee(tee.key, { par: v })}
                      keyboardType="number-pad"
                      placeholder="72"
                      placeholderTextColor={colors.subtle}
                    />
                  </View>
                  <View style={styles.half}>
                    <Text style={styles.label}>{t('log.round.customCourse.yards')}</Text>
                    <TextInput
                      style={styles.input}
                      value={tee.yards}
                      onChangeText={(v) => updateTee(tee.key, { yards: v })}
                      keyboardType="number-pad"
                      placeholder={t('log.round.customCourse.yardsOptional')}
                      placeholderTextColor={colors.subtle}
                    />
                  </View>
                </View>

                <Pressable
                  style={styles.checkRow}
                  onPress={() => updateTee(tee.key, { knowOfficial: !tee.knowOfficial })}
                >
                  <View style={[styles.checkbox, tee.knowOfficial && styles.checkboxOn]} />
                  <Text style={styles.checkTxt}>{t('log.round.customCourse.knowOfficial')}</Text>
                </Pressable>

                {tee.knowOfficial ? (
                  <View style={styles.row}>
                    <View style={styles.half}>
                      <Text style={styles.label}>{t('log.round.courseRating')}</Text>
                      <TextInput
                        style={styles.input}
                        value={tee.rating}
                        onChangeText={(v) => updateTee(tee.key, { rating: v })}
                        keyboardType="decimal-pad"
                        placeholder="72.0"
                        placeholderTextColor={colors.subtle}
                      />
                    </View>
                    <View style={styles.half}>
                      <Text style={styles.label}>{t('log.round.slope')}</Text>
                      <TextInput
                        style={styles.input}
                        value={tee.slope}
                        onChangeText={(v) => updateTee(tee.key, { slope: v })}
                        keyboardType="number-pad"
                        placeholder="130"
                        placeholderTextColor={colors.subtle}
                      />
                    </View>
                  </View>
                ) : (
                  <Text style={styles.defaultNote}>
                    {t('log.round.customCourse.defaultNote', {
                      par: tee.par.trim() || '72',
                      slope: DEFAULT_UNRATED_SLOPE,
                    })}
                  </Text>
                )}

                {tees.length > 1 ? (
                  <Pressable
                    onPress={() => setTees((prev) => prev.filter((x) => x.key !== tee.key))}
                    style={styles.removeTee}
                  >
                    <Text style={styles.removeTeeTxt}>{t('log.round.customCourse.removeTee')}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}

            <Pressable
              style={styles.addTee}
              onPress={() => setTees((prev) => [...prev, emptyTee(`t${Date.now()}`)])}
            >
              <Text style={styles.addTeeTxt}>{t('log.round.customCourse.addTee')}</Text>
            </Pressable>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable style={styles.cancelBtn} onPress={close} disabled={busy}>
              <Text style={styles.cancelTxt}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable style={styles.saveBtn} onPress={() => void onSave()} disabled={busy}>
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveTxt}>{t('log.round.customCourse.save')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '92%',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.ink },
  hint: { fontSize: 13, color: colors.muted, marginTop: 6, marginBottom: 12, lineHeight: 18 },
  scroll: { flexGrow: 0 },
  scrollContent: { paddingBottom: 8 },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.subtle,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  teeBlock: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  teeHeading: { fontSize: 14, fontWeight: '700', color: colors.header, marginBottom: 4 },
  row: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, minWidth: 0 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.pillBorder,
    backgroundColor: colors.bg,
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkTxt: { flex: 1, fontSize: 13, color: colors.ink, fontWeight: '500' },
  defaultNote: { fontSize: 12, color: colors.muted, marginTop: 8, lineHeight: 17 },
  addTee: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    alignItems: 'center',
  },
  addTeeTxt: { fontSize: 14, fontWeight: '600', color: colors.accent },
  removeTee: { marginTop: 8, alignSelf: 'flex-start' },
  removeTeeTxt: { fontSize: 13, fontWeight: '600', color: colors.danger },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  cancelTxt: { fontSize: 15, fontWeight: '600', color: colors.muted },
  saveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: colors.header,
    alignItems: 'center',
  },
  saveTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
