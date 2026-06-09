import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors } from '../lib/constants';
import {
  buildBracketViewModel,
  type BracketRoundSection,
} from '../lib/matchPlayBracket';
import type { DbLeagueEntryRow } from '../lib/leagues';
import type {
  BracketRound,
  DbLeagueMatchPairingRow,
} from '../lib/matchPlayTournamentPairings';

type Props = {
  leagueId: string;
  pairings: DbLeagueMatchPairingRow[];
  entries: DbLeagueEntryRow[];
  displayNames: Record<string, string>;
  currentBracketRound: BracketRound | null;
  myEntryId: string | null;
  playerCount: number;
};

function RoundSection({
  section,
  defaultCollapsed,
  onOpenPairing,
}: {
  section: BracketRoundSection;
  defaultCollapsed: boolean;
  onOpenPairing: (pairingId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <View style={[styles.roundBlock, section.isCurrent && styles.roundBlockCurrent]}>
      <Pressable
        style={styles.roundHead}
        onPress={() => setCollapsed((c) => !c)}
        accessibilityRole="button"
      >
        <Text style={[styles.roundTitle, section.isCurrent && styles.roundTitleCurrent]}>
          {section.label}
          {section.isCurrent ? ' · current' : ''}
        </Text>
        <Text style={styles.collapseHint}>{collapsed ? 'Show' : 'Hide'}</Text>
      </Pressable>
      {!collapsed ? (
        <View style={styles.cardsCol}>
          {section.pairings.map((card) => (
            <Pressable
              key={card.pairing.id}
              style={[styles.matchCard, card.isMine && styles.matchCardMine]}
              onPress={() => {
                if (card.pairing.id) onOpenPairing(card.pairing.id);
              }}
            >
              {card.isMine ? <Text style={styles.yourMatch}>Your match</Text> : null}
              <Text style={styles.matchNames}>
                {card.seed1 != null ? `(#${card.seed1}) ` : ''}
                {card.name1}
                {' vs. '}
                {card.seed2 != null ? `(#${card.seed2}) ` : ''}
                {card.name2}
              </Text>
              <View style={styles.statusRow}>
                <Text style={styles.statusBadge}>{card.statusLabel}</Text>
                {card.resultLine ? (
                  <Text style={styles.resultLine} numberOfLines={2}>
                    {card.resultLine}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function MatchPlayBracketSection({
  leagueId,
  pairings,
  entries,
  displayNames,
  currentBracketRound,
  myEntryId,
  playerCount,
}: Props) {
  const router = useRouter();

  const vm = useMemo(
    () =>
      buildBracketViewModel({
        pairings,
        entries,
        displayNames,
        currentBracketRound,
        myEntryId,
        playerCount,
      }),
    [pairings, entries, displayNames, currentBracketRound, myEntryId, playerCount]
  );

  const onOpenPairing = (pairingId: string) => {
    router.push({
      pathname: '/(tabs)/league-match/[pairingId]',
      params: { pairingId, leagueId },
    } as never);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.currentRound}>{vm.currentRoundLabel}</Text>

      {vm.showBye && vm.byeSeed1Name ? (
        <View style={styles.byeCard}>
          <Text style={styles.byeTitle}>Bye — Final</Text>
          <Text style={styles.byeLine}>
            #{1} {vm.byeSeed1Name} advances to the Final after Round 1.
          </Text>
        </View>
      ) : null}

      {vm.championName ? (
        <View style={styles.championCard}>
          <Text style={styles.championEmoji}>🏆</Text>
          <Text style={styles.championName}>{vm.championName}</Text>
          <Text style={styles.championSub}>Tournament champion</Text>
        </View>
      ) : null}

      {vm.sections.map((section) => (
        <RoundSection
          key={section.round}
          section={section}
          defaultCollapsed={!section.isCurrent && section.pairings.every((c) => !c.isMine)}
          onOpenPairing={onOpenPairing}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, marginBottom: 16 },
  currentRound: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.header,
    textAlign: 'center',
  },
  byeCard: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
  },
  byeTitle: { fontSize: 12, fontWeight: '700', color: colors.sage, textTransform: 'uppercase' },
  byeLine: { fontSize: 14, color: colors.ink, marginTop: 6, lineHeight: 20 },
  championCard: {
    alignItems: 'center',
    backgroundColor: '#f0f7f3',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sage,
    padding: 16,
  },
  championEmoji: { fontSize: 32 },
  championName: { fontSize: 18, fontWeight: '700', color: colors.ink, marginTop: 6 },
  championSub: { fontSize: 13, color: colors.muted, marginTop: 4 },
  roundBlock: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  roundBlockCurrent: {
    borderColor: colors.sage,
    borderWidth: 1.5,
  },
  roundHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.bg,
  },
  roundTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  roundTitleCurrent: { color: colors.header },
  collapseHint: { fontSize: 12, fontWeight: '600', color: colors.sage },
  cardsCol: { gap: 8, padding: 10, backgroundColor: colors.surface },
  matchCard: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  matchCardMine: {
    borderColor: colors.sage,
    backgroundColor: '#f0f7f3',
  },
  yourMatch: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.accentDark,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  matchNames: { fontSize: 15, fontWeight: '600', color: colors.ink, lineHeight: 20 },
  statusRow: { marginTop: 8, gap: 4 },
  statusBadge: { fontSize: 12, fontWeight: '600', color: colors.muted },
  resultLine: { fontSize: 13, color: colors.ink, lineHeight: 18 },
});
