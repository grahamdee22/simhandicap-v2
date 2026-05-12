import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { Platform } from 'react-native';
import type { PlatformId } from '../lib/constants';
import {
  adjustedDifferential,
  grossFromHoles,
  handicapIndexFromDifferentials,
  type Mulligans,
  type PinDay,
  type PuttingMode,
  type Wind,
} from '../lib/handicap';
import { COURSE_SEEDS, getCourseById, ratingForCourse, type CourseSeed } from '../lib/courses';
import {
  deleteRoundInSupabase,
  insertRoundInSupabase,
  isCloudRoundId,
  updateRoundInSupabase,
} from '../lib/rounds';
import type { GhinSnapshot } from '../lib/realVsSim';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { googleOAuthAccessToken } from '../lib/googleOAuthAccessToken';

export type SimRound = {
  id: string;
  courseId: string;
  courseName: string;
  platform: PlatformId;
  grossScore: number;
  holeScores: (number | null)[];
  putting: PuttingMode;
  pin: PinDay;
  wind: Wind;
  mulligans: Mulligans;
  playedAt: string;
  courseRating: number;
  slope: number;
  teeName?: string;
  rawDiff: number;
  adjustedDiff: number;
  difficultyModifier: number;
  indexAfter: number | null;
  indexDelta: number | null;
  /** Sim index (same as home screen `currentIndexFromRounds`) at save time; absent/null for legacy rounds. */
  simcapIndexAtTime?: number | null;
  /** Optional: logged as a head-to-head vs someone in this crew (Social tab). */
  h2hGroupId?: string;
  h2hOpponentMemberId?: string;
  h2hOpponentDisplayName?: string;
};

export type GroupMember = {
  id: string;
  /** Supabase `auth.users.id` (stable across crews). */
  userId: string;
  displayName: string;
  initials: string;
  platform: PlatformId;
  roundsLogged: number;
  /** Sim / GHIN index when known; null shows as — in UI. */
  index: number | null;
  trend: 'up' | 'down' | 'flat';
  isYou?: boolean;
};

/** Outbound in-app invite (registered user, not yet accepted). */
export type OutboundPendingInApp = { id: string; label: string };
/** Outbound email invite (no SimCap account yet). */
export type OutboundPendingEmail = { id: string; email: string };

export type FriendGroup = {
  id: string;
  name: string;
  /** Supabase `social_groups.created_by`; empty for offline mock groups. */
  createdByUserId: string;
  members: GroupMember[];
  pendingInApp?: OutboundPendingInApp[];
  pendingEmail?: OutboundPendingEmail[];
  lastRoundSummary?: string;
  headToHead?: HeadToHead[];
};

/** Pending crew invite for the signed-in user (notification / accept-decline). */
export type InboundGroupInvite = {
  id: string;
  groupId: string;
  groupName: string;
  inviterName: string;
};

export type HeadToHead = {
  id: string;
  courseName: string;
  playedAt: string;
  /** When null, UI hides the net line (e.g. you only logged your side). */
  left: { name: string; gross: number; net: number | null; won: boolean };
  right: { name: string; gross: number | null; net: number | null; won: boolean };
  conditionsLine: string;
};

function latestGhinSnapshotIndex(snapshots: GhinSnapshot[]): number | null {
  if (snapshots.length === 0) return null;
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );
  return sorted[sorted.length - 1].index;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Oldest first; stable when several rounds share the same calendar `playedAt` (noon ISO). */
function compareRoundsByPlayedAtAsc(a: SimRound, b: SimRound): number {
  const dt = new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime();
  if (dt !== 0) return dt;
  return a.id.localeCompare(b.id);
}

/** Newest first; tie-break so list order doesn’t shuffle after recalc. */
function compareRoundsByPlayedAtDesc(a: SimRound, b: SimRound): number {
  const dt = new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime();
  if (dt !== 0) return dt;
  return b.id.localeCompare(a.id);
}

export type NewRoundInput = Omit<
  SimRound,
  | 'id'
  | 'rawDiff'
  | 'adjustedDiff'
  | 'difficultyModifier'
  | 'indexAfter'
  | 'indexDelta'
  | 'simcapIndexAtTime'
>;

type AppState = {
  hydrated: boolean;
  displayName: string;
  /** Default sim platform on the Log tab (synced to Supabase profile when signed in). */
  preferredLogPlatform: PlatformId;
  rounds: SimRound[];
  groups: FriendGroup[];
  /** Server-backed pending invites to the current user (not persisted). */
  inboundGroupInvites: InboundGroupInvite[];
  pendingH2hMatchup: PendingH2hMatchup | null;
  /** Manual GHIN snapshots (e.g. monthly updates) for Real vs Sim profile chart. */
  ghinSnapshots: GhinSnapshot[];
  hydrate: () => Promise<void>;
  setDisplayName: (name: string) => void;
  setPreferredLogPlatform: (platform: PlatformId) => void;
  /** Replace rounds from Supabase (or server); recomputes differentials and index fields. */
  replaceRoundsFromRemote: (rounds: SimRound[]) => void;
  addRound: (input: NewRoundInput) => Promise<SimRound>;
  updateRound: (roundId: string, patch: Partial<SimRound>) => Promise<void>;
  deleteRound: (roundId: string) => Promise<void>;
  addGroup: (name: string) => void;
  setGroups: (groups: FriendGroup[]) => void;
  /** Remove a crew from local state (e.g. after server delete). Clears pending H2H prefill for that crew. */
  removeGroupById: (groupId: string) => void;
  setInboundGroupInvites: (invites: InboundGroupInvite[]) => void;
  recomputeGroupsFromYou: () => void;
  setPendingH2hMatchup: (p: PendingH2hMatchup | null) => void;
  recordGhinIndex: (index: number) => void;
  /** Apply server GHIN only when it differs from the latest local snapshot (avoids chart noise on refetch). */
  syncGhinFromProfileIfChanged: (index: number) => void;
};

function computeRoundMathFromRatingSlope(
  gross: number,
  courseRating: number,
  slope: number,
  putting: PuttingMode,
  pin: PinDay,
  wind: Wind,
  mulligans: Mulligans
) {
  const { raw, adjusted, modifier } = adjustedDifferential(
    gross,
    courseRating,
    slope,
    putting,
    pin,
    wind,
    mulligans
  );
  return { courseRating, slope, rawDiff: raw, adjustedDiff: adjusted, difficultyModifier: modifier };
}

function computeRoundMath(
  course: CourseSeed,
  platform: PlatformId,
  gross: number,
  putting: PuttingMode,
  pin: PinDay,
  wind: Wind,
  mulligans: Mulligans
) {
  const { rating, slope } = ratingForCourse(course, platform);
  return computeRoundMathFromRatingSlope(gross, rating, slope, putting, pin, wind, mulligans);
}

function indexBeforeNewRound(sortedRounds: SimRound[]): number | null {
  return handicapIndexFromDifferentials(sortedRounds.map((r) => r.adjustedDiff));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function initialsFrom(name: string): string {
  const p = name.trim().split(/\s+/);
  if (p.length === 0) return '??';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

/** Pre-filled head-to-head from Crew Match Calculator → Log round (not persisted). */
export type PendingH2hMatchup = {
  player1Name: string;
  player2Name: string;
  player1PlayingHcp: number;
  player2PlayingHcp: number;
  strokesPhrase: string;
  strokeHolesSummary: string;
  courseId: string;
  courseName: string;
  platform: PlatformId;
  putting: PuttingMode;
  pin: PinDay;
  wind: Wind;
  mulligans: Mulligans;
  h2hGroupId?: string;
  h2hOpponentMemberId?: string;
  h2hOpponentDisplayName?: string;
};

export function currentIndexFromRounds(rounds: SimRound[]): number | null {
  const sorted = [...rounds].sort(compareRoundsByPlayedAtAsc);
  return handicapIndexFromDifferentials(sorted.map((r) => r.adjustedDiff));
}

function groupSummaryLine(g: FriendGroup, rounds: SimRound[]): string | undefined {
  const last = rounds[0];
  if (!last) return `${g.members.length} member${g.members.length === 1 ? '' : 's'}`;
  const when = new Date(last.playedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${g.members.length} member${g.members.length === 1 ? '' : 's'} · Your last round ${when}`;
}

function syncYouInGroups(groups: FriendGroup[], displayName: string, rounds: SimRound[]): FriendGroup[] {
  const idx = currentIndexFromRounds(rounds);
  const n = rounds.length;
  const ini = initialsFrom(displayName);
  return groups.map((g) => ({
    ...g,
    lastRoundSummary: groupSummaryLine(g, rounds),
    members: [...g.members]
      .map((m) =>
        m.isYou
          ? {
              ...m,
              displayName: `${displayName} (you)`,
              initials: ini,
              index: idx ?? m.index,
              roundsLogged: n,
            }
          : m
      )
      .sort((a, b) => {
        const ai = a.index ?? 999;
        const bi = b.index ?? 999;
        return ai - bi;
      }),
  }));
}

function recalcAllRounds(rounds: SimRound[]): SimRound[] {
  const sorted = [...rounds].sort(compareRoundsByPlayedAtAsc);
  const diffsSoFar: number[] = [];
  const out: SimRound[] = [];
  const fallbackCourse = COURSE_SEEDS[0];
  for (const r of sorted) {
    const course = getCourseById(r.courseId) ?? fallbackCourse;
    const fromHoles = grossFromHoles(r.holeScores);
    const gross = fromHoles != null ? fromHoles : r.grossScore;
    const baseline = ratingForCourse(course, r.platform);
    const cr =
      typeof r.courseRating === 'number' && Number.isFinite(r.courseRating) && r.courseRating > 50
        ? r.courseRating
        : baseline.rating;
    const sl =
      typeof r.slope === 'number' && Number.isFinite(r.slope) && r.slope > 0 ? r.slope : baseline.slope;
    const math = computeRoundMathFromRatingSlope(gross, cr, sl, r.putting, r.pin, r.wind, r.mulligans);
    diffsSoFar.push(math.adjustedDiff);
    const before = handicapIndexFromDifferentials(diffsSoFar.slice(0, -1));
    const after = handicapIndexFromDifferentials(diffsSoFar);
    out.push({
      ...r,
      grossScore: gross,
      courseName: r.courseName || course.name,
      ...math,
      indexAfter: after,
      indexDelta: before != null && after != null ? round1(after - before) : null,
      simcapIndexAtTime: r.simcapIndexAtTime ?? null,
    });
  }
  return out.sort(compareRoundsByPlayedAtDesc);
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      displayName: 'Golfer',
      preferredLogPlatform: 'Trackman',
      rounds: [],
      groups: [],
      inboundGroupInvites: [],
      pendingH2hMatchup: null,
      ghinSnapshots: [],

      hydrate: async () => {
        set({ hydrated: true });
      },

      setDisplayName: (displayName) =>
        set((s) => ({
          displayName,
          groups: syncYouInGroups(s.groups, displayName, s.rounds),
        })),

      setPreferredLogPlatform: (preferredLogPlatform) => set({ preferredLogPlatform }),

      replaceRoundsFromRemote: (incoming) => {
        const full = recalcAllRounds(incoming);
        set((s) => ({
          rounds: full,
          groups: syncYouInGroups(s.groups, s.displayName, full),
        }));
      },

      addRound: async (input) => {
        const course = getCourseById(input.courseId);
        if (!course) throw new Error('Unknown course');
        const holeScores = [...input.holeScores];
        while (holeScores.length < 18) holeScores.push(null);
        const grossForMath = grossFromHoles(holeScores) ?? input.grossScore;
        const sorted = [...get().rounds].sort(compareRoundsByPlayedAtAsc);
        const before = indexBeforeNewRound(sorted);
        const baseline = ratingForCourse(course, input.platform);
        const cr =
          typeof input.courseRating === 'number' &&
          Number.isFinite(input.courseRating) &&
          input.courseRating > 50
            ? input.courseRating
            : baseline.rating;
        const sl =
          typeof input.slope === 'number' && Number.isFinite(input.slope) && input.slope > 0
            ? input.slope
            : baseline.slope;
        const math = computeRoundMathFromRatingSlope(
          grossForMath,
          cr,
          sl,
          input.putting,
          input.pin,
          input.wind,
          input.mulligans
        );
        const trialDiffs = [...sorted.map((r) => r.adjustedDiff), math.adjustedDiff];
        const after = handicapIndexFromDifferentials(trialDiffs);
        const withoutId: Omit<SimRound, 'id'> = {
          ...input,
          holeScores,
          grossScore: grossForMath,
          courseName: course.name,
          teeName: input.teeName ?? course.defaultTee,
          ...math,
          indexAfter: after,
          indexDelta: before != null && after != null ? round1(after - before) : null,
          simcapIndexAtTime: before,
        };

        let id = newId();
        let cloudUid: string | null = null;
        const restTok = googleOAuthAccessToken;
        if (restTok) {
          try {
            const raw = await AsyncStorage.getItem('supabase.auth.token');
            const session = raw ? (JSON.parse(raw) as { user?: { id?: string } }) : null;
            cloudUid = session?.user?.id ?? null;
          } catch {
            cloudUid = null;
          }
        }
        if (!cloudUid && supabase) {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          cloudUid = user?.id ?? null;
        }
        if (supabase && cloudUid) {
          const ins = await insertRoundInSupabase(cloudUid, withoutId, restTok ?? undefined);
          if ('error' in ins) {
            throw new Error(ins.error);
          }
          id = ins.id;
        }

        const round: SimRound = { ...withoutId, id };
        set((s) => {
          const newRounds = [round, ...s.rounds];
          return {
            rounds: newRounds,
            groups: syncYouInGroups(s.groups, s.displayName, newRounds),
          };
        });
        if (isSupabaseConfigured() && round.h2hGroupId) {
          const dn = get().displayName;
          void import('../lib/socialGroups').then(({ insertSocialMatchFromRound }) => {
            void insertSocialMatchFromRound(round, dn, cloudUid ?? undefined, restTok ?? undefined);
          });
        }
        return round;
      },

      updateRound: async (roundId, patch) => {
        const s = get();
        const indexAtSave = currentIndexFromRounds(s.rounds);
        const rounds = s.rounds.map((r) =>
          r.id === roundId ? { ...r, ...patch, simcapIndexAtTime: indexAtSave } : r
        );
        const full = recalcAllRounds(rounds);
        const updated = full.find((r) => r.id === roundId);
        if (!updated) return;

        if (isCloudRoundId(roundId) && supabase) {
          const restTok = googleOAuthAccessToken;
          if (restTok) {
            const errMsg = await updateRoundInSupabase(updated, restTok);
            if (errMsg) throw new Error(errMsg);
          } else {
            const {
              data: { user },
            } = await supabase.auth.getUser();
            if (user) {
              const errMsg = await updateRoundInSupabase(updated);
              if (errMsg) throw new Error(errMsg);
            }
          }
        }

        set((st) => ({
          rounds: full,
          groups: syncYouInGroups(st.groups, st.displayName, full),
        }));
      },

      deleteRound: async (roundId) => {
        if (isCloudRoundId(roundId) && supabase) {
          const restTok = googleOAuthAccessToken;
          if (restTok) {
            const errMsg = await deleteRoundInSupabase(roundId, restTok);
            if (errMsg) throw new Error(errMsg);
          } else {
            const {
              data: { user },
            } = await supabase.auth.getUser();
            if (user) {
              const errMsg = await deleteRoundInSupabase(roundId);
              if (errMsg) throw new Error(errMsg);
            }
          }
        }

        set((s) => {
          const rounds = s.rounds.filter((r) => r.id !== roundId);
          const full = recalcAllRounds(rounds);
          return {
            rounds: full,
            groups: syncYouInGroups(s.groups, s.displayName, full),
          };
        });
        console.log('[store] deleteRound applied', {
          roundId,
          roundsCount: get().rounds.length,
        });
      },

      addGroup: (name) => {
        const you = get().displayName;
        const ini = initialsFrom(you);
        const idx = currentIndexFromRounds(get().rounds);
        set((s) => ({
          groups: [
            ...s.groups,
            {
              id: newId(),
              name,
              createdByUserId: '',
              lastRoundSummary: '1 member',
              members: [
                {
                  id: newId(),
                  userId: '',
                  displayName: `${you} (you)`,
                  initials: ini,
                  platform: 'Trackman',
                  roundsLogged: s.rounds.length,
                  index: idx,
                  trend: 'flat',
                  isYou: true,
                },
              ],
              headToHead: [],
            },
          ],
        }));
      },

      setGroups: (groups) => set({ groups }),

      removeGroupById: (groupId) =>
        set((s) => ({
          groups: s.groups.filter((g) => g.id !== groupId),
          pendingH2hMatchup:
            s.pendingH2hMatchup?.h2hGroupId === groupId ? null : s.pendingH2hMatchup,
        })),

      setInboundGroupInvites: (inboundGroupInvites) => set({ inboundGroupInvites }),

      recomputeGroupsFromYou: () => {
        const s = get();
        set({ groups: syncYouInGroups(s.groups, s.displayName, s.rounds) });
      },

      setPendingH2hMatchup: (p) => set({ pendingH2hMatchup: p }),

      recordGhinIndex: (index) => {
        if (!Number.isFinite(index) || index < 0 || index > 54) return;
        const n = Math.round(index * 10) / 10;
        set((s) => {
          const day = new Date().toISOString().slice(0, 10);
          const list = [...s.ghinSnapshots];
          const sameDay = list.findIndex((g) => g.recordedAt.slice(0, 10) === day);
          const entry: GhinSnapshot = {
            id: sameDay >= 0 ? list[sameDay].id : newId(),
            recordedAt: new Date().toISOString(),
            index: n,
          };
          if (sameDay >= 0) list[sameDay] = entry;
          else list.push(entry);
          list.sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
          return { ghinSnapshots: list };
        });
      },

      syncGhinFromProfileIfChanged: (index) => {
        if (!Number.isFinite(index) || index < 0 || index > 54) return;
        const n = Math.round(index * 10) / 10;
        const latest = latestGhinSnapshotIndex(get().ghinSnapshots);
        if (latest != null && Math.abs(latest - n) < 0.05) return;
        get().recordGhinIndex(n);
      },
    }),
    {
      name: 'simhandicap-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        displayName: s.displayName,
        preferredLogPlatform: s.preferredLogPlatform,
        rounds: s.rounds,
        groups: s.groups,
        ghinSnapshots: s.ghinSnapshots,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.groups?.length) {
          state.groups = state.groups
            .filter((g) => g.id !== 'g1' && g.id !== 'g2')
            .map((g) => ({
              ...g,
              createdByUserId: g.createdByUserId ?? '',
            }));
        }
        state?.hydrate();
      },
      // Web static export: avoid rehydrate-before-paint mismatch. With Supabase, defer rehydrate
      // until auth resolves so each user gets a separate persist key (see rebindPersistToUser).
      skipHydration: Platform.OS === 'web' || isSupabaseConfigured(),
    }
  )
);

const GUEST_PERSIST_NAME = 'simhandicap-guest';

/** Avoid rehydrate on every auth event (e.g. TOKEN_REFRESHED): stale disk can overwrite a just-deleted round. */
let lastBoundPersistKey: string | undefined;

export async function rebindPersistToUser(userId: string | null): Promise<void> {
  const key = userId ?? 'guest';
  if (lastBoundPersistKey === key) {
    return;
  }
  const name = userId ? `simhandicap-u-${userId}` : GUEST_PERSIST_NAME;
  await useAppStore.persist.setOptions({ name });
  lastBoundPersistKey = key;
  await useAppStore.persist.rehydrate();
}

export { formatRoundMeta, headToHeadFromLoggedRound } from '../lib/h2hFromRound';
