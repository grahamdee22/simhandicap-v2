import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ContentWidth } from '../../src/components/ContentWidth';
import { colors } from '../../src/lib/constants';
import {
  fetchMatchPlayerDisplayNames,
  listMyMatches,
  type DbMatchRow,
} from '../../src/lib/matchPlay';
import { useResponsive } from '../../src/lib/responsive';
import { isSupabaseConfigured } from '../../src/lib/supabase';

function formatHoles(m: DbMatchRow): string {
  if (m.holes === 18) return '18 holes';
  if (m.nine_selection === 'front') return 'Front 9';
  if (m.nine_selection === 'back') return 'Back 9';
  return `${m.holes} holes`;
}

function historyStatusLine(m: DbMatchRow): string {
  if (m.status === 'complete') return 'Complete';
  if (m.status === 'abandoned') return 'Abandoned';
  return m.status;
}

export default function MatchHistoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gutter } = useResponsive();
  const supabaseOn = isSupabaseConfigured();

  const [rows, setRows] = useState<DbMatchRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseOn) {
      setLoading(false);
      setErr('Supabase not configured.');
      setRows([]);
      return;
    }
    setLoading(true);
    setErr(null);
    const res = await listMyMatches();
    if (res.error || res.data == null) {
      setErr(res.error ?? 'Could not load matches.');
      setRows([]);
      setLoading(false);
      return;
    }
    const hist = res.data
      .filter((m) => m.status === 'complete' || m.status === 'abandoned')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setRows(hist);
    setNames(await fetchMatchPlayerDisplayNames(hist));
    setLoading(false);
  }, [supabaseOn]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const nameFor = (id: string | null) => (id ? names[id] ?? 'Golfer' : '—');

  if (!supabaseOn) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.centered, { padding: gutter }]}>
          <Text style={styles.muted}>Supabase not configured.</Text>
        </View>
      </ContentWidth>
    );
  }

  if (loading) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.centered, { padding: gutter }]}>
          <ActivityIndicator color={colors.header} />
        </View>
      </ContentWidth>
    );
  }

  if (err) {
    return (
      <ContentWidth bg={colors.surface}>
        <View style={[styles.centered, { padding: gutter }]}>
          <Text style={styles.muted}>{err}</Text>
        </View>
      </ContentWidth>
    );
  }

  return (
    <ContentWidth bg={colors.surface}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: 16,
          paddingBottom: insets.bottom + 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lead}>
          Completed and abandoned stroke-play matches, newest first. Tap a row for details.
        </Text>
        {rows.length === 0 ? (
          <Text style={styles.empty}>No completed or abandoned matches yet.</Text>
        ) : (
          rows.map((m) => {
            const p1 = nameFor(m.player_1_id);
            const p2 = m.player_2_id ? nameFor(m.player_2_id) : '—';
            const peopleLine = m.player_2_id ? `${p1} vs ${p2}` : `${p1}`;
            return (
              <Pressable
                key={m.id}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => router.push(`/(tabs)/match-results/${m.id}` as never)}
                accessibilityRole="button"
                accessibilityLabel={`Match on ${m.course_name}, ${historyStatusLine(m)}`}
              >
                <Text style={styles.course} numberOfLines={1}>
                  {m.course_name}
                </Text>
                <Text style={styles.meta}>
                  {historyStatusLine(m)} · {formatHoles(m)} · Stroke play
                </Text>
                <Text style={styles.people} numberOfLines={2}>
                  {peopleLine}
                </Text>
                <Text style={styles.hint}>Tap for results</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </ContentWidth>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', minHeight: 200 },
  muted: { fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 21 },
  lead: { fontSize: 13, color: colors.muted, lineHeight: 19, marginBottom: 14 },
  empty: { fontSize: 14, color: colors.subtle, lineHeight: 20, paddingVertical: 12 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  cardPressed: { opacity: 0.92 },
  course: { fontSize: 15, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 17 },
  people: { fontSize: 12, color: colors.subtle, marginTop: 6, lineHeight: 16 },
  hint: { fontSize: 11, fontWeight: '600', color: colors.accent, marginTop: 10 },
});
