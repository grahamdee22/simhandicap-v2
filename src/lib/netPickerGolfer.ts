import type { PlatformId } from './constants';

/** Roster row for Net calculator / GolferPickerModal (`id` is Supabase `auth.users` id). */
export type NetPickerGolfer = {
  id: string;
  displayName: string;
  initials: string;
  index: number | null;
  platform: PlatformId;
};
