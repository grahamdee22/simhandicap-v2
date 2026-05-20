import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { scoreToParStyle } from '../../lib/handicap';
import { colors } from '../../lib/constants';
import type { LeagueFormat } from '../../lib/leagues';
import type { TournamentHoleInput } from '../../lib/tournamentHoleScores';
import { sumGrossFromHoles } from '../../lib/tournamentHoleScores';
import {
  compareMatchPlayGrossHoles,
  computeMatchPlayRunningScore,
  countComparedMatchPlayHoles,
  formatMatchPlayStatus,
} from '../../lib/matchPlayTournament';

type Props = {
  format: LeagueFormat;
  pars: number[];
  holes: TournamentHoleInput[];
  onChangeHole: (holeNumber: number, patch: Partial<TournamentHoleInput>) => void;
  teamScoreLabel?: string;
  /** Match play: opponent gross scores for live comparison when available */
  opponentHoles?: TournamentHoleInput[] | null;
};

function cellColors(gross: number | null | undefined, par: number): { bg: string; border: string } {
  if (gross == null || !Number.isFinite(gross)) {
    return { bg: colors.surface, border: colors.pillBorder };
  }
  const st = scoreToParStyle(gross, par);
  switch (st) {
    case 'eagle_plus':
      return { bg: '#1a5c3e', border: '#1a5c3e' };
    case 'birdie':
      return { bg: '#d8f3dc', border: colors.sage };
    case 'bogey':
      return { bg: '#fde8e8', border: '#e8a8a8' };
    case 'double_plus':
      return { bg: '#e8b4b4', border: '#c45c5c' };
    default:
      return { bg: colors.surface, border: colors.pillBorder };
  }
}

function HoleRow({
  label,
  startHole,
  count,
  totalLabel,
  format,
  pars,
  holes,
  onChangeHole,
  teamScoreLabel,
}: {
  label: string;
  startHole: number;
  count: number;
  totalLabel: string;
  format: LeagueFormat;
  pars: number[];
  holes: TournamentHoleInput[];
  onChangeHole: (holeNumber: number, patch: Partial<TournamentHoleInput>) => void;
  teamScoreLabel?: string;
}) {
  const indices = Array.from({ length: count }, (_, i) => startHole + i);
  const totalGross = indices.reduce((s, idx) => {
    const g = holes[idx]?.gross_score;
    return g != null && Number.isFinite(g) ? s + g : s;
  }, 0);
  const anyGross = indices.some((idx) => holes[idx]?.gross_score != null);

  return (
    <View style={styles.rowWrap}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={styles.rowTotal}>
          {totalLabel}: {anyGross ? totalGross : '—'}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {indices.map((idx) => {
          const holeNum = idx + 1;
          const par = pars[idx] ?? 4;
          const hole = holes[idx];
          const colorsForCell = cellColors(hole?.gross_score, par);

          return (
            <View key={holeNum} style={styles.cell}>
              <Text style={styles.holeNum}>{holeNum}</Text>
              <Text style={styles.par}>Par {par}</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colorsForCell.bg,
                    borderColor: colorsForCell.border,
                    color:
                      colorsForCell.bg === '#1a5c3e' || colorsForCell.bg === '#c45c5c'
                        ? '#fff'
                        : colors.ink,
                  },
                ]}
                keyboardType="number-pad"
                maxLength={2}
                value={hole?.gross_score != null ? String(hole.gross_score) : ''}
                onChangeText={(t) => {
                  const n = parseInt(t.replace(/\D/g, ''), 10);
                  onChangeHole(holeNum, {
                    gross_score: t.trim() === '' ? null : Number.isFinite(n) ? n : null,
                    is_team_score: format === 'scramble',
                  });
                }}
                placeholder="—"
                placeholderTextColor={colors.subtle}
              />
            </View>
          );
        })}
      </ScrollView>
      {teamScoreLabel && format === 'scramble' ? (
        <Text style={styles.teamNote}>{teamScoreLabel}</Text>
      ) : null}
    </View>
  );
}

export function TournamentHoleScorecard({
  format,
  pars,
  holes,
  onChangeHole,
  teamScoreLabel,
  opponentHoles,
}: Props) {
  const grandTotal = sumGrossFromHoles(holes);

  const matchComparison = useMemo(() => {
    if (format !== 'match_play' || !opponentHoles?.length) return null;
    return compareMatchPlayGrossHoles(holes, opponentHoles);
  }, [format, holes, opponentHoles]);

  const matchSummary = useMemo(() => {
    if (format !== 'match_play') return null;
    if (matchComparison && countComparedMatchPlayHoles(holes, opponentHoles ?? []) > 0) {
      return matchComparison.summary;
    }
    const fromResults = computeMatchPlayRunningScore(holes);
    if (fromResults.wins + fromResults.losses + fromResults.halved > 0) return fromResults;
    return null;
  }, [format, holes, opponentHoles, matchComparison]);

  const throughHoles = useMemo(() => {
    if (format !== 'match_play') return 0;
    if (opponentHoles?.length) {
      return countComparedMatchPlayHoles(holes, opponentHoles);
    }
    return holes.filter((h) => h.result != null).length;
  }, [format, holes, opponentHoles]);

  const matchStatusText = useMemo(() => {
    if (format !== 'match_play') return null;
    if (matchSummary && throughHoles > 0) {
      return formatMatchPlayStatus(matchSummary, throughHoles);
    }
    const filled = holes.filter((h) => h.gross_score != null).length;
    if (filled > 0 && !opponentHoles?.length) {
      return 'Submit your scorecard — match status updates when your opponent submits.';
    }
    return null;
  }, [format, matchSummary, throughHoles, holes, opponentHoles]);

  return (
    <View style={styles.card}>
      {matchStatusText ? <Text style={styles.matchStatus}>{matchStatusText}</Text> : null}
      <HoleRow
        label="Front 9"
        startHole={0}
        count={9}
        totalLabel="Out"
        format={format}
        pars={pars}
        holes={holes}
        onChangeHole={onChangeHole}
        teamScoreLabel={teamScoreLabel}
      />
      <HoleRow
        label="Back 9"
        startHole={9}
        count={9}
        totalLabel="In"
        format={format}
        pars={pars}
        holes={holes}
        onChangeHole={onChangeHole}
      />
      <View style={styles.grandTotal}>
        <Text style={styles.grandLbl}>Total</Text>
        <Text style={styles.grandVal}>{grandTotal ?? '—'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
    gap: 14,
  },
  matchStatus: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.header,
    textAlign: 'center',
  },
  rowWrap: { gap: 8 },
  rowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowTitle: { fontSize: 12, fontWeight: '700', color: colors.sage, textTransform: 'uppercase' },
  rowTotal: { fontSize: 13, fontWeight: '600', color: colors.ink },
  scroll: { gap: 8, paddingVertical: 4 },
  cell: {
    width: 72,
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  holeNum: { fontSize: 11, fontWeight: '700', color: colors.ink },
  par: { fontSize: 10, color: colors.muted, marginBottom: 4 },
  input: {
    width: 44,
    height: 36,
    borderWidth: 1,
    borderRadius: 8,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
  },
  teamNote: {
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
  },
  grandTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  grandLbl: { fontSize: 14, fontWeight: '700', color: colors.ink },
  grandVal: { fontSize: 18, fontWeight: '700', color: colors.header },
});
