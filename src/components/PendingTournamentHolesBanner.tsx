import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/constants';
import { googleOAuthAccessToken } from '../lib/googleOAuthAccessToken';
import { resolveSocialGroupsAccessToken } from '../lib/socialGroups';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  listPendingTournamentHoleRounds,
  subscribePendingTournamentHoles,
} from '../lib/tournamentHoleScores';
import type { PendingTournamentHoleRound } from '../lib/tournamentTypes';

type Props = {
  gutter: number;
};

/** Shown on main tabs when the user has incomplete tournament hole scorecards (PRD §5.2). */
export function PendingTournamentHolesBanner({ gutter }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingTournamentHoleRound[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setPending([]);
      return;
    }
    setLoading(true);
    const token = googleOAuthAccessToken ?? (await resolveSocialGroupsAccessToken()) ?? undefined;
    const res = await listPendingTournamentHoleRounds(token);
    setPending(res.data ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => subscribePendingTournamentHoles(() => void load()), [load]);

  if (loading && pending.length === 0) return null;
  if (pending.length === 0) return null;

  const first = pending[0];

  return (
    <View style={[styles.wrap, { marginHorizontal: gutter }]}>
      <Text style={styles.title}>Complete your tournament scorecard</Text>
      <Text style={styles.body}>
        {pending.length === 1
          ? `Finish hole-by-hole entry for ${first.league_name} so it counts toward standings.`
          : `You have ${pending.length} rounds waiting for hole-by-hole scores.`}
      </Text>
      <Pressable
        style={styles.btn}
        onPress={() =>
          router.push(
            `/(tabs)/tournament-holes/${first.league_round_id}?leagueId=${encodeURIComponent(first.league_id)}&leagueName=${encodeURIComponent(first.league_name)}` as never
          )
        }
        accessibilityRole="button"
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.btnTxt}>Complete scorecard</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff8e6',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e6c84a',
    padding: 14,
    marginBottom: 14,
  },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink },
  body: { fontSize: 13, color: colors.muted, marginTop: 6, lineHeight: 18 },
  btn: {
    marginTop: 12,
    backgroundColor: colors.header,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
