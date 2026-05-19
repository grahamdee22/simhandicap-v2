import type { DbLeagueRow } from './leagues';

export type TournamentSectionCacheEntry = {
  leagues: DbLeagueRow[];
  previewTop3: { name: string; rank: number }[];
};

const cacheByGroupId = new Map<string, TournamentSectionCacheEntry>();

export function getTournamentSectionCache(groupId: string): TournamentSectionCacheEntry | undefined {
  return cacheByGroupId.get(groupId);
}

export function setTournamentSectionCache(groupId: string, entry: TournamentSectionCacheEntry): void {
  cacheByGroupId.set(groupId, entry);
}
