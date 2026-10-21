import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentWidth } from '../../src/components/ContentWidth';
import { useAuth } from '../../src/auth/AuthContext';
import { useTranslation } from '../../src/i18n';
import { colors } from '../../src/lib/constants';
import { useResponsive } from '../../src/lib/responsive';
import {
  adminUpdateCustomCourseTee,
  fetchCustomCourseBackfillCandidates,
  fetchCustomCoursesForAdmin,
  type BackfillCandidate,
  type CustomCourseRow,
} from '../../src/lib/customCourses';
import { showAppAlert } from '../../src/lib/alertCompat';

const ADMIN_EMAIL = 'simcapadmin@gmail.com';

export default function AdminCustomCoursesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const { user } = useAuth();
  const router = useRouter();
  const email = (user?.email ?? '').trim().toLowerCase();
  const isAdmin = email === ADMIN_EMAIL;

  const [courses, setCourses] = useState<CustomCourseRow[]>([]);
  const [backfill, setBackfill] = useState<BackfillCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, { rating: string; slope: string }>>({});

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setBusy(true);
    try {
      const [c, b] = await Promise.all([
        fetchCustomCoursesForAdmin(),
        fetchCustomCourseBackfillCandidates(),
      ]);
      setCourses(c);
      setBackfill(b);
    } finally {
      setBusy(false);
    }
  }, [isAdmin]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!isAdmin) {
    return (
      <ContentWidth bg={colors.bg}>
        <View style={[styles.denied, { padding: gutter }]}>
          <Text style={styles.deniedTxt}>{t('adminCustom.denied')}</Text>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.link}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </ContentWidth>
    );
  }

  return (
    <ContentWidth bg={colors.bg}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: 16,
          paddingBottom: insets.bottom + 32,
        }}
      >
        <Text style={styles.title}>{t('adminCustom.title')}</Text>
        <Text style={styles.sub}>{t('adminCustom.sub')}</Text>

        <Text style={styles.section}>{t('adminCustom.backfill')}</Text>
        {busy && !backfill.length ? <ActivityIndicator color={colors.accent} /> : null}
        {backfill.map((row) => (
          <View key={row.name_normalized} style={styles.card}>
            <Text style={styles.cardTitle}>{row.sample_name}</Text>
            <Text style={styles.cardMeta}>
              {t('adminCustom.backfillMeta', {
                creators: row.creator_count,
                courses: row.course_count,
                unrated: row.default_unrated_tees,
                reported: row.user_reported_tees,
              })}
            </Text>
          </View>
        ))}

        <Text style={[styles.section, { marginTop: 24 }]}>{t('adminCustom.editPromote')}</Text>
        {courses.map((course) => (
          <View key={course.id} style={styles.card}>
            <Text style={styles.cardTitle}>{course.name}</Text>
            {course.course_tees.map((tee) => {
              const edit = edits[tee.id] ?? {
                rating: String(tee.rating),
                slope: String(tee.slope),
              };
              return (
                <View key={tee.id || tee.name} style={styles.teeRow}>
                  <Text style={styles.teeName}>
                    {tee.name} · {tee.rating_source}
                  </Text>
                  <View style={styles.inputs}>
                    <TextInput
                      style={styles.input}
                      value={edit.rating}
                      onChangeText={(v) =>
                        setEdits((prev) => ({
                          ...prev,
                          [tee.id]: { ...edit, rating: v },
                        }))
                      }
                      keyboardType="decimal-pad"
                      placeholder="CR"
                      placeholderTextColor={colors.subtle}
                    />
                    <TextInput
                      style={styles.input}
                      value={edit.slope}
                      onChangeText={(v) =>
                        setEdits((prev) => ({
                          ...prev,
                          [tee.id]: { ...edit, slope: v },
                        }))
                      }
                      keyboardType="number-pad"
                      placeholder="Slope"
                      placeholderTextColor={colors.subtle}
                    />
                    <Pressable
                      style={styles.promoteBtn}
                      onPress={() => {
                        void (async () => {
                          if (!tee.id) return;
                          const rating = parseFloat(edit.rating.replace(/,/g, '.'));
                          const slope = parseFloat(edit.slope.replace(/,/g, '.'));
                          const result = await adminUpdateCustomCourseTee({
                            teeId: tee.id,
                            rating,
                            slope,
                            promoteToCurated: true,
                          });
                          if ('error' in result) {
                            showAppAlert(t('adminCustom.promoteFailed'), result.error);
                            return;
                          }
                          showAppAlert(t('adminCustom.promoted'), t('adminCustom.promotedBody'));
                          void load();
                        })();
                      }}
                    >
                      <Text style={styles.promoteTxt}>{t('adminCustom.promote')}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  denied: { flex: 1, justifyContent: 'center', gap: 12 },
  deniedTxt: { fontSize: 15, color: colors.muted },
  link: { fontSize: 15, fontWeight: '700', color: colors.accent },
  title: { fontSize: 22, fontWeight: '700', color: colors.ink },
  sub: { fontSize: 13, color: colors.muted, marginTop: 6, marginBottom: 16, lineHeight: 18 },
  section: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.subtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  cardMeta: { fontSize: 12, color: colors.muted, marginTop: 4 },
  teeRow: { marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  teeName: { fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 8 },
  inputs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  input: {
    width: 72,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.ink,
  },
  promoteBtn: {
    backgroundColor: colors.header,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  promoteTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
