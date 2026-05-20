/**
 * Match play bracket helpers
 * Run: npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bracketRoundLabel,
  buildBracketViewModel,
  isBracketPlayerCount,
  MATCH_PLAY_BRACKET_SIZE_ERROR,
} from '../matchPlayBracket';
import type { BracketEntry } from '../matchPlayBracket';
import type { DbLeagueMatchPairingRow } from '../matchPlayPairingTypes';

const entries: BracketEntry[] = [
  { id: 'e1', user_id: 'u1', bracket_seed: 1 },
  { id: 'e2', user_id: 'u2', bracket_seed: 2 },
];

function pairing(partial: Partial<DbLeagueMatchPairingRow> & Pick<DbLeagueMatchPairingRow, 'id'>): DbLeagueMatchPairingRow {
  return {
    league_id: 'l',
    player_1_entry_id: 'e1',
    player_2_entry_id: 'e2',
    status: 'scheduled',
    winner_entry_id: null,
    holes_won_p1: 0,
    holes_won_p2: 0,
    holes_halved: 0,
    scheduled_at: null,
    completed_at: null,
    created_at: '',
    bracket_round: 'final',
    bracket_slot: 0,
    ...partial,
  };
}

describe('bracket player count', () => {
  it('allows 2, 3, 4, 8 only', () => {
    assert.equal(isBracketPlayerCount(2), true);
    assert.equal(isBracketPlayerCount(5), false);
    assert.ok(MATCH_PLAY_BRACKET_SIZE_ERROR.includes('2, 3, 4, or 8'));
  });
});

describe('bracketRoundLabel', () => {
  it('labels rounds', () => {
    assert.equal(bracketRoundLabel('semifinal'), 'Semifinals');
    assert.equal(bracketRoundLabel('final'), 'Final');
  });
});

describe('buildBracketViewModel', () => {
  it('marks current round and my match', () => {
    const pairings = [
      pairing({ id: 'p1', bracket_round: 'r1', status: 'scheduled' }),
      pairing({ id: 'p2', bracket_round: 'final', bracket_slot: 0, status: 'scheduled' }),
    ];
    const vm = buildBracketViewModel({
      pairings,
      entries,
      displayNames: { u1: 'Alice', u2: 'Bob' },
      currentBracketRound: 'r1',
      myEntryId: 'e1',
      playerCount: 4,
    });
    assert.equal(vm.currentRoundLabel, 'Round 1');
    const r1 = vm.sections.find((s) => s.round === 'r1');
    assert.ok(r1?.isCurrent);
    assert.ok(r1?.pairings[0]?.isMine);
  });

  it('shows champion from final', () => {
    const pairings = [
      pairing({
        id: 'f',
        status: 'complete',
        winner_entry_id: 'e1',
      }),
    ];
    const vm = buildBracketViewModel({
      pairings,
      entries,
      displayNames: { u1: 'Alice', u2: 'Bob' },
      currentBracketRound: 'final',
      myEntryId: null,
      playerCount: 2,
    });
    assert.equal(vm.championName, 'Alice');
  });
});
