import type { PlatformId } from './constants';
import { PLATFORMS } from './constants';

export type CourseSeed = {
  id: string;
  name: string;
  /** Sim course rating / slope proxy per platform */
  byPlatform: Partial<Record<PlatformId, { rating: number; slope: number }>>;
  pars: number[];
  /** Optional stroke index 1–18 per hole (hole 1 = index 0). Used for net stroke allocation. */
  strokeIndex?: number[];
  defaultTee?: string;
};

/** Default 18-hole par layout when course-specific data is unavailable (par 72). */
const P72: number[] = [
  4, 4, 3, 4, 5, 4, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5,
];

function rp(r: number, s: number) {
  return { rating: r, slope: s };
}

/** Pre-seeded popular sim courses (ratings are illustrative proxies). */
export const COURSE_SEEDS: CourseSeed[] = [
  {
    id: 'pebble',
    name: 'Pebble Beach',
    defaultTee: 'White tees',
    byPlatform: {
      Trackman: rp(74.2, 142),
      Foresight: rp(74.0, 141),
      'Full Swing': rp(73.8, 140),
      E6: rp(74.0, 139),
      GSPro: rp(74.1, 141),
    },
    pars: [
      4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5,
    ],
  },
  {
    id: 'augusta',
    name: 'Augusta National',
    defaultTee: 'Masters tees',
    byPlatform: {
      Trackman: rp(78.1, 155),
      Foresight: rp(77.9, 154),
      'Full Swing': rp(77.5, 153),
      E6: rp(77.8, 154),
      GSPro: rp(78.0, 155),
    },
    pars: P72,
  },
  {
    id: 'sawgrass',
    name: 'TPC Sawgrass',
    defaultTee: 'Players tees',
    byPlatform: {
      Trackman: rp(76.4, 148),
      Foresight: rp(76.2, 147),
      'Full Swing': rp(76.0, 146),
      E6: rp(76.1, 147),
      GSPro: rp(76.3, 148),
    },
    pars: P72,
  },
  {
    id: 'bethpage',
    name: 'Bethpage Black',
    defaultTee: 'Championship',
    byPlatform: {
      Trackman: rp(77.5, 152),
      Foresight: rp(77.3, 151),
      'Full Swing': rp(77.0, 150),
      E6: rp(77.2, 151),
      GSPro: rp(77.4, 152),
    },
    pars: P72,
  },
  {
    id: 'st-andrews',
    name: 'St Andrews (Old)',
    defaultTee: 'Blue',
    byPlatform: {
      Trackman: rp(72.1, 132),
      Foresight: rp(72.0, 131),
      'Full Swing': rp(71.8, 130),
      E6: rp(72.0, 131),
      GSPro: rp(72.0, 132),
    },
    pars: P72,
  },
  {
    id: 'ocean',
    name: 'Ocean Course (Kiawah)',
    defaultTee: 'Tournament',
    byPlatform: {
      Trackman: rp(79.1, 155),
      Foresight: rp(78.9, 154),
      'Full Swing': rp(78.6, 153),
      E6: rp(78.8, 154),
      GSPro: rp(79.0, 155),
    },
    pars: P72,
  },
  {
    id: 'waste-mgmt',
    name: 'TPC Scottsdale (Stadium)',
    defaultTee: 'Stadium',
    byPlatform: {
      Trackman: rp(71.0, 128),
      Foresight: rp(70.9, 127),
      'Full Swing': rp(70.8, 127),
      E6: rp(70.9, 127),
      GSPro: rp(71.0, 128),
    },
    pars: P72,
  },
  {
    id: 'kapalua',
    name: 'Kapalua (Plantation)',
    defaultTee: 'Championship',
    byPlatform: {
      Trackman: rp(75.0, 145),
      Foresight: rp(74.8, 144),
      'Full Swing': rp(74.6, 143),
      E6: rp(74.7, 144),
      GSPro: rp(74.9, 145),
    },
    pars: P72,
  },
  {
    id: 'torrey-south',
    name: 'Torrey Pines (South)',
    defaultTee: 'Tips',
    byPlatform: {
      Trackman: rp(78.8, 148),
      Foresight: rp(78.6, 147),
      'Full Swing': rp(78.4, 146),
      E6: rp(78.5, 147),
      GSPro: rp(78.7, 148),
    },
    pars: P72,
  },
  {
    id: 'whistling',
    name: 'Whistling Straits',
    defaultTee: 'Straits',
    byPlatform: {
      Trackman: rp(77.2, 152),
      Foresight: rp(77.0, 151),
      'Full Swing': rp(76.8, 150),
      E6: rp(77.0, 151),
      GSPro: rp(77.1, 152),
    },
    pars: P72,
  },
  {
    id: 'valhalla',
    name: 'Valhalla',
    defaultTee: 'Championship',
    byPlatform: {
      Trackman: rp(75.2, 140),
      Foresight: rp(75.0, 139),
      'Full Swing': rp(74.8, 138),
      E6: rp(75.0, 139),
      GSPro: rp(75.1, 140),
    },
    pars: P72,
  },
  {
    id: 'shadow-creek',
    name: 'Shadow Creek',
    defaultTee: 'Member',
    byPlatform: {
      Trackman: rp(72.4, 130),
      Foresight: rp(72.2, 129),
      'Full Swing': rp(72.0, 128),
      E6: rp(72.1, 129),
      GSPro: rp(72.3, 130),
    },
    pars: P72,
  },
  {
    id: 'castle-pines',
    name: 'Castle Pines',
    defaultTee: 'Championship',
    byPlatform: {
      Trackman: rp(74.0, 138),
      Foresight: rp(73.8, 137),
      'Full Swing': rp(73.6, 136),
      E6: rp(73.8, 137),
      GSPro: rp(73.9, 138),
    },
    pars: P72,
  },
  {
    id: 'winged-foot',
    name: 'Winged Foot (West)',
    defaultTee: 'U.S. Open',
    byPlatform: {
      Trackman: rp(76.9, 147),
      Foresight: rp(76.7, 146),
      'Full Swing': rp(76.5, 145),
      E6: rp(76.6, 146),
      GSPro: rp(76.8, 147),
    },
    pars: P72,
  },
  {
    id: 'pinehurst',
    name: 'Pinehurst No. 2',
    defaultTee: 'Championship',
    byPlatform: {
      Trackman: rp(76.0, 140),
      Foresight: rp(75.8, 139),
      'Full Swing': rp(75.6, 138),
      E6: rp(75.8, 139),
      GSPro: rp(75.9, 140),
    },
    pars: P72,
  },
];

export function getCourseById(id: string): CourseSeed | undefined {
  return COURSE_SEEDS.find((c) => c.id === id);
}

export function ratingForCourse(course: CourseSeed, platform: PlatformId) {
  const direct = course.byPlatform[platform];
  if (direct) return direct;
  for (const p of PLATFORMS) {
    const x = course.byPlatform[p];
    if (x) return x;
  }
  return { rating: 72, slope: 130 };
}
