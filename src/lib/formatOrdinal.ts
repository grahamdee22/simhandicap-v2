/**
 * Localized ordinal place labels for tournament standings / banners.
 * English: 1st, 2nd, 3rd, 4th…
 * Spanish: 1.º, 2.º, 3.º… (masculine ordinal abbreviation common in sports)
 * Korean: 1위, 2위…
 */
export function formatOrdinalPlace(n: number, language?: string | null): string {
  if (!Number.isFinite(n) || n < 1) return String(n);
  const rank = Math.floor(n);
  const lng = (language ?? 'en').split('-')[0]?.toLowerCase() ?? 'en';

  if (lng === 'es') {
    return `${rank}.º`;
  }
  if (lng === 'ko') {
    return `${rank}위`;
  }

  // English (default fallback)
  const mod100 = rank % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}
