import type { PlatformId } from './constants';

/** Roster row for Crew Match Calculator / GolferPickerModal (`id` is Supabase `auth.users` id). */
export type NetPickerGolfer = {
  id: string;
  displayName: string;
  initials: string;
  index: number | null;
  platform: PlatformId;
};
