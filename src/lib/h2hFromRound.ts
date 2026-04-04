import type { HeadToHead, SimRound } from '../store/useAppStore';

export function formatRoundMeta(r: SimRound): string {
  const wind =
    r.wind === 'off' ? 'No wind' : r.wind === 'light' ? 'Light wind' : 'Wind';
  const put =
    r.putting === 'auto_2putt'
      ? 'Auto 2-putt'
      : r.putting === 'gimme_5'
        ? 'Gimme <5ft'
        : 'Putt everything';
  const pin =
    r.pin === 'thu' ? 'Thu' : r.pin === 'fri' ? 'Fri' : r.pin === 'sat' ? 'Sat' : 'Sun';
  return `${r.platform} · ${put} · ${pin} · ${wind}`;
}

/** Build a Social “head-to-head” row from a round where only your score is logged. */
export function headToHeadFromLoggedRound(r: SimRound, displayName: string): HeadToHead | null {
  if (!r.h2hGroupId || !r.h2hOpponentMemberId) return null;
  const first = displayName.trim().split(/\s+/)[0] ?? 'You';
  const opp = (r.h2hOpponentDisplayName ?? 'Friend').replace(/\s*\(you\)\s*$/i, '').trim();
  return {
    id: `round-${r.id}`,
    courseName: r.courseName,
    playedAt: r.playedAt,
    left: { name: first, gross: r.grossScore, net: null, won: false },
    right: { name: opp, gross: null, net: null, won: false },
    conditionsLine: formatRoundMeta(r),
  };
}
