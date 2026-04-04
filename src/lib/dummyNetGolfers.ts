import type { PlatformId } from './constants';

export type DummyNetGolfer = {
  id: string;
  displayName: string;
  initials: string;
  index: number;
  platform: PlatformId;
};

/** Demo roster for Net calculator picker (replace with API later). */
export const DUMMY_NET_GOLFERS: DummyNetGolfer[] = [
  { id: 'g1', displayName: 'Graham D.', initials: 'GD', index: 10.8, platform: 'Trackman' },
  { id: 'g2', displayName: 'John S.', initials: 'JS', index: 3.5, platform: 'Foresight' },
  { id: 'g3', displayName: 'Mike R.', initials: 'MR', index: 6.2, platform: 'Full Swing' },
  { id: 'g4', displayName: 'Dan K.', initials: 'DK', index: 1.8, platform: 'Trackman' },
  { id: 'g5', displayName: 'Tom C.', initials: 'TC', index: 8.4, platform: 'E6' },
  { id: 'g6', displayName: 'Steve P.', initials: 'SP', index: 12.1, platform: 'GSPro' },
  { id: 'g7', displayName: 'Jake M.', initials: 'JM', index: 4.2, platform: 'Trackman' },
  { id: 'g8', displayName: 'Chris B.', initials: 'CB', index: 7.7, platform: 'Foresight' },
  { id: 'g9', displayName: 'Alex T.', initials: 'AT', index: 5.5, platform: 'E6' },
];

const byId = new Map(DUMMY_NET_GOLFERS.map((g) => [g.id, g]));

export function dummyGolferById(id: string): DummyNetGolfer | undefined {
  return byId.get(id);
}
