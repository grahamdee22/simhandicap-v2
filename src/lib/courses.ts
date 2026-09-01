import type { PlatformId } from './constants';
import { PLATFORMS } from './constants';
import { normalizeCourseName } from './courseNameNormalize';

export { normalizeCourseName };

/** One playable tee (WHS-style course rating + slope). */
export type CourseTee = {
  name: string;
  rating: number;
  slope: number;
  /** Total yardage from the published scorecard when verified; omit if unknown. */
  yards?: number;
};

export type CourseSeed = {
  id: string;
  name: string;
  /** City / region (optional; used for picker search when set). */
  location?: string;
  /** Sim course rating / slope proxy per platform (championship / default tee baseline). */
  byPlatform: Partial<Record<PlatformId, { rating: number; slope: number }>>;
  pars: number[];
  /** Optional stroke index 1–18 per hole (hole 1 = index 0). Used for net stroke allocation. */
  strokeIndex?: number[];
  /** Tee shown first in the log picker when this course loads; must match a `tees[].name` when `tees` is set. */
  defaultTee?: string;
  /**
   * When set, these tees are offered in the log flow (same values across sim platforms).
   * When omitted, `getCourseTees` builds a Red + default pair from `byPlatform` / `defaultTee`.
   */
  tees?: CourseTee[];
  /** When false, log UI hides tee selection and handicap uses the middle `tees` row. Omitted or true = show selector. */
  confident?: boolean;
};

/** Default 18-hole par layout when course-specific data is unavailable (par 72). */
const P72: number[] = [
  4, 4, 3, 4, 5, 4, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5,
];

function rp(r: number, s: number) {
  return { rating: r, slope: s };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Forward / ladies-style tee approximated from a longer tee’s published numbers. */
export function redTeeFromChampionship(rating: number, slope: number): CourseTee {
  return {
    name: 'Red',
    rating: round1(Math.max(60, rating - 3.2)),
    slope: Math.max(95, Math.round(slope - 12)),
  };
}

export const CUSTOM_TEE_ID = '__custom__';

/** Same rating/slope on every sim platform (from published tee data). */
function uniformByPlatform(rating: number, slope: number): CourseSeed['byPlatform'] {
  const o = {} as CourseSeed['byPlatform'];
  for (const p of PLATFORMS) {
    o[p] = rp(rating, slope);
  }
  return o;
}

/** Pebble Beach hole pars (kept for seed continuity). */
const PEBBLE_PARS: number[] = [
  4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5,
];

/** Verified 18-hole par layouts (holes 1–18). Sources: official/USGA/Wikipedia scorecards. */
const AUGUSTA_PARS: number[] = [
  4, 5, 4, 3, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 5, 3, 4, 4,
];
const BANDON_DUNES_PARS: number[] = [
  4, 3, 5, 4, 4, 3, 4, 4, 5, 4, 4, 3, 5, 4, 3, 4, 4, 5,
];
const BANDON_TRAILS_PARS: number[] = [
  4, 3, 5, 4, 3, 4, 4, 4, 5, 4, 4, 3, 4, 4, 4, 5, 3, 4,
];
const BAY_HILL_PARS: number[] = [
  4, 3, 4, 5, 4, 5, 3, 4, 4, 4, 4, 5, 4, 3, 4, 5, 3, 4,
];
const CABOT_CLIFFS_PARS: number[] = [
  5, 4, 4, 3, 4, 3, 5, 5, 3, 5, 4, 3, 4, 3, 5, 3, 4, 5,
];
const CABOT_LINKS_PARS: number[] = [
  5, 3, 4, 4, 3, 4, 3, 5, 4, 4, 5, 4, 4, 3, 4, 4, 3, 4,
];
const BETHPAGE_PARS: number[] = [
  4, 4, 3, 5, 4, 4, 5, 3, 4, 4, 4, 4, 5, 3, 4, 4, 3, 4,
];
const CARNOUSTIE_PARS: number[] = [
  4, 4, 4, 4, 4, 5, 4, 3, 4, 4, 4, 4, 3, 5, 4, 3, 4, 4,
];
const CHAMBERS_BAY_PARS: number[] = [
  4, 4, 3, 4, 4, 4, 4, 5, 3, 4, 4, 4, 4, 4, 3, 4, 3, 5,
];
const CONGRESSIONAL_BLUE_PARS: number[] = [
  4, 3, 4, 4, 4, 5, 3, 4, 5, 3, 5, 4, 3, 4, 4, 5, 4, 4,
];
const EAST_LAKE_PARS: number[] = [
  4, 3, 4, 4, 4, 5, 4, 4, 3, 4, 3, 4, 4, 4, 3, 4, 4, 5,
];
const ERIN_HILLS_PARS: number[] = [
  5, 4, 4, 4, 4, 3, 5, 4, 3, 4, 4, 4, 3, 5, 4, 3, 4, 5,
];
const HARBOUR_TOWN_PARS: number[] = [
  4, 5, 4, 3, 5, 4, 3, 4, 4, 4, 4, 4, 4, 3, 5, 4, 3, 4,
];
const HAZELTINE_PARS: number[] = [
  4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 5, 4, 3, 4, 5, 4, 3, 4,
];
const KAPALUA_PLANTATION_PARS: number[] = [
  4, 3, 4, 4, 5, 4, 4, 3, 5, 4, 3, 4, 4, 4, 5, 4, 4, 5,
];
const KIAWAH_OCEAN_PARS: number[] = [
  4, 5, 4, 4, 3, 4, 5, 3, 4, 4, 5, 4, 4, 3, 4, 5, 3, 4,
];
const MERION_EAST_PARS: number[] = [
  4, 5, 3, 5, 4, 4, 4, 4, 3, 4, 4, 4, 3, 4, 4, 4, 3, 4,
];
const MUIRFIELD_VILLAGE_PARS: number[] = [
  4, 4, 4, 3, 5, 4, 5, 3, 4, 4, 5, 3, 4, 4, 5, 3, 4, 4,
];
const OAKMONT_PARS: number[] = [
  4, 4, 4, 5, 4, 3, 4, 3, 5, 4, 4, 5, 3, 4, 4, 3, 4, 4,
];
const OLD_MACDONALD_PARS: number[] = [
  4, 3, 4, 4, 3, 5, 4, 3, 4, 4, 4, 3, 4, 4, 5, 4, 5, 4,
];
const OLYMPIC_LAKE_PARS: number[] = [
  4, 4, 3, 4, 4, 4, 4, 3, 4, 4, 4, 4, 3, 4, 3, 5, 5, 4,
];
const PACIFIC_DUNES_PARS: number[] = [
  4, 4, 5, 4, 3, 4, 4, 4, 4, 3, 3, 5, 4, 3, 5, 4, 3, 5,
];
const PINEHURST_2_PARS: number[] = [
  4, 4, 4, 4, 5, 3, 4, 5, 3, 5, 4, 4, 4, 4, 3, 5, 3, 4,
];
const PINEHURST_4_PARS: number[] = [
  4, 5, 4, 3, 4, 3, 4, 4, 5, 4, 3, 4, 5, 3, 4, 4, 5, 4,
];
const PRAIRIE_DUNES_PARS: number[] = [
  4, 3, 4, 3, 4, 4, 5, 4, 4, 3, 4, 4, 4, 4, 3, 4, 5, 4,
];
const RIVIERA_PARS: number[] = [
  5, 4, 4, 3, 4, 3, 4, 4, 4, 4, 5, 4, 4, 3, 4, 3, 5, 4,
];
const ROYAL_BIRKDALE_PARS: number[] = [
  4, 4, 4, 3, 4, 4, 3, 4, 4, 4, 4, 3, 4, 5, 3, 4, 5, 4,
];
const SAWGRASS_PARS: number[] = [
  4, 5, 3, 4, 4, 4, 4, 3, 5, 4, 5, 4, 3, 4, 4, 5, 3, 4,
];
const SHEEP_RANCH_PARS: number[] = [
  5, 4, 3, 4, 3, 4, 3, 4, 4, 4, 5, 4, 5, 4, 4, 3, 4, 5,
];
const SOUTHERN_HILLS_PARS: number[] = [
  4, 4, 4, 4, 5, 3, 4, 3, 4, 4, 3, 4, 5, 3, 4, 4, 4, 4,
];
const SPYGLASS_PARS: number[] = [
  5, 4, 3, 4, 3, 4, 5, 4, 4, 4, 5, 3, 4, 5, 3, 4, 4, 4,
];
const ST_ANDREWS_OLD_PARS: number[] = [
  4, 4, 4, 4, 5, 4, 4, 3, 4, 4, 3, 4, 4, 5, 4, 4, 4, 4,
];
const TORREY_NORTH_PARS: number[] = [
  4, 4, 3, 4, 5, 4, 4, 3, 5, 5, 4, 3, 4, 4, 3, 4, 5, 4,
];
const TORREY_SOUTH_PARS: number[] = [
  4, 4, 3, 4, 4, 5, 4, 3, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5,
];
const TPC_RIVER_HIGHLANDS_PARS: number[] = [
  4, 4, 4, 4, 3, 5, 4, 3, 4, 4, 3, 4, 5, 4, 4, 3, 4, 4,
];
const TPC_SCOTTSDALE_PARS: number[] = [
  4, 3, 4, 4, 3, 4, 4, 3, 4, 4, 5, 4, 3, 4, 4, 3, 4, 5,
];
const VALHALLA_PARS: number[] = [
  4, 4, 3, 4, 4, 4, 5, 3, 4, 5, 3, 4, 4, 3, 4, 4, 4, 5,
];
const WAIALAE_PARS: number[] = [
  4, 3, 4, 5, 4, 4, 4, 3, 5, 5, 4, 4, 3, 4, 4, 3, 4, 5,
];
const WHISTLING_IRISH_PARS: number[] = [
  4, 4, 3, 4, 5, 3, 4, 5, 4, 4, 3, 4, 3, 5, 4, 4, 4, 5,
];
const WHISTLING_STRAITS_PARS: number[] = [
  4, 5, 3, 4, 5, 4, 3, 4, 4, 4, 5, 3, 4, 4, 5, 4, 3, 4,
];
const ARCADIA_BLUFFS_PARS: number[] = [
  5, 3, 5, 4, 5, 3, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4,
];
const CYPRESS_POINT_PARS: number[] = [
  4, 5, 3, 4, 5, 5, 3, 4, 4, 5, 4, 4, 4, 4, 3, 3, 4, 4,
];
const GAMBLE_SANDS_PARS: number[] = [
  4, 4, 5, 3, 4, 3, 5, 4, 4, 3, 4, 4, 5, 4, 4, 3, 4, 5,
];
const MUIRFIELD_PARS: number[] = [
  4, 4, 4, 3, 5, 4, 3, 4, 5, 4, 4, 4, 3, 4, 4, 3, 5, 4,
];
const PASATIEMPO_PARS: number[] = [
  4, 4, 3, 4, 3, 5, 4, 3, 5, 4, 4, 4, 5, 4, 3, 4, 4, 3,
];
const PAYNES_VALLEY_PARS: number[] = [
  4, 3, 4, 5, 3, 4, 4, 5, 4, 3, 4, 4, 5, 4, 4, 3, 4, 5,
];
const POPPY_HILLS_PARS: number[] = [
  4, 3, 4, 5, 4, 3, 4, 4, 5, 5, 3, 4, 4, 4, 3, 4, 3, 5,
];
const PORT_RUSH_DUNLUCE_PARS: number[] = [
  4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 4, 5, 3, 4, 4, 3, 4, 4,
];
const QUAIL_HOLLOW_PARS: number[] = [
  5, 4, 4, 3, 4, 3, 5, 4, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4,
];
const ROYAL_LYTHAM_PARS: number[] = [
  3, 4, 4, 4, 3, 4, 5, 4, 3, 4, 5, 3, 4, 4, 4, 4, 4, 4,
];
const SAND_HILLS_PARS: number[] = [
  5, 4, 3, 4, 4, 3, 4, 4, 4, 4, 4, 4, 3, 5, 4, 5, 3, 4,
];
const SAND_VALLEY_PARS: number[] = [
  4, 4, 3, 5, 3, 4, 5, 3, 4, 5, 4, 5, 4, 3, 4, 4, 3, 5,
];
const SEA_ISLAND_SEASIDE_PARS: number[] = [
  4, 4, 3, 4, 4, 3, 5, 4, 4, 4, 4, 3, 4, 4, 5, 4, 3, 4,
];
const STREAMSONG_BLACK_PARS: number[] = [
  5, 4, 4, 5, 3, 4, 3, 4, 4, 5, 4, 5, 4, 4, 3, 4, 3, 5,
];
const STREAMSONG_BLUE_PARS: number[] = [
  4, 5, 4, 4, 3, 4, 3, 4, 5, 3, 4, 4, 4, 5, 4, 3, 5, 4,
];
const STREAMSONG_RED_PARS: number[] = [
  4, 5, 4, 4, 4, 3, 5, 3, 4, 4, 4, 4, 5, 3, 4, 3, 4, 5,
];
const SUNNINGDALE_OLD_PARS: number[] = [
  5, 4, 4, 3, 4, 4, 4, 3, 4, 4, 4, 4, 3, 5, 3, 4, 4, 4,
];
const TOBACCO_ROAD_PARS: number[] = [
  5, 4, 3, 5, 4, 3, 4, 3, 4, 4, 5, 4, 5, 3, 4, 4, 3, 4,
];
const TROON_OLD_PARS: number[] = [
  4, 4, 4, 5, 3, 5, 4, 3, 4, 4, 4, 4, 4, 3, 4, 5, 3, 4,
];
const VALDERRAMA_PARS: number[] = [
  4, 4, 3, 5, 4, 3, 4, 4, 4, 4, 5, 3, 4, 4, 3, 4, 5, 4,
];
const WOLF_CREEK_PARS: number[] = [
  5, 4, 3, 4, 5, 4, 4, 3, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4,
];
const BLACK_DESERT_PARS: number[] = [
  4, 4, 3, 4, 4, 4, 5, 3, 5, 4, 4, 4, 5, 4, 3, 4, 3, 5,
];
const SAND_HOLLOW_CHAMP_PARS: number[] = [
  4, 5, 3, 4, 4, 4, 5, 3, 4, 5, 3, 4, 4, 4, 3, 4, 5, 4,
];
const CORAL_CANYON_PARS: number[] = [
  4, 3, 4, 3, 5, 4, 5, 3, 5, 4, 5, 3, 4, 4, 3, 5, 4, 4,
];
const LEDGES_PARS: number[] = [
  4, 3, 5, 4, 3, 4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 5, 4, 4,
];
const ENTRADA_PARS: number[] = [
  4, 4, 4, 4, 3, 4, 4, 3, 5, 4, 5, 3, 4, 4, 3, 5, 4, 4,
];
const SKY_MOUNTAIN_PARS: number[] = [
  4, 3, 4, 4, 4, 5, 4, 3, 5, 5, 4, 3, 4, 4, 4, 3, 4, 5,
];
const CONESTOGA_PARS: number[] = [
  4, 3, 4, 4, 3, 5, 4, 4, 5, 3, 4, 5, 4, 3, 4, 5, 4, 4,
];
const PALMS_MESQUITE_PARS: number[] = [
  5, 4, 3, 5, 4, 4, 3, 4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 4,
];
const FALCON_RIDGE_PARS: number[] = [
  5, 3, 4, 4, 3, 4, 5, 3, 4, 5, 4, 5, 4, 3, 4, 5, 3, 4,
];
const OASIS_PALMER_PARS: number[] = [
  4, 3, 4, 4, 5, 4, 3, 5, 3, 4, 4, 5, 4, 4, 4, 3, 4, 4,
];

const ARONIMINK_PARS: number[] = [
  4, 4, 4, 4, 3, 4, 4, 3, 5, 4, 4, 4, 4, 3, 4, 5, 3, 4,
];
const BALTUSROL_LOWER_PARS: number[] = [
  5, 4, 4, 3, 4, 4, 5, 4, 3, 4, 4, 3, 4, 4, 4, 3, 5, 5,
];
const BROOKLINE_US_OPEN_PARS: number[] = [
  4, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 4, 5, 4, 3, 4, 4,
];
const FIELDS_RANCH_EAST_PARS: number[] = [
  5, 4, 5, 3, 4, 4, 4, 3, 4, 4, 4, 4, 3, 5, 4, 4, 3, 5,
];
const LACC_NORTH_PARS: number[] = [
  5, 4, 4, 3, 4, 4, 3, 5, 3, 4, 3, 4, 4, 5, 3, 4, 4, 4,
];
const OAK_HILL_EAST_PARS: number[] = [
  4, 4, 3, 5, 3, 4, 4, 4, 4, 4, 3, 4, 5, 4, 3, 4, 4, 4,
];
const OAKLAND_HILLS_SOUTH_PARS: number[] = [
  4, 5, 3, 4, 4, 4, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4, 3, 5,
];
const SHINNECOCK_PARS: number[] = [
  4, 4, 3, 4, 5, 4, 3, 4, 4, 4, 4, 3, 4, 4, 4, 3, 4, 5,
];
const WINGED_FOOT_WEST_PARS: number[] = [
  4, 4, 3, 4, 5, 4, 3, 4, 5, 3, 4, 5, 3, 4, 4, 5, 4, 4,
];

/**
 * Pre-seeded sim courses. IDs are stable: existing rounds reference `courseId`.
 * Ratings/slopes follow the app’s default tee per course (uniform across platforms).
 */
export const COURSE_SEEDS: CourseSeed[] = [
  {
    id: 'pebble',
    name: 'Pebble Beach Golf Links',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.1, 128),
    pars: PEBBLE_PARS,
    tees: [
      { name: 'Red', rating: 69.0, slope: 119 },
      { name: 'White', rating: 72.1, slope: 128 },
      { name: 'Blue', rating: 74.3, slope: 133 },
      { name: 'Black', rating: 75.5, slope: 136 },
    ],
  },
  {
    id: 'augusta',
    name: 'Augusta National Golf Club',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(74.2, 132),
    pars: AUGUSTA_PARS,
    tees: [
      { name: 'Red', rating: 69.1, slope: 118 },
      { name: 'White', rating: 72.8, slope: 128 },
      { name: 'Green', rating: 74.2, slope: 132 },
      { name: 'Tournament', rating: 76.2, slope: 137 },
      { name: 'Black', rating: 78.1, slope: 144 },
    ],
  },
  {
    id: 'sawgrass',
    name: 'TPC Sawgrass',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.7, 135),
    pars: SAWGRASS_PARS,
    tees: [
      { name: 'Red', rating: 69.8, slope: 122 },
      { name: 'White', rating: 72.4, slope: 129 },
      { name: 'Blue', rating: 74.7, slope: 135 },
      { name: 'Black', rating: 76.1, slope: 141 },
    ],
  },
  {
    id: 'bethpage',
    name: 'Bethpage Black',
    defaultTee: 'Black',
    byPlatform: uniformByPlatform(75.4, 144),
    pars: BETHPAGE_PARS,
    tees: [
      { name: 'Red', rating: 70.5, slope: 125 },
      { name: 'White', rating: 73.0, slope: 133 },
      { name: 'Blue', rating: 74.5, slope: 138 },
      { name: 'Black', rating: 75.4, slope: 144 },
    ],
  },
  {
    id: 'pinehurst',
    name: 'Pinehurst No. 2',
    defaultTee: 'Gold',
    byPlatform: uniformByPlatform(75.0, 131),
    pars: PINEHURST_2_PARS,
    tees: [
      { name: 'Red', rating: 68.5, slope: 117 },
      { name: 'Green', rating: 72.2, slope: 127 },
      { name: 'Gold', rating: 75.0, slope: 131 },
      { name: 'Blue', rating: 76.8, slope: 138 },
    ],
  },
  {
    id: 'st-andrews',
    name: 'St Andrews Old Course',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.1, 132),
    pars: ST_ANDREWS_OLD_PARS,
    tees: [
      { name: 'Red', rating: 67.5, slope: 114 },
      { name: 'White', rating: 72.1, slope: 132 },
      { name: 'Blue', rating: 74.0, slope: 135 },
      { name: 'Championship', rating: 75.2, slope: 137 },
    ],
  },
  {
    id: 'torrey-south',
    name: 'Torrey Pines South',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(75.3, 144),
    pars: TORREY_SOUTH_PARS,
    tees: [
      { name: 'Red', rating: 70.6, slope: 124 },
      { name: 'White', rating: 72.9, slope: 131 },
      { name: 'Blue', rating: 75.3, slope: 144 },
      { name: 'Black', rating: 78.5, slope: 150 },
    ],
  },
  {
    id: 'torrey-north',
    name: 'Torrey Pines North',
    location: 'La Jolla, CA',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: TORREY_NORTH_PARS,
    tees: [
      { name: 'Silver', rating: 66.0, slope: 112, yards: 5190 },
      { name: 'Gold', rating: 69.3, slope: 120, yards: 5847 },
      { name: 'Green', rating: 71.5, slope: 125, yards: 6343 },
      { name: 'Black', rating: 73.6, slope: 129, yards: 6781 },
      { name: 'Taupe', rating: 75.8, slope: 134, yards: 7258 },
    ],
    confident: true,
  },
  {
    id: 'fishers-island',
    name: 'Fishers Island Club',
    location: 'Fishers Island, NY',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: P72,
    tees: [{ name: 'White', rating: 72.0, slope: 130 }],
    confident: false,
  },
  {
    id: 'paynes-valley',
    name: "Payne's Valley",
    location: 'Hollister, MO',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: PAYNES_VALLEY_PARS,
    tees: [
      { name: 'Red', rating: 64.0, slope: 102, yards: 4957 },
      { name: 'White', rating: 69.4, slope: 119, yards: 6133 },
      { name: 'Blue', rating: 73.2, slope: 125, yards: 6876 },
      { name: 'Tiger', rating: 75.6, slope: 132, yards: 7370 },
    ],
    confident: true,
  },
  {
    id: 'pasatiempo',
    name: 'Pasatiempo Golf Club',
    location: 'Santa Cruz, CA',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: PASATIEMPO_PARS,
    tees: [
      { name: 'Hollins', rating: 63.2, slope: 117, yards: 4438 },
      { name: 'Green', rating: 68.5, slope: 132, yards: 5595 },
      { name: 'White', rating: 70.8, slope: 134, yards: 6093 },
      { name: 'Gold', rating: 72.5, slope: 141, yards: 6495 },
    ],
    confident: true,
  },
  {
    id: 'prairie-dunes',
    name: 'Prairie Dunes Country Club',
    location: 'Hutchinson, KS',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: PRAIRIE_DUNES_PARS,
    tees: [
      { name: 'Bronze', rating: 67.4, slope: 131, yards: 4867 },
      { name: 'Silver', rating: 69.2, slope: 135, yards: 5462 },
      { name: 'White', rating: 72.3, slope: 141, yards: 6119 },
      { name: 'Blue', rating: 74.1, slope: 144, yards: 6563 },
      { name: 'Gold', rating: 75.5, slope: 148, yards: 6947 },
    ],
    confident: true,
  },
  {
    id: 'sand-hills',
    name: 'Sand Hills Golf Club',
    location: 'Mullen, NE',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: SAND_HILLS_PARS,
    tees: [{ name: 'White', rating: 72.0, slope: 130 }],
    confident: false,
  },
  {
    id: 'whistling',
    name: 'Whistling Straits',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(75.1, 140),
    pars: WHISTLING_STRAITS_PARS,
    tees: [
      { name: 'Red', rating: 69.0, slope: 116 },
      { name: 'White', rating: 72.5, slope: 127 },
      { name: 'Blue', rating: 75.1, slope: 140 },
      { name: 'Black', rating: 77.2, slope: 152 },
    ],
  },
  {
    id: 'ocean',
    name: 'Kiawah Island Ocean',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.7, 141),
    pars: KIAWAH_OCEAN_PARS,
    tees: [
      { name: 'Red', rating: 69.8, slope: 121 },
      { name: 'White', rating: 72.5, slope: 128 },
      { name: 'Blue', rating: 74.7, slope: 141 },
      { name: 'Black', rating: 76.3, slope: 146 },
    ],
  },
  {
    id: 'oakmont',
    name: 'Oakmont Country Club',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.1, 132),
    pars: OAKMONT_PARS,
    tees: [
      { name: 'Red', rating: 70.2, slope: 123 },
      { name: 'White', rating: 73.1, slope: 132 },
      { name: 'Blue', rating: 75.2, slope: 138 },
      { name: 'Black', rating: 76.8, slope: 139 },
    ],
  },
  {
    id: 'merion-east',
    name: 'Merion Golf Club East',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.8, 134),
    pars: MERION_EAST_PARS,
    tees: [
      { name: 'Red', rating: 69.5, slope: 120 },
      { name: 'White', rating: 72.8, slope: 134 },
      { name: 'Blue', rating: 74.5, slope: 144 },
    ],
  },
  {
    id: 'congressional-blue',
    name: 'Congressional Blue',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(75.4, 138),
    pars: CONGRESSIONAL_BLUE_PARS,
    tees: [
      { name: 'Green', rating: 67.3, slope: 118, yards: 5479 },
      { name: 'Silver', rating: 68.6, slope: 121, yards: 5776 },
      { name: 'White', rating: 70.7, slope: 129, yards: 6199 },
      { name: 'Gold', rating: 72.9, slope: 134, yards: 6727 },
      { name: 'Blue', rating: 75.4, slope: 138, yards: 7278 },
      { name: 'Championship', rating: 76.8, slope: 141, yards: 7588 },
    ],
    confident: true,
  },
  {
    id: 'olympic-lake',
    name: 'Olympic Club Lake',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(71.8, 130),
    pars: OLYMPIC_LAKE_PARS,
    tees: [
      { name: 'Red', rating: 69.3, slope: 128, yards: 5738 },
      { name: 'White', rating: 71.8, slope: 130, yards: 6248 },
      { name: 'Blue', rating: 73.2, slope: 134, yards: 6626 },
      { name: 'Black', rating: 75.0, slope: 138, yards: 7024 },
      { name: 'Champ', rating: 75.8, slope: 140, yards: 7214 },
    ],
    confident: true,
  },
  {
    id: 'riviera',
    name: 'Riviera Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 134),
    pars: RIVIERA_PARS,
    tees: [
      { name: 'Red', rating: 70.0, slope: 121 },
      { name: 'White', rating: 72.6, slope: 128 },
      { name: 'Blue', rating: 73.8, slope: 134 },
      { name: 'Black', rating: 75.2, slope: 139 },
    ],
  },
  {
    id: 'chambers-bay',
    name: 'Chambers Bay',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.4, 134),
    pars: CHAMBERS_BAY_PARS,
    tees: [
      { name: 'Teal', rating: 63.0, slope: 109, yards: 4708 },
      { name: 'White', rating: 68.0, slope: 122, yards: 5822 },
      { name: 'Sand', rating: 70.6, slope: 130, yards: 6345 },
      { name: 'Blue', rating: 72.4, slope: 134, yards: 6748 },
      { name: 'Black', rating: 74.4, slope: 138, yards: 7158 },
      { name: 'Champ', rating: 77.6, slope: 145, yards: 7867 },
    ],
    confident: true,
  },
  {
    id: 'erin-hills',
    name: 'Erin Hills',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(75.2, 131),
    pars: ERIN_HILLS_PARS,
    tees: [
      { name: 'Red', rating: 70.8, slope: 118 },
      { name: 'White', rating: 73.4, slope: 126 },
      { name: 'Blue', rating: 75.2, slope: 131 },
      { name: 'Black', rating: 77.1, slope: 138 },
    ],
  },
  {
    id: 'hazeltine',
    name: 'Hazeltine National',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(75.6, 152),
    pars: HAZELTINE_PARS,
    tees: [
      { name: 'Black', rating: 71.2, slope: 131, yards: 5129 },
      { name: 'White', rating: 71.4, slope: 143, yards: 6236 },
      { name: 'Gold', rating: 73.4, slope: 148, yards: 6720 },
      { name: 'Blue', rating: 75.6, slope: 152, yards: 7124 },
      { name: 'Tournament', rating: 78.0, slope: 155, yards: 7674 },
    ],
    confident: true,
  },
  {
    id: 'southern-hills',
    name: 'Southern Hills',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.8, 139),
    pars: SOUTHERN_HILLS_PARS,
    tees: [
      { name: 'Silver', rating: 70.6, slope: 122, yards: 5132 },
      { name: 'Gold', rating: 70.0, slope: 127, yards: 5910 },
      { name: 'White', rating: 71.0, slope: 128, yards: 6188 },
      { name: 'Blue', rating: 72.8, slope: 139, yards: 6602 },
    ],
    confident: true,
  },
  {
    id: 'valhalla',
    name: 'Valhalla Golf Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(69.9, 132),
    pars: VALHALLA_PARS,
    tees: [
      { name: 'Silver', rating: 66.2, slope: 126, yards: 5085 },
      { name: 'Blue', rating: 69.9, slope: 132, yards: 6055 },
      { name: 'Green', rating: 72.3, slope: 143, yards: 6540 },
      { name: 'Black', rating: 74.7, slope: 150, yards: 7020 },
      { name: 'Gold', rating: 77.5, slope: 154, yards: 7675 },
    ],
    confident: true,
  },
  {
    id: 'east-lake',
    name: 'East Lake Golf Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.2, 132),
    pars: EAST_LAKE_PARS,
    tees: [
      { name: 'Gold', rating: 66.4, slope: 121, yards: 5205 },
      { name: 'Blue', rating: 72.2, slope: 132, yards: 6452 },
      { name: 'Black', rating: 74.0, slope: 137, yards: 7346 },
    ],
    confident: true,
  },
  {
    id: 'carnoustie',
    name: 'Carnoustie Championship',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(75.0, 139),
    pars: CARNOUSTIE_PARS,
    tees: [
      { name: 'Red', rating: 71.0, slope: 130, yards: 6144 },
      { name: 'Yellow', rating: 73.6, slope: 135, yards: 6589 },
      { name: 'White', rating: 75.0, slope: 139, yards: 6948 },
    ],
    confident: true,
  },
  {
    id: 'royal-st-georges',
    name: 'Royal St Georges',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.9, 132),
    pars: P72,
    tees: [
      { name: 'Red', rating: 68.5, slope: 116 },
      { name: 'Yellow', rating: 71.8, slope: 126 },
      { name: 'White', rating: 73.9, slope: 132 },
      { name: 'Medal', rating: 75.4, slope: 136 },
    ],
    confident: false,
  },
  {
    id: 'muirfield',
    name: 'Muirfield',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.8, 142),
    pars: MUIRFIELD_PARS,
    tees: [
      { name: 'Blue', rating: 70.4, slope: 132, yards: 5983 },
      { name: 'Boxes', rating: 72.5, slope: 139, yards: 6469 },
      { name: 'White', rating: 73.8, slope: 142, yards: 6728 },
    ],
    confident: true,
  },
  {
    id: 'portrush-dunluce',
    name: 'Royal Portrush Dunluce',
    defaultTee: 'Medal',
    byPlatform: uniformByPlatform(72.4, 131),
    pars: PORT_RUSH_DUNLUCE_PARS,
    tees: [
      { name: 'Society', rating: 70.7, slope: 127, yards: 6353 },
      { name: 'Medal', rating: 72.4, slope: 131, yards: 6709 },
      { name: 'Championship', rating: 76.2, slope: 140, yards: 7356 },
    ],
    confident: true,
  },
  {
    id: 'troon-old',
    name: 'Royal Troon Old',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.4, 140),
    pars: TROON_OLD_PARS,
    tees: [
      { name: 'Yellow', rating: 71.5, slope: 136, yards: 6205 },
      { name: 'White', rating: 73.4, slope: 140, yards: 6632 },
    ],
    confident: true,
  },
  {
    id: 'turnberry-ailsa',
    name: 'Turnberry Ailsa',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.3, 131),
    pars: P72,
    tees: [
      { name: 'White', rating: 72.0, slope: 130 },
      { name: 'Blue', rating: 74.3, slope: 131 },
    ],
    confident: false,
  },
  {
    id: 'bandon-dunes',
    name: 'Bandon Dunes',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(71.1, 133),
    pars: BANDON_DUNES_PARS,
    tees: [
      { name: 'Royal Blue', rating: 61.6, slope: 105, yards: 3986 },
      { name: 'Gold', rating: 69.1, slope: 124, yards: 5716 },
      { name: 'Green', rating: 71.1, slope: 133, yards: 6221 },
      { name: 'Black', rating: 73.5, slope: 143, yards: 6732 },
    ],
    confident: true,
  },
  {
    id: 'bandon-trails',
    name: 'Bandon Trails',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(72.0, 137),
    pars: BANDON_TRAILS_PARS,
    tees: [
      { name: 'Royal Blue', rating: 63.0, slope: 113, yards: 3928 },
      { name: 'Orange', rating: 66.7, slope: 126, yards: 5097 },
      { name: 'Gold', rating: 69.6, slope: 132, yards: 5751 },
      { name: 'Green', rating: 72.0, slope: 137, yards: 6249 },
      { name: 'Black', rating: 74.9, slope: 136, yards: 6786 },
    ],
    confident: true,
  },
  {
    id: 'pacific-dunes',
    name: 'Pacific Dunes',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(70.8, 135),
    pars: PACIFIC_DUNES_PARS,
    tees: [
      { name: 'Royal Blue', rating: 61.5, slope: 113, yards: 3920 },
      { name: 'Orange', rating: 65.8, slope: 126, yards: 5088 },
      { name: 'Gold', rating: 68.9, slope: 131, yards: 5775 },
      { name: 'Green', rating: 70.8, slope: 135, yards: 6142 },
      { name: 'Black', rating: 73.2, slope: 143, yards: 6633 },
    ],
    confident: true,
  },
  {
    id: 'old-macdonald',
    name: 'Old Macdonald',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(71.4, 127),
    pars: OLD_MACDONALD_PARS,
    tees: [
      { name: 'Royal Blue', rating: 62.6, slope: 104, yards: 4258 },
      { name: 'Gold', rating: 67.8, slope: 117, yards: 5658 },
      { name: 'Green', rating: 71.4, slope: 127, yards: 6352 },
      { name: 'Black', rating: 74.4, slope: 134, yards: 6978 },
    ],
    confident: true,
  },
  {
    id: 'sheep-ranch',
    name: 'Sheep Ranch',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(70.0, 116),
    pars: SHEEP_RANCH_PARS,
    tees: [
      { name: 'Royal Blue', rating: 61.0, slope: 97, yards: 3943 },
      { name: 'Gold', rating: 67.9, slope: 109, yards: 5810 },
      { name: 'Green', rating: 70.0, slope: 116, yards: 6245 },
      { name: 'Black', rating: 71.9, slope: 121, yards: 6636 },
    ],
    confident: true,
  },
  {
    id: 'sand-valley',
    name: 'Sand Valley',
    defaultTee: 'Sand',
    byPlatform: uniformByPlatform(70.2, 129),
    pars: SAND_VALLEY_PARS,
    tees: [
      { name: 'Royal Blue', rating: 60.8, slope: 100, yards: 3883 },
      { name: 'Silver', rating: 63.9, slope: 113, yards: 4757 },
      { name: 'Green', rating: 67.4, slope: 123, yards: 5598 },
      { name: 'Sand', rating: 70.2, slope: 129, yards: 6050 },
      { name: 'Orange', rating: 72.8, slope: 138, yards: 6535 },
      { name: 'Black', rating: 74.5, slope: 140, yards: 6938 },
      { name: 'Championship', rating: 75.1, slope: 142 },
    ],
    confident: true,
  },
  {
    id: 'whistling-irish',
    name: 'Whistling Straits Irish',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.5, 141),
    pars: WHISTLING_IRISH_PARS,
    tees: [
      { name: 'Red', rating: 65.6, slope: 122, yards: 5109 },
      { name: 'White', rating: 70.3, slope: 133, yards: 5992 },
      { name: 'Green', rating: 72.0, slope: 137, yards: 6366 },
      { name: 'Blue', rating: 73.5, slope: 141, yards: 6750 },
      { name: 'Black', rating: 75.6, slope: 146, yards: 7201 },
    ],
    confident: true,
  },
  {
    id: 'bay-hill',
    name: 'Bay Hill Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 135),
    pars: BAY_HILL_PARS,
    tees: [
      { name: 'Red', rating: 70.5, slope: 124 },
      { name: 'White', rating: 72.6, slope: 129 },
      { name: 'Blue', rating: 73.8, slope: 135 },
      { name: 'Black', rating: 75.4, slope: 140 },
    ],
  },
  {
    id: 'harbour-town',
    name: 'Harbour Town Golf Links',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.9, 126),
    pars: HARBOUR_TOWN_PARS,
    tees: [
      { name: 'Red', rating: 69.2, slope: 118 },
      { name: 'White', rating: 71.5, slope: 123 },
      { name: 'Blue', rating: 72.9, slope: 126 },
      { name: 'Black', rating: 74.6, slope: 130 },
    ],
  },
  {
    id: 'waste-mgmt',
    name: 'TPC Scottsdale Stadium',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.7, 133),
    pars: TPC_SCOTTSDALE_PARS,
    tees: [
      { name: 'Red', rating: 69.5, slope: 121 },
      { name: 'White', rating: 71.4, slope: 126 },
      { name: 'Blue', rating: 72.7, slope: 133 },
      { name: 'Black', rating: 74.2, slope: 136 },
    ],
  },
  {
    id: 'tpc-river-highlands',
    name: 'TPC River Highlands',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.0, 129),
    pars: TPC_RIVER_HIGHLANDS_PARS,
    tees: [
      { name: 'Red', rating: 68.8, slope: 116 },
      { name: 'White', rating: 70.6, slope: 122 },
      { name: 'Blue', rating: 72.0, slope: 129 },
      { name: 'Black', rating: 73.8, slope: 134 },
    ],
  },
  {
    id: 'muirfield-village',
    name: 'Muirfield Village',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 150),
    pars: MUIRFIELD_VILLAGE_PARS,
    tees: [
      { name: 'Grey', rating: 69.8, slope: 144, yards: 5876 },
      { name: 'Green', rating: 70.8, slope: 146, yards: 6096 },
      { name: 'White', rating: 71.8, slope: 147, yards: 6296 },
      { name: 'Blue', rating: 73.8, slope: 150, yards: 6729 },
      { name: 'Memorial', rating: 76.8, slope: 155, yards: 7392 },
    ],
    confident: true,
  },
  {
    id: 'kapalua',
    name: 'Kapalua Plantation',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.3, 129),
    pars: KAPALUA_PLANTATION_PARS,
    tees: [
      { name: 'Red', rating: 69.5, slope: 118 },
      { name: 'White', rating: 71.8, slope: 124 },
      { name: 'Blue', rating: 73.3, slope: 129 },
      { name: 'Black', rating: 75.0, slope: 134 },
    ],
  },
  {
    id: 'waialae',
    name: 'Waialae Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 133),
    pars: WAIALAE_PARS,
    tees: [
      { name: 'Red', rating: 70.2, slope: 122 },
      { name: 'White', rating: 72.5, slope: 128 },
      { name: 'Blue', rating: 73.8, slope: 133 },
      { name: 'Black', rating: 75.2, slope: 136 },
    ],
  },
  {
    id: 'sea-island-seaside',
    name: 'Sea Island Seaside',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: SEA_ISLAND_SEASIDE_PARS,
    tees: [
      { name: 'Red', rating: 69.5, slope: 120 },
      { name: 'White', rating: 71.2, slope: 125 },
      { name: 'Blue', rating: 72.0, slope: 130 },
      { name: 'Black', rating: 73.4, slope: 133 },
    ],
  },
  {
    id: 'spyglass',
    name: 'Spyglass Hill',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.4, 136),
    pars: SPYGLASS_PARS,
    tees: [
      { name: 'Red', rating: 69.5, slope: 120 },
      { name: 'White', rating: 72.0, slope: 127 },
      { name: 'Blue', rating: 73.4, slope: 136 },
      { name: 'Black', rating: 75.0, slope: 141 },
    ],
  },
  {
    id: 'poppy-hills',
    name: 'Poppy Hills',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(71.6, 134),
    pars: POPPY_HILLS_PARS,
    tees: [
      { name: 'Green', rating: 61.8, slope: 103, yards: 4173 },
      { name: 'Orange', rating: 66.2, slope: 120, yards: 5224 },
      { name: 'White', rating: 69.4, slope: 129, yards: 5791 },
      { name: 'Blue', rating: 71.6, slope: 134, yards: 6320 },
      { name: 'Black', rating: 73.2, slope: 139, yards: 6730 },
      { name: 'Jones Tee', rating: 74.9, slope: 142, yards: 7091 },
    ],
    confident: true,
  },
  {
    id: 'cypress-point',
    name: 'Cypress Point',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.1, 139),
    pars: CYPRESS_POINT_PARS,
    tees: [
      { name: 'Green', rating: 69.9, slope: 132, yards: 5769 },
      { name: 'White', rating: 72.1, slope: 139, yards: 6293 },
      { name: 'Blue', rating: 73.1, slope: 141, yards: 6553 },
    ],
    confident: true,
  },
  {
    id: 'shadow-creek',
    name: 'Shadow Creek',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.5, 135),
    pars: P72,
    tees: [
      { name: 'Red', rating: 71.0, slope: 124 },
      { name: 'White', rating: 73.2, slope: 130 },
      { name: 'Blue', rating: 74.5, slope: 135 },
      { name: 'Black', rating: 76.0, slope: 139 },
    ],
    confident: false,
  },
  {
    id: 'wynn-golf',
    name: 'Wynn Golf Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(69.5, 121),
    pars: P72,
    tees: [
      { name: 'Red', rating: 66.8, slope: 112 },
      { name: 'White', rating: 68.2, slope: 116 },
      { name: 'Blue', rating: 69.5, slope: 121 },
      { name: 'Black', rating: 71.2, slope: 126 },
    ],
    confident: false,
  },
  {
    id: 'belfry-brabazon',
    name: 'Belfry Brabazon',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(74.8, 145),
    pars: P72,
    tees: [
      { name: 'Yellow', rating: 72.7, slope: 142 },
      { name: 'White', rating: 74.8, slope: 145 },
    ],
    confident: false,
  },
  {
    id: 'celtic-manor-twenty-ten',
    name: 'Celtic Manor Twenty Ten',
    defaultTee: 'Yellow',
    byPlatform: uniformByPlatform(72.5, 131),
    pars: P72,
    tees: [{ name: 'Yellow', rating: 72.5, slope: 131 }],
    confident: false,
  },
  {
    id: 'gleneagles-kings',
    name: 'Gleneagles Kings',
    defaultTee: 'Yellow',
    byPlatform: uniformByPlatform(71.1, 128),
    pars: P72,
    tees: [
      { name: 'Yellow', rating: 71.1, slope: 128 },
      { name: 'Blue', rating: 75.6, slope: 136 },
    ],
    confident: false,
  },
  {
    id: 'royal-birkdale',
    name: 'Royal Birkdale Golf Club',
    location: 'Southport, England',
    defaultTee: 'Medal',
    byPlatform: uniformByPlatform(73.2, 140),
    pars: ROYAL_BIRKDALE_PARS,
    tees: [
      { name: 'Gold', rating: 68.1, slope: 132 },
      { name: 'White', rating: 70.8, slope: 134 },
      { name: 'Medal', rating: 73.2, slope: 140 },
      { name: 'Red', rating: 74.5, slope: 149 },
      { name: 'Championship', rating: 76.5, slope: 151 },
    ],
  },
  {
    id: 'royal-lytham-st-annes',
    name: 'Royal Lytham St Annes',
    defaultTee: 'Red',
    byPlatform: uniformByPlatform(74.3, 147),
    pars: ROYAL_LYTHAM_PARS,
    tees: [
      { name: 'Green', rating: 72.5, slope: 139, yards: 6346 },
      { name: 'Red', rating: 74.3, slope: 147, yards: 6641 },
      { name: 'Championship', rating: 76.5, slope: 152, yards: 7094 },
    ],
    confident: true,
  },
  {
    id: 'wentworth-west',
    name: 'Wentworth West',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(74.7, 137),
    pars: P72,
    tees: [
      { name: 'Red', rating: 70.5, slope: 124 },
      { name: 'Yellow', rating: 72.8, slope: 130 },
      { name: 'White', rating: 74.7, slope: 137 },
      { name: 'Black', rating: 76.2, slope: 142 },
    ],
    confident: false,
  },
  {
    id: 'sunningdale-old',
    name: 'Sunningdale Old',
    defaultTee: 'Medal',
    byPlatform: uniformByPlatform(68.5, 116),
    pars: SUNNINGDALE_OLD_PARS,
    tees: [
      { name: 'Yellow', rating: 66.1, slope: 113, yards: 6063 },
      { name: 'Medal', rating: 68.5, slope: 116, yards: 6308 },
      { name: 'Championship', rating: 70.0, slope: 122, yards: 6627 },
    ],
    confident: true,
  },
  {
    id: 'valderrama',
    name: 'Valderrama',
    defaultTee: 'Executive',
    byPlatform: uniformByPlatform(71.4, 136),
    pars: VALDERRAMA_PARS,
    tees: [
      { name: 'Mayor', rating: 68.3, slope: 128, yards: 5546 },
      { name: 'Executive', rating: 71.4, slope: 136, yards: 6016 },
      { name: 'Championship', rating: 73.6, slope: 142, yards: 6475 },
      { name: 'Professional', rating: 76.1, slope: 147, yards: 6990 },
    ],
    confident: true,
  },
  {
    id: 'el-saler',
    name: 'El Saler',
    defaultTee: 'Blanca',
    byPlatform: uniformByPlatform(74.2, 136),
    pars: P72,
    tees: [
      { name: 'Amarilla', rating: 72.7, slope: 133 },
      { name: 'Blanca', rating: 74.2, slope: 136 },
    ],
    confident: false,
  },
  {
    id: 'hirono',
    name: 'Hirono Golf Club',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.5, 133),
    pars: P72,
    tees: [
      { name: 'Red', rating: 69.8, slope: 122 },
      { name: 'White', rating: 71.6, slope: 128 },
      { name: 'Blue', rating: 72.5, slope: 133 },
      { name: 'Black', rating: 74.2, slope: 138 },
    ],
    confident: false,
  },
  {
    id: 'kasumigaseki-east',
    name: 'Kasumigaseki East',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.8, 130),
    pars: P72,
    tees: [
      { name: 'Red', rating: 70.0, slope: 122 },
      { name: 'White', rating: 71.8, slope: 127 },
      { name: 'Blue', rating: 72.8, slope: 130 },
      { name: 'Black', rating: 74.4, slope: 135 },
    ],
    confident: false,
  },
  {
    id: 'kingston-heath',
    name: 'Kingston Heath',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.2, 134),
    pars: P72,
    tees: [
      { name: 'Red', rating: 70.2, slope: 124 },
      { name: 'Yellow', rating: 72.0, slope: 129 },
      { name: 'White', rating: 73.2, slope: 134 },
      { name: 'Blue', rating: 74.8, slope: 139 },
    ],
    confident: false,
  },
  {
    id: 'royal-melbourne-west',
    name: 'Royal Melbourne West',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.6, 136),
    pars: P72,
    tees: [
      { name: 'Red', rating: 70.5, slope: 125 },
      { name: 'Green', rating: 72.2, slope: 130 },
      { name: 'White', rating: 73.6, slope: 136 },
      { name: 'Blue', rating: 75.0, slope: 140 },
    ],
    confident: false,
  },
  {
    id: 'cape-kidnappers',
    name: 'Cape Kidnappers',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 139),
    pars: P72,
    tees: [
      { name: 'Red', rating: 70.8, slope: 126 },
      { name: 'White', rating: 72.6, slope: 132 },
      { name: 'Blue', rating: 73.8, slope: 139 },
      { name: 'Black', rating: 75.4, slope: 143 },
    ],
    confident: false,
  },
  {
    id: 'kauri-cliffs',
    name: 'Kauri Cliffs',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.9, 135),
    pars: P72,
    tees: [
      { name: 'Red', rating: 70.0, slope: 124 },
      { name: 'White', rating: 71.8, slope: 129 },
      { name: 'Blue', rating: 72.9, slope: 135 },
      { name: 'Black', rating: 74.5, slope: 140 },
    ],
    confident: false,
  },
  {
    id: 'streamsong-red',
    name: 'Streamsong Red',
    defaultTee: 'Black',
    byPlatform: uniformByPlatform(71.6, 132),
    pars: STREAMSONG_RED_PARS,
    tees: [
      { name: 'Gold', rating: 64.7, slope: 113, yards: 4861 },
      { name: 'Silver', rating: 69.5, slope: 124, yards: 6008 },
      { name: 'Black', rating: 71.6, slope: 132, yards: 6537 },
      { name: 'Green', rating: 74.1, slope: 137, yards: 7110 },
    ],
    confident: true,
  },
  {
    id: 'streamsong-blue',
    name: 'Streamsong Blue',
    defaultTee: 'Black',
    byPlatform: uniformByPlatform(71.8, 130),
    pars: STREAMSONG_BLUE_PARS,
    tees: [
      { name: 'Gold', rating: 66.4, slope: 113, yards: 5512 },
      { name: 'Silver', rating: 69.5, slope: 127, yards: 6192 },
      { name: 'Black', rating: 71.8, slope: 130, yards: 6692 },
      { name: 'Green', rating: 74.0, slope: 134, yards: 7276 },
    ],
    confident: true,
  },
  {
    id: 'streamsong-black',
    name: 'Streamsong Black',
    defaultTee: 'Black',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: STREAMSONG_BLACK_PARS,
    tees: [
      { name: 'Gold', rating: 65.1, slope: 116, yards: 5280 },
      { name: 'Silver', rating: 69.5, slope: 125, yards: 6226 },
      { name: 'Black', rating: 72.0, slope: 130, yards: 6747 },
      { name: 'Green', rating: 74.7, slope: 135, yards: 7320 },
    ],
    confident: true,
  },
  {
    id: 'cabot-links',
    name: 'Cabot Links',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(71.6, 125),
    pars: CABOT_LINKS_PARS,
    tees: [
      { name: 'Blue', rating: 57.5, slope: 94, yards: 3540 },
      { name: 'Orange', rating: 63.3, slope: 106, yards: 4942 },
      { name: 'Silver', rating: 68.4, slope: 123, yards: 6020 },
      { name: 'Green', rating: 70.9, slope: 125, yards: 6455 },
      { name: 'Black', rating: 72.8, slope: 132, yards: 6860 },
    ],
    confident: true,
  },
  {
    id: 'cabot-cliffs',
    name: 'Cabot Cliffs',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(72.5, 142),
    pars: CABOT_CLIFFS_PARS,
    tees: [
      { name: 'Blue', rating: 62.5, slope: 106, yards: 3785 },
      { name: 'Orange', rating: 66.5, slope: 118, yards: 5059 },
      { name: 'Silver', rating: 71.5, slope: 136, yards: 6090 },
      { name: 'Green', rating: 72.5, slope: 142, yards: 6385 },
      { name: 'Black', rating: 74.3, slope: 144, yards: 6764 },
    ],
    confident: true,
  },
  {
    id: 'wolf-creek',
    name: 'Wolf Creek Golf Club',
    location: 'Mesquite, NV',
    defaultTee: 'Champions',
    byPlatform: uniformByPlatform(71.8, 144),
    pars: WOLF_CREEK_PARS,
    tees: [
      { name: 'Classics', rating: 62.8, slope: 114, yards: 4101 },
      { name: 'Signature', rating: 66.1, slope: 117, yards: 5064 },
      { name: 'Masters', rating: 68.8, slope: 137, yards: 5798 },
      { name: 'Champions', rating: 71.8, slope: 144, yards: 6377 },
      { name: 'Challenger', rating: 75.4, slope: 154, yards: 6939 },
    ],
    confident: true,
  },
  {
    id: 'gamble-sands',
    name: 'Gamble Sands',
    defaultTee: 'Sands',
    byPlatform: uniformByPlatform(70.0, 117),
    pars: GAMBLE_SANDS_PARS,
    tees: [
      { name: 'Forward', rating: 62.5, slope: 100, yards: 4804 },
      { name: 'Intermediate', rating: 66.2, slope: 107, yards: 5623 },
      { name: 'Regular', rating: 68.8, slope: 114, yards: 6113 },
      { name: 'Sands', rating: 70.0, slope: 117, yards: 6389 },
      { name: 'Back', rating: 71.4, slope: 120, yards: 6664 },
      { name: 'Medal', rating: 73.7, slope: 125, yards: 7151 },
    ],
    confident: true,
  },
  {
    id: 'arcadia-bluffs',
    name: 'Arcadia Bluffs',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.2, 150),
    pars: ARCADIA_BLUFFS_PARS,
    tees: [
      { name: 'Red', rating: 65.5, slope: 122, yards: 5024 },
      { name: 'Gold', rating: 68.4, slope: 133, yards: 5661 },
      { name: 'White', rating: 71.7, slope: 145, yards: 6389 },
      { name: 'Blue', rating: 74.2, slope: 150, yards: 6913 },
      { name: 'Black - Champion', rating: 75.8, slope: 153, yards: 7300 },
    ],
    confident: true,
  },
  {
    id: 'tobacco-road',
    name: 'Tobacco Road',
    defaultTee: 'Disc Tees',
    byPlatform: uniformByPlatform(71.3, 143),
    pars: TOBACCO_ROAD_PARS,
    tees: [
      { name: 'Cultivator Tees', rating: 62.6, slope: 117, yards: 4296 },
      { name: 'Points Tees', rating: 66.9, slope: 125, yards: 5302 },
      { name: 'Plow Tees', rating: 69.4, slope: 132, yards: 5886 },
      { name: 'Disc Tees', rating: 71.3, slope: 143, yards: 6317 },
      { name: 'Ripper Tees', rating: 72.5, slope: 145, yards: 6557 },
    ],
    confident: true,
  },
  {
    id: 'pinehurst-4',
    name: 'Pinehurst No. 4',
    defaultTee: 'Blue Tees',
    byPlatform: uniformByPlatform(73.7, 135),
    pars: PINEHURST_4_PARS,
    tees: [
      { name: 'Red Tees', rating: 65.4, slope: 116, yards: 5260 },
      { name: 'Green Tees', rating: 68.5, slope: 123, yards: 5864 },
      { name: 'White Tees', rating: 70.8, slope: 131, yards: 6428 },
      { name: 'Blue Tees', rating: 73.7, slope: 135, yards: 6961 },
      { name: 'Gold Tees', rating: 74.9, slope: 138, yards: 7227 },
    ],
    confident: true,
  },
  {
    id: 'pinehurst-8',
    name: 'Pinehurst No. 8',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 133),
    pars: P72,
    confident: false,
  },
  {
    id: 'colonial-cc',
    name: 'Colonial Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(71.9, 127),
    pars: P72,
    confident: false,
  },
  {
    id: 'quail-hollow',
    name: 'Quail Hollow',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.2, 135),
    pars: QUAIL_HOLLOW_PARS,
    tees: [
      { name: 'Red', rating: 70.2, slope: 122 },
      { name: 'White', rating: 72.6, slope: 128 },
      { name: 'Blue', rating: 74.2, slope: 135 },
      { name: 'Black', rating: 75.8, slope: 140 },
    ],
  },
  {
    id: 'sedgefield',
    name: 'Sedgefield Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(71.3, 127),
    pars: P72,
    confident: false,
  },
  {
    id: 'wilmington-cc',
    name: 'Wilmington Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.5, 130),
    pars: P72,
    confident: false,
  },
  {
    id: 'liberty-national',
    name: 'Liberty National',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.2, 131),
    pars: P72,
    confident: false,
  },
  {
    id: 'ridgewood-cc',
    name: 'Ridgewood Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.1, 132),
    pars: P72,
    confident: false,
  },
  {
    id: 'caves-valley',
    name: 'Caves Valley',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.8, 135),
    pars: P72,
    confident: false,
  },
  {
    id: 'workday-bradenton-cc',
    name: 'Workday Championship Bradenton CC',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.0, 128),
    pars: P72,
    confident: false,
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
    confident: false,
  },
  {
    id: 'aronimink',
    name: 'Aronimink Golf Club',
    location: 'Newtown Square, PA',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.2, 130),
    pars: ARONIMINK_PARS,
    tees: [
      redTeeFromChampionship(75.5, 138),
      { name: 'White', rating: 69.7, slope: 125 },
      { name: 'Blue', rating: 72.2, slope: 130 },
      { name: 'Black', rating: 75.5, slope: 138 },
    ],
  },
  {
    id: 'baltusrol-lower',
    name: 'Baltusrol Golf Club (Lower)',
    location: 'Springfield, NJ',
    defaultTee: 'Tillinghast',
    byPlatform: uniformByPlatform(73.9, 139),
    pars: BALTUSROL_LOWER_PARS,
    tees: [
      { name: 'Club', rating: 70.7, slope: 133 },
      { name: 'Baltusrol', rating: 72.2, slope: 136 },
      { name: 'Tillinghast', rating: 73.9, slope: 139 },
      { name: 'Championship', rating: 75.6, slope: 140 },
    ],
  },
  {
    id: 'country-club-brookline',
    name: 'The Country Club (Brookline)',
    location: 'Brookline, MA',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.6, 136),
    pars: BROOKLINE_US_OPEN_PARS,
    tees: [
      { name: 'Red', rating: 67.6, slope: 118 },
      { name: 'White', rating: 71.4, slope: 131 },
      { name: 'Blue', rating: 72.6, slope: 136 },
      { name: 'Black', rating: 73.3, slope: 138 },
    ],
    confident: false,
  },
  {
    id: 'la-country-north',
    name: 'Los Angeles Country Club (North)',
    location: 'Los Angeles, CA',
    defaultTee: 'Black',
    byPlatform: uniformByPlatform(74.6, 139),
    pars: LACC_NORTH_PARS,
    tees: [
      { name: 'Green', rating: 67.7, slope: 122 },
      { name: 'White', rating: 70.2, slope: 131 },
      { name: 'Thomas', rating: 71.8, slope: 134 },
      { name: 'Black', rating: 74.6, slope: 139 },
      { name: 'U.S. Open', rating: 76.9, slope: 148 },
    ],
  },
  {
    id: 'oak-hill-east',
    name: 'Oak Hill Country Club (East)',
    location: 'Rochester, NY',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 145),
    pars: OAK_HILL_EAST_PARS,
    tees: [
      { name: 'White', rating: 71.7, slope: 141 },
      { name: 'Blue', rating: 73.8, slope: 145 },
      { name: 'Black', rating: 75.8, slope: 150 },
      { name: 'Championship', rating: 77.7, slope: 155 },
    ],
  },
  {
    id: 'oakland-hills-south',
    name: 'Oakland Hills Country Club (South)',
    location: 'Bloomfield Hills, MI',
    defaultTee: 'Back',
    byPlatform: uniformByPlatform(76.0, 139),
    pars: OAKLAND_HILLS_SOUTH_PARS,
    tees: [
      { name: 'Forward', rating: 73.2, slope: 135 },
      { name: 'Middle', rating: 74.5, slope: 137 },
      { name: 'Back', rating: 76.0, slope: 139 },
      { name: 'Championship', rating: 76.9, slope: 145 },
    ],
  },
  {
    id: 'pga-frisco-east',
    name: 'PGA Frisco (Fields Ranch East)',
    location: 'Frisco, TX',
    defaultTee: 'II',
    byPlatform: uniformByPlatform(75.8, 146),
    pars: FIELDS_RANCH_EAST_PARS,
    tees: [
      { name: 'IV', rating: 69.4, slope: 132 },
      { name: 'III', rating: 73.0, slope: 142 },
      { name: 'II', rating: 75.8, slope: 146 },
      { name: 'I', rating: 77.2, slope: 150 },
      { name: 'PGA Championship', rating: 78.9, slope: 151 },
    ],
    confident: false,
  },
  {
    id: 'shinnecock-hills',
    name: 'Shinnecock Hills Golf Club',
    location: 'Southampton, NY',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(72.5, 140),
    pars: SHINNECOCK_PARS,
    tees: [
      { name: 'White', rating: 67.4, slope: 128 },
      { name: 'Blue', rating: 70.8, slope: 135 },
      { name: 'Green', rating: 72.5, slope: 140 },
      { name: 'Red', rating: 74.7, slope: 145 },
    ],
  },
  {
    id: 'winged-foot',
    name: 'Winged Foot Golf Club (West)',
    location: 'Mamaroneck, NY',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(76.4, 140),
    pars: WINGED_FOOT_WEST_PARS,
    tees: [
      { name: 'White', rating: 67.4, slope: 124 },
      { name: 'Green', rating: 72.2, slope: 132 },
      { name: 'Blue', rating: 76.4, slope: 140 },
    ],
  },
  {
    id: 'black-desert-resort',
    name: 'Black Desert Resort',
    location: 'Ivins, UT',
    defaultTee: 'Black Desert',
    byPlatform: uniformByPlatform(73.3, 134),
    pars: BLACK_DESERT_PARS,
    tees: [
      { name: 'Red Cliffs', rating: 63.4, slope: 112, yards: 4916 },
      { name: 'Snow Canyon', rating: 67.1, slope: 120, yards: 5634 },
      { name: 'Combination', rating: 68.7, slope: 126, yards: 5982 },
      { name: 'Weiskopf', rating: 71.2, slope: 128, yards: 6474 },
      { name: 'Black Desert', rating: 73.3, slope: 134, yards: 6917 },
      { name: 'Tournament', rating: 75.4, slope: 139, yards: 7393 },
    ],
    confident: true,
  },
  {
    id: 'sand-hollow-resort',
    name: 'Sand Hollow Resort',
    location: 'Hurricane, UT',
    defaultTee: 'Championship',
    byPlatform: uniformByPlatform(72.2, 132),
    pars: SAND_HOLLOW_CHAMP_PARS,
    tees: [
      { name: 'Resort', rating: 65.8, slope: 108, yards: 5306 },
      { name: 'Fought - Combo', rating: 67.5, slope: 116, yards: 5934 },
      { name: 'Signature', rating: 69.4, slope: 125, yards: 6462 },
      { name: 'Championship', rating: 72.2, slope: 132, yards: 6893 },
      { name: 'Tournament', rating: 74.0, slope: 137, yards: 7315 },
    ],
    confident: true,
  },
  {
    id: 'coral-canyon',
    name: 'Coral Canyon Golf Course',
    location: 'Washington, UT',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.6, 143),
    pars: CORAL_CANYON_PARS,
    tees: [
      { name: 'Red', rating: 64.1, slope: 118, yards: 4676 },
      { name: 'White', rating: 69.0, slope: 128, yards: 5810 },
      { name: 'Blue', rating: 72.6, slope: 143, yards: 6580 },
      { name: 'Black', rating: 75.2, slope: 148, yards: 7146 },
    ],
    confident: true,
  },
  {
    id: 'the-ledges',
    name: 'The Ledges Golf Club',
    location: 'St. George, UT',
    defaultTee: 'Black',
    byPlatform: uniformByPlatform(73.4, 131),
    pars: LEDGES_PARS,
    tees: [
      { name: 'Red', rating: 63.5, slope: 106, yards: 5132 },
      { name: 'Silver', rating: 66.3, slope: 116, yards: 5742 },
      { name: 'White', rating: 69.0, slope: 120, yards: 6276 },
      { name: 'Blue', rating: 71.1, slope: 127, yards: 6715 },
      { name: 'Black', rating: 73.4, slope: 131, yards: 7190 },
    ],
    confident: true,
  },
  {
    id: 'entrada-snow-canyon',
    name: 'Entrada at Snow Canyon',
    location: 'St. George, UT',
    defaultTee: 'I',
    byPlatform: uniformByPlatform(73.5, 139),
    pars: ENTRADA_PARS,
    tees: [
      { name: 'IV', rating: 66.6, slope: 117, yards: 5569 },
      { name: 'III', rating: 68.8, slope: 129, yards: 6066 },
      { name: 'II', rating: 71.2, slope: 135, yards: 6552 },
      { name: 'I', rating: 73.5, slope: 139, yards: 7053 },
    ],
    confident: true,
  },
  {
    id: 'sky-mountain',
    name: 'Sky Mountain Golf Course',
    location: 'Hurricane, UT',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(70.4, 125),
    pars: SKY_MOUNTAIN_PARS,
    tees: [
      { name: 'White', rating: 67.8, slope: 118, yards: 5775 },
      { name: 'Blue', rating: 70.4, slope: 125, yards: 6352 },
    ],
    confident: true,
  },
  {
    id: 'conestoga',
    name: 'Conestoga Golf Club',
    location: 'Mesquite, NV',
    defaultTee: 'Black',
    byPlatform: uniformByPlatform(74.9, 137),
    pars: CONESTOGA_PARS,
    tees: [
      { name: 'Jade', rating: 64.3, slope: 107, yards: 5017 },
      { name: 'Copper', rating: 68.3, slope: 114, yards: 5889 },
      { name: 'Silver', rating: 70.1, slope: 127, yards: 6378 },
      { name: 'Gold', rating: 72.3, slope: 132, yards: 6751 },
      { name: 'Black', rating: 74.9, slope: 137, yards: 7232 },
    ],
    confident: true,
  },
  {
    id: 'the-palms-mesquite',
    name: 'The Palms Golf Club',
    location: 'Mesquite, NV',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.2, 131),
    pars: PALMS_MESQUITE_PARS,
    tees: [
      { name: 'Gold', rating: 66.1, slope: 116, yards: 5377 },
      { name: 'White', rating: 69.7, slope: 126, yards: 6178 },
      { name: 'Blue', rating: 73.2, slope: 131, yards: 6860 },
    ],
    confident: true,
  },
  {
    id: 'falcon-ridge',
    name: 'Falcon Ridge Golf Club',
    location: 'Mesquite, NV',
    defaultTee: 'Black',
    byPlatform: uniformByPlatform(70.9, 135),
    pars: FALCON_RIDGE_PARS,
    tees: [
      { name: 'Maroon', rating: 62.5, slope: 112, yards: 4440 },
      { name: 'Gold', rating: 66.0, slope: 114, yards: 5279 },
      { name: 'Silver', rating: 68.9, slope: 127, yards: 6061 },
      { name: 'Black', rating: 70.9, slope: 135, yards: 6569 },
    ],
    confident: true,
  },
  {
    id: 'oasis-palmer',
    name: 'Oasis Golf Club (Palmer Course)',
    location: 'Mesquite, NV',
    defaultTee: 'Black',
    byPlatform: uniformByPlatform(71.5, 138),
    pars: OASIS_PALMER_PARS,
    tees: [
      { name: 'Gold', rating: 64.6, slope: 108, yards: 4978 },
      { name: 'White', rating: 67.1, slope: 122, yards: 5545 },
      { name: 'Blue', rating: 69.3, slope: 128, yards: 6010 },
      { name: 'Black', rating: 71.5, slope: 138, yards: 6442 },
    ],
    confident: true,
  },
];

export function getCourseById(id: string): CourseSeed | undefined {
  return COURSE_SEEDS.find((c) => c.id === id);
}

/** Resolve a catalog `courseId` from the display name stored on matches / rounds. */
export function findCourseSeedIdByCourseName(courseName: string): string | null {
  const needle = courseName.trim().toLowerCase();
  if (!needle) return null;
  for (const c of COURSE_SEEDS) {
    if (c.name.trim().toLowerCase() === needle) return c.id;
  }
  for (const c of COURSE_SEEDS) {
    const n = c.name.trim().toLowerCase();
    if (n.includes(needle) || needle.includes(n)) return c.id;
  }
  return null;
}

/** Baseline rating/slope from `byPlatform` only (ignores `tees` table). */
export function ratingForCourseFromPlatform(course: CourseSeed, platform: PlatformId): { rating: number; slope: number } {
  const direct = course.byPlatform[platform];
  if (direct) return direct;
  for (const p of PLATFORMS) {
    const x = course.byPlatform[p];
    if (x) return x;
  }
  return { rating: 72, slope: 130 };
}

/**
 * Tees offered when logging a round. Famous courses use `tees` on the seed; others get Red + default from platform baseline.
 */
export function getCourseTees(course: CourseSeed, platform: PlatformId): CourseTee[] {
  if (course.tees && course.tees.length > 0) {
    return course.tees.map((t) => ({ ...t, rating: round1(t.rating), slope: Math.round(t.slope) }));
  }
  const base = ratingForCourseFromPlatform(course, platform);
  const defaultLabel = course.defaultTee?.trim() ? course.defaultTee.trim() : 'Default';
  const red = redTeeFromChampionship(base.rating, base.slope);
  if (defaultLabel === 'Red') {
    return [
      red,
      {
        name: 'White',
        rating: round1(Math.min(78, base.rating + 2.8)),
        slope: Math.min(155, base.slope + 10),
      },
    ];
  }
  return [
    red,
    { name: defaultLabel, rating: round1(base.rating), slope: Math.round(base.slope) },
  ];
}

/** Middle tee row (used when `confident === false`). */
export function middleCourseTee(course: CourseSeed, platform: PlatformId): CourseTee | null {
  const tees = getCourseTees(course, platform);
  if (tees.length === 0) return null;
  return tees[Math.floor(tees.length / 2)];
}

/** Rating/slope for the course’s default tee (used by Crew Match Calculator, previews, etc.). */
export function ratingForCourse(course: CourseSeed, platform: PlatformId) {
  const tees = getCourseTees(course, platform);
  if (course.confident === false && tees.length > 0) {
    const mid = tees[Math.floor(tees.length / 2)];
    return { rating: mid.rating, slope: mid.slope };
  }
  const def = course.defaultTee?.trim();
  if (def) {
    const hit = tees.find((t) => t.name === def);
    if (hit) return { rating: hit.rating, slope: hit.slope };
  }
  const last = tees[tees.length - 1];
  return { rating: last.rating, slope: last.slope };
}

/** Case-insensitive substring match on display name (course picker search). */
export function courseMatchesSearch(course: CourseSeed, rawQuery: string): boolean {
  const q = normalizeCourseName(rawQuery);
  if (!q) return true;
  if (normalizeCourseName(course.name).includes(q)) return true;
  if (course.location && normalizeCourseName(course.location).includes(q)) return true;
  return false;
}
