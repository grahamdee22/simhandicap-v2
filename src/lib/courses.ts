import type { PlatformId } from './constants';
import { PLATFORMS } from './constants';

/** One playable tee (WHS-style course rating + slope). */
export type CourseTee = {
  name: string;
  rating: number;
  slope: number;
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
    pars: P72,
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
    pars: P72,
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
    pars: P72,
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
    pars: P72,
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
    pars: P72,
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
    pars: P72,
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
    pars: P72,
    tees: [
      { name: 'Silver', rating: 66.0, slope: 112 },
      { name: 'Gold', rating: 69.3, slope: 120 },
      { name: 'Green', rating: 71.5, slope: 125 },
      { name: 'Black', rating: 73.6, slope: 129 },
      { name: 'Taupe', rating: 75.8, slope: 134 },
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
    pars: P72,
    tees: [
      { name: 'Red', rating: 64.0, slope: 102 },
      { name: 'White', rating: 69.4, slope: 119 },
      { name: 'Blue', rating: 73.2, slope: 125 },
      { name: 'Tiger', rating: 75.6, slope: 132 },
    ],
    confident: true,
  },
  {
    id: 'pasatiempo',
    name: 'Pasatiempo Golf Club',
    location: 'Santa Cruz, CA',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: P72,
    tees: [
      { name: 'Hollins', rating: 63.2, slope: 117 },
      { name: 'Green', rating: 68.5, slope: 132 },
      { name: 'White', rating: 70.8, slope: 134 },
      { name: 'Gold', rating: 72.5, slope: 141 },
    ],
    confident: true,
  },
  {
    id: 'prairie-dunes',
    name: 'Prairie Dunes Country Club',
    location: 'Hutchinson, KS',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: P72,
    tees: [
      { name: 'Bronze', rating: 67.4, slope: 131 },
      { name: 'Silver', rating: 69.2, slope: 135 },
      { name: 'White', rating: 72.3, slope: 141 },
      { name: 'Blue', rating: 74.1, slope: 144 },
      { name: 'Gold', rating: 75.5, slope: 148 },
    ],
    confident: true,
  },
  {
    id: 'sand-hills',
    name: 'Sand Hills Golf Club',
    location: 'Mullen, NE',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: P72,
    tees: [{ name: 'White', rating: 72.0, slope: 130 }],
    confident: false,
  },
  {
    id: 'whistling',
    name: 'Whistling Straits',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(75.1, 140),
    pars: P72,
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
    pars: P72,
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
    pars: P72,
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
    pars: P72,
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
    pars: P72,
    tees: [
      { name: 'Green', rating: 67.3, slope: 118 },
      { name: 'Silver', rating: 68.6, slope: 121 },
      { name: 'White', rating: 70.7, slope: 129 },
      { name: 'Gold', rating: 72.9, slope: 134 },
      { name: 'Blue', rating: 75.4, slope: 138 },
      { name: 'Championship', rating: 76.8, slope: 141 },
    ],
    confident: true,
  },
  {
    id: 'olympic-lake',
    name: 'Olympic Club Lake',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(71.8, 130),
    pars: P72,
    tees: [
      { name: 'Red', rating: 69.3, slope: 128 },
      { name: 'White', rating: 71.8, slope: 130 },
      { name: 'Blue', rating: 73.2, slope: 134 },
      { name: 'Black', rating: 75.0, slope: 138 },
      { name: 'Champ', rating: 75.8, slope: 140 },
    ],
    confident: true,
  },
  {
    id: 'riviera',
    name: 'Riviera Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 134),
    pars: P72,
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
    pars: P72,
    tees: [
      { name: 'Teal', rating: 63.0, slope: 109 },
      { name: 'White', rating: 68.0, slope: 122 },
      { name: 'Sand', rating: 70.6, slope: 130 },
      { name: 'Blue', rating: 72.4, slope: 134 },
      { name: 'Black', rating: 74.4, slope: 138 },
      { name: 'Champ', rating: 77.6, slope: 145 },
    ],
    confident: true,
  },
  {
    id: 'erin-hills',
    name: 'Erin Hills',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(75.2, 131),
    pars: P72,
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
    pars: P72,
    tees: [
      { name: 'Black', rating: 71.2, slope: 131 },
      { name: 'White', rating: 71.4, slope: 143 },
      { name: 'Gold', rating: 73.4, slope: 148 },
      { name: 'Blue', rating: 75.6, slope: 152 },
      { name: 'Tournament', rating: 78.0, slope: 155 },
    ],
    confident: true,
  },
  {
    id: 'southern-hills',
    name: 'Southern Hills',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.8, 139),
    pars: P72,
    tees: [
      { name: 'Silver', rating: 70.6, slope: 122 },
      { name: 'Gold', rating: 70.0, slope: 127 },
      { name: 'White', rating: 71.0, slope: 128 },
      { name: 'Blue', rating: 72.8, slope: 139 },
    ],
    confident: true,
  },
  {
    id: 'valhalla',
    name: 'Valhalla Golf Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(69.9, 132),
    pars: P72,
    tees: [
      { name: 'Silver', rating: 66.2, slope: 126 },
      { name: 'Blue', rating: 69.9, slope: 132 },
      { name: 'Green', rating: 72.3, slope: 143 },
      { name: 'Black', rating: 74.7, slope: 150 },
      { name: 'Gold', rating: 77.5, slope: 154 },
    ],
    confident: true,
  },
  {
    id: 'east-lake',
    name: 'East Lake Golf Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(71.7, 130),
    pars: P72,
    tees: [
      { name: 'Gold', rating: 66.9, slope: 122 },
      { name: 'Blue', rating: 71.7, slope: 130 },
      { name: 'Black', rating: 73.9, slope: 136 },
    ],
    confident: true,
  },
  {
    id: 'carnoustie',
    name: 'Carnoustie Championship',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(75.0, 139),
    pars: P72,
    tees: [
      { name: 'Red', rating: 71.0, slope: 130 },
      { name: 'Yellow', rating: 73.6, slope: 135 },
      { name: 'White', rating: 75.0, slope: 139 },
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
    byPlatform: uniformByPlatform(72.5, 139),
    pars: P72,
    tees: [
      { name: 'Blue', rating: 70.4, slope: 132 },
      { name: 'White', rating: 72.5, slope: 139 },
      { name: 'Black', rating: 73.8, slope: 142 },
    ],
    confident: true,
  },
  {
    id: 'portrush-dunluce',
    name: 'Royal Portrush Dunluce',
    defaultTee: 'Medal',
    byPlatform: uniformByPlatform(72.4, 131),
    pars: P72,
    tees: [
      { name: 'Society', rating: 70.0, slope: 113 },
      { name: 'Medal', rating: 72.4, slope: 131 },
      { name: 'Championship', rating: 70.0, slope: 113 },
    ],
    confident: true,
  },
  {
    id: 'troon-old',
    name: 'Royal Troon Old',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.4, 140),
    pars: P72,
    tees: [
      { name: 'Yellow', rating: 71.5, slope: 136 },
      { name: 'White', rating: 73.4, slope: 140 },
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
    pars: P72,
    tees: [
      { name: 'Royal Blue', rating: 61.6, slope: 105 },
      { name: 'Gold', rating: 69.1, slope: 124 },
      { name: 'Green', rating: 71.1, slope: 133 },
      { name: 'Black', rating: 73.5, slope: 143 },
    ],
    confident: true,
  },
  {
    id: 'bandon-trails',
    name: 'Bandon Trails',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(72.0, 137),
    pars: P72,
    tees: [
      { name: 'Royal Blue', rating: 63.0, slope: 113 },
      { name: 'Orange', rating: 66.7, slope: 126 },
      { name: 'Gold', rating: 69.6, slope: 132 },
      { name: 'Green', rating: 72.0, slope: 137 },
      { name: 'Black', rating: 74.9, slope: 136 },
    ],
    confident: true,
  },
  {
    id: 'pacific-dunes',
    name: 'Pacific Dunes',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(70.8, 135),
    pars: P72,
    tees: [
      { name: 'Royal Blue', rating: 61.5, slope: 113 },
      { name: 'Orange', rating: 65.8, slope: 126 },
      { name: 'Gold', rating: 68.9, slope: 131 },
      { name: 'Green', rating: 70.8, slope: 135 },
      { name: 'Black', rating: 73.2, slope: 143 },
    ],
    confident: true,
  },
  {
    id: 'old-macdonald',
    name: 'Old Macdonald',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(71.4, 127),
    pars: P72,
    tees: [
      { name: 'Royal Blue', rating: 62.6, slope: 104 },
      { name: 'Gold', rating: 67.8, slope: 117 },
      { name: 'Green', rating: 71.4, slope: 127 },
      { name: 'Black', rating: 74.4, slope: 134 },
    ],
    confident: true,
  },
  {
    id: 'sheep-ranch',
    name: 'Sheep Ranch',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(70.0, 116),
    pars: P72,
    tees: [
      { name: 'Royal Blue', rating: 61.0, slope: 97 },
      { name: 'Gold', rating: 67.9, slope: 109 },
      { name: 'Green', rating: 70.0, slope: 116 },
      { name: 'Black', rating: 71.9, slope: 121 },
    ],
    confident: true,
  },
  {
    id: 'sand-valley',
    name: 'Sand Valley',
    defaultTee: 'Sand',
    byPlatform: uniformByPlatform(70.2, 129),
    pars: P72,
    tees: [
      { name: 'Royal Blue', rating: 60.8, slope: 100 },
      { name: 'Silver', rating: 63.9, slope: 113 },
      { name: 'Green', rating: 67.4, slope: 123 },
      { name: 'Sand', rating: 70.2, slope: 129 },
      { name: 'Orange', rating: 72.8, slope: 138 },
      { name: 'Black', rating: 74.5, slope: 140 },
      { name: 'Championship', rating: 75.1, slope: 142 },
    ],
    confident: true,
  },
  {
    id: 'whistling-irish',
    name: 'Whistling Straits Irish',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.5, 141),
    pars: P72,
    tees: [
      { name: 'Red', rating: 65.6, slope: 122 },
      { name: 'White', rating: 70.3, slope: 133 },
      { name: 'Green', rating: 72.0, slope: 137 },
      { name: 'Blue', rating: 73.5, slope: 141 },
      { name: 'Black', rating: 75.6, slope: 146 },
    ],
    confident: true,
  },
  {
    id: 'bay-hill',
    name: 'Bay Hill Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 135),
    pars: P72,
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
    pars: P72,
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
    pars: P72,
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
    pars: P72,
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
    pars: P72,
    tees: [
      { name: 'Grey', rating: 69.8, slope: 144 },
      { name: 'Green', rating: 70.8, slope: 146 },
      { name: 'White', rating: 71.8, slope: 147 },
      { name: 'Blue', rating: 73.8, slope: 150 },
      { name: 'Memorial', rating: 76.8, slope: 155 },
    ],
    confident: true,
  },
  {
    id: 'kapalua',
    name: 'Kapalua Plantation',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.3, 129),
    pars: P72,
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
    pars: P72,
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
    pars: P72,
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
    pars: P72,
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
    pars: P72,
    tees: [
      { name: 'Green', rating: 61.8, slope: 103 },
      { name: 'Orange', rating: 66.2, slope: 120 },
      { name: 'White', rating: 69.4, slope: 129 },
      { name: 'Blue', rating: 71.6, slope: 134 },
      { name: 'Black', rating: 73.2, slope: 139 },
      { name: 'Jones Tee', rating: 74.9, slope: 142 },
    ],
    confident: true,
  },
  {
    id: 'cypress-point',
    name: 'Cypress Point',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.1, 139),
    pars: P72,
    tees: [
      { name: 'Green', rating: 69.9, slope: 132 },
      { name: 'White', rating: 72.1, slope: 139 },
      { name: 'Blue', rating: 73.1, slope: 141 },
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
    name: 'Royal Birkdale',
    defaultTee: 'Yellow',
    byPlatform: uniformByPlatform(72.0, 132),
    pars: P72,
    tees: [{ name: 'Yellow', rating: 72.0, slope: 132 }],
    confident: false,
  },
  {
    id: 'royal-lytham-st-annes',
    name: 'Royal Lytham St Annes',
    defaultTee: 'Red',
    byPlatform: uniformByPlatform(74.3, 147),
    pars: P72,
    tees: [
      { name: 'Green', rating: 72.5, slope: 139 },
      { name: 'Red', rating: 74.3, slope: 147 },
      { name: 'Championship', rating: 76.5, slope: 152 },
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
    pars: P72,
    tees: [
      { name: 'Yellow', rating: 66.1, slope: 113 },
      { name: 'Medal', rating: 68.5, slope: 116 },
      { name: 'Championship', rating: 70.0, slope: 122 },
    ],
    confident: true,
  },
  {
    id: 'valderrama',
    name: 'Valderrama',
    defaultTee: 'Executive',
    byPlatform: uniformByPlatform(71.2, 141),
    pars: P72,
    tees: [
      { name: 'Mayor', rating: 68.3, slope: 128 },
      { name: 'Executive', rating: 71.2, slope: 141 },
      { name: 'Championship', rating: 73.6, slope: 142 },
      { name: 'Professional', rating: 76.1, slope: 147 },
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
    pars: P72,
    tees: [
      { name: 'Gold', rating: 64.7, slope: 113 },
      { name: 'Silver', rating: 69.5, slope: 124 },
      { name: 'Black', rating: 71.6, slope: 132 },
      { name: 'Green', rating: 74.1, slope: 137 },
    ],
    confident: true,
  },
  {
    id: 'streamsong-blue',
    name: 'Streamsong Blue',
    defaultTee: 'Black',
    byPlatform: uniformByPlatform(71.8, 130),
    pars: P72,
    tees: [
      { name: 'Gold', rating: 66.4, slope: 113 },
      { name: 'Silver', rating: 69.5, slope: 127 },
      { name: 'Black', rating: 71.8, slope: 130 },
      { name: 'Green', rating: 74.0, slope: 134 },
    ],
    confident: true,
  },
  {
    id: 'streamsong-black',
    name: 'Streamsong Black',
    defaultTee: 'Black',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: P72,
    tees: [
      { name: 'Gold', rating: 65.1, slope: 116 },
      { name: 'Silver', rating: 69.5, slope: 125 },
      { name: 'Black', rating: 72.0, slope: 130 },
      { name: 'Green', rating: 74.7, slope: 135 },
    ],
    confident: true,
  },
  {
    id: 'cabot-links',
    name: 'Cabot Links',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(70.9, 125),
    pars: P72,
    tees: [
      { name: 'Blue', rating: 57.5, slope: 94 },
      { name: 'Orange', rating: 63.3, slope: 106 },
      { name: 'Silver', rating: 68.4, slope: 123 },
      { name: 'Green', rating: 70.9, slope: 125 },
      { name: 'Black', rating: 72.8, slope: 132 },
    ],
    confident: true,
  },
  {
    id: 'cabot-cliffs',
    name: 'Cabot Cliffs',
    defaultTee: 'Green',
    byPlatform: uniformByPlatform(72.5, 142),
    pars: P72,
    tees: [
      { name: 'Blue', rating: 62.5, slope: 106 },
      { name: 'Orange', rating: 66.5, slope: 118 },
      { name: 'Silver', rating: 71.5, slope: 136 },
      { name: 'Green', rating: 72.5, slope: 142 },
      { name: 'Black', rating: 74.3, slope: 144 },
    ],
    confident: true,
  },
  {
    id: 'wolf-creek',
    name: 'Wolf Creek',
    defaultTee: 'Champions - Blue',
    byPlatform: uniformByPlatform(71.1, 140),
    pars: P72,
    tees: [
      { name: 'Classics - Red', rating: 61.4, slope: 109 },
      { name: 'Signature - Gold', rating: 64.6, slope: 116 },
      { name: 'Masters - White', rating: 69.0, slope: 133 },
      { name: 'Champions - Blue', rating: 71.1, slope: 140 },
      { name: 'Challenger - Black', rating: 74.4, slope: 147 },
    ],
    confident: true,
  },
  {
    id: 'gamble-sands',
    name: 'Gamble Sands',
    defaultTee: 'Sands',
    byPlatform: uniformByPlatform(70.0, 117),
    pars: P72,
    tees: [
      { name: 'Forward', rating: 62.5, slope: 100 },
      { name: 'Intermediate', rating: 66.2, slope: 107 },
      { name: 'Regular', rating: 68.8, slope: 114 },
      { name: 'Sands', rating: 70.0, slope: 117 },
      { name: 'Back', rating: 71.4, slope: 120 },
      { name: 'Medal', rating: 73.7, slope: 125 },
    ],
    confident: true,
  },
  {
    id: 'arcadia-bluffs',
    name: 'Arcadia Bluffs',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.2, 150),
    pars: P72,
    tees: [
      { name: 'Red', rating: 65.5, slope: 122 },
      { name: 'Gold', rating: 68.4, slope: 133 },
      { name: 'White', rating: 71.7, slope: 145 },
      { name: 'Blue', rating: 74.2, slope: 150 },
      { name: 'Black - Champion', rating: 75.8, slope: 153 },
    ],
    confident: true,
  },
  {
    id: 'tobacco-road',
    name: 'Tobacco Road',
    defaultTee: 'Disc Tees',
    byPlatform: uniformByPlatform(71.3, 143),
    pars: P72,
    tees: [
      { name: 'Cultivator Tees', rating: 62.6, slope: 117 },
      { name: 'Points Tees', rating: 66.9, slope: 125 },
      { name: 'Plow Tees', rating: 69.4, slope: 132 },
      { name: 'Disc Tees', rating: 71.3, slope: 143 },
      { name: 'Ripper Tees', rating: 72.5, slope: 145 },
    ],
    confident: true,
  },
  {
    id: 'pinehurst-4',
    name: 'Pinehurst No. 4',
    defaultTee: 'Blue Tees',
    byPlatform: uniformByPlatform(73.7, 135),
    pars: P72,
    tees: [
      { name: 'Red Tees', rating: 65.4, slope: 116 },
      { name: 'Green Tees', rating: 68.5, slope: 123 },
      { name: 'White Tees', rating: 70.8, slope: 131 },
      { name: 'Blue Tees', rating: 73.7, slope: 135 },
      { name: 'Gold Tees', rating: 74.9, slope: 138 },
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
    pars: P72,
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
    confident: false,
  },
];

export function getCourseById(id: string): CourseSeed | undefined {
  return COURSE_SEEDS.find((c) => c.id === id);
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

/** Rating/slope for the course’s default tee (used by net calculator, previews, etc.). */
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

const normSearch = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Case-insensitive substring match on display name (course picker search). */
export function courseMatchesSearch(course: CourseSeed, rawQuery: string): boolean {
  const q = normSearch(rawQuery);
  if (!q) return true;
  if (normSearch(course.name).includes(q)) return true;
  if (course.location && normSearch(course.location).includes(q)) return true;
  return false;
}
