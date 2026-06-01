/** Compact roster line for standings / manage lists (avoids huge comma lists). */
export function formatTeamMemberSummary(memberNames: string[], maxShown = 3): string {
  const names = memberNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length <= maxShown) return names.join(', ');
  return `${names.slice(0, maxShown).join(', ')} +${names.length - maxShown} more`;
}
