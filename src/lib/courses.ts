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
    byPlatform: uniformByPlatform(74.7, 135),
    pars: PEBBLE_PARS,
  },
  {
    id: 'augusta',
    name: 'Augusta National Golf Club',
    defaultTee: 'Member',
    byPlatform: uniformByPlatform(76.2, 137),
    pars: P72,
  },
  {
    id: 'sawgrass',
    name: 'TPC Sawgrass',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.7, 135),
    pars: P72,
  },
  {
    id: 'bethpage',
    name: 'Bethpage Black',
    defaultTee: 'Black',
    byPlatform: uniformByPlatform(75.4, 144),
    pars: P72,
  },
  {
    id: 'pinehurst',
    name: 'Pinehurst No. 2',
    defaultTee: 'Gold',
    byPlatform: uniformByPlatform(75.0, 131),
    pars: P72,
  },
  {
    id: 'st-andrews',
    name: 'St Andrews Old Course',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.1, 132),
    pars: P72,
  },
  {
    id: 'torrey-south',
    name: 'Torrey Pines South',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(75.3, 144),
    pars: P72,
  },
  {
    id: 'whistling',
    name: 'Whistling Straits',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(76.4, 151),
    pars: P72,
  },
  {
    id: 'ocean',
    name: 'Kiawah Island Ocean',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.7, 141),
    pars: P72,
  },
  {
    id: 'oakmont',
    name: 'Oakmont Country Club',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(76.8, 139),
    pars: P72,
  },
  {
    id: 'merion-east',
    name: 'Merion Golf Club East',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(74.5, 144),
    pars: P72,
  },
  {
    id: 'congressional-blue',
    name: 'Congressional Blue',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(75.3, 139),
    pars: P72,
  },
  {
    id: 'olympic-lake',
    name: 'Olympic Club Lake',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.9, 137),
    pars: P72,
  },
  {
    id: 'riviera',
    name: 'Riviera Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.9, 138),
    pars: P72,
  },
  {
    id: 'chambers-bay',
    name: 'Chambers Bay',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.5, 138),
    pars: P72,
  },
  {
    id: 'erin-hills',
    name: 'Erin Hills',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(76.4, 134),
    pars: P72,
  },
  {
    id: 'hazeltine',
    name: 'Hazeltine National',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(75.3, 135),
    pars: P72,
  },
  {
    id: 'southern-hills',
    name: 'Southern Hills',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.6, 133),
    pars: P72,
  },
  {
    id: 'valhalla',
    name: 'Valhalla Golf Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(75.2, 138),
    pars: P72,
  },
  {
    id: 'east-lake',
    name: 'East Lake Golf Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.5, 133),
    pars: P72,
  },
  {
    id: 'carnoustie',
    name: 'Carnoustie Championship',
    defaultTee: 'Medal',
    byPlatform: uniformByPlatform(73.4, 129),
    pars: P72,
  },
  {
    id: 'royal-st-georges',
    name: 'Royal St Georges',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.9, 132),
    pars: P72,
  },
  {
    id: 'muirfield',
    name: 'Muirfield',
    defaultTee: 'Medal',
    byPlatform: uniformByPlatform(73.5, 132),
    pars: P72,
  },
  {
    id: 'portrush-dunluce',
    name: 'Royal Portrush Dunluce',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(74.2, 130),
    pars: P72,
  },
  {
    id: 'troon-old',
    name: 'Royal Troon Old',
    defaultTee: 'Medal',
    byPlatform: uniformByPlatform(72.8, 129),
    pars: P72,
  },
  {
    id: 'turnberry-ailsa',
    name: 'Turnberry Ailsa',
    defaultTee: 'Medal',
    byPlatform: uniformByPlatform(73.7, 131),
    pars: P72,
  },
  {
    id: 'bandon-dunes',
    name: 'Bandon Dunes',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.1, 130),
    pars: P72,
  },
  {
    id: 'bandon-trails',
    name: 'Bandon Trails',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(74.1, 139),
    pars: P72,
  },
  {
    id: 'pacific-dunes',
    name: 'Pacific Dunes',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.9, 138),
    pars: P72,
  },
  {
    id: 'sand-valley',
    name: 'Sand Valley',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.6, 130),
    pars: P72,
  },
  {
    id: 'whistling-irish',
    name: 'Whistling Straits Irish',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 138),
    pars: P72,
  },
  {
    id: 'bay-hill',
    name: 'Bay Hill Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 135),
    pars: P72,
  },
  {
    id: 'harbour-town',
    name: 'Harbour Town Golf Links',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.9, 126),
    pars: P72,
  },
  {
    id: 'waste-mgmt',
    name: 'TPC Scottsdale Stadium',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.7, 133),
    pars: P72,
  },
  {
    id: 'tpc-river-highlands',
    name: 'TPC River Highlands',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.0, 129),
    pars: P72,
  },
  {
    id: 'muirfield-village',
    name: 'Muirfield Village',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.2, 137),
    pars: P72,
  },
  {
    id: 'kapalua',
    name: 'Kapalua Plantation',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.3, 129),
    pars: P72,
  },
  {
    id: 'waialae',
    name: 'Waialae Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 133),
    pars: P72,
  },
  {
    id: 'sea-island-seaside',
    name: 'Sea Island Seaside',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.0, 130),
    pars: P72,
  },
  {
    id: 'spyglass',
    name: 'Spyglass Hill',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.4, 136),
    pars: P72,
  },
  {
    id: 'poppy-hills',
    name: 'Poppy Hills',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.4, 134),
    pars: P72,
  },
  {
    id: 'cypress-point',
    name: 'Cypress Point',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.9, 136),
    pars: P72,
  },
  {
    id: 'shadow-creek',
    name: 'Shadow Creek',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.5, 135),
    pars: P72,
  },
  {
    id: 'wynn-golf',
    name: 'Wynn Golf Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(69.5, 121),
    pars: P72,
  },
  {
    id: 'belfry-brabazon',
    name: 'Belfry Brabazon',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.3, 130),
    pars: P72,
  },
  {
    id: 'celtic-manor-twenty-ten',
    name: 'Celtic Manor Twenty Ten',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.9, 131),
    pars: P72,
  },
  {
    id: 'gleneagles-kings',
    name: 'Gleneagles Kings',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(71.2, 130),
    pars: P72,
  },
  {
    id: 'royal-birkdale',
    name: 'Royal Birkdale',
    defaultTee: 'Medal',
    byPlatform: uniformByPlatform(73.0, 132),
    pars: P72,
  },
  {
    id: 'royal-lytham-st-annes',
    name: 'Royal Lytham St Annes',
    defaultTee: 'Medal',
    byPlatform: uniformByPlatform(72.8, 130),
    pars: P72,
  },
  {
    id: 'wentworth-west',
    name: 'Wentworth West',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(74.7, 137),
    pars: P72,
  },
  {
    id: 'sunningdale-old',
    name: 'Sunningdale Old',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(71.3, 128),
    pars: P72,
  },
  {
    id: 'valderrama',
    name: 'Valderrama',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.4, 133),
    pars: P72,
  },
  {
    id: 'el-saler',
    name: 'El Saler',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.9, 131),
    pars: P72,
  },
  {
    id: 'hirono',
    name: 'Hirono Golf Club',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.5, 133),
    pars: P72,
  },
  {
    id: 'kasumigaseki-east',
    name: 'Kasumigaseki East',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(72.8, 130),
    pars: P72,
  },
  {
    id: 'kingston-heath',
    name: 'Kingston Heath',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.2, 134),
    pars: P72,
  },
  {
    id: 'royal-melbourne-west',
    name: 'Royal Melbourne West',
    defaultTee: 'White',
    byPlatform: uniformByPlatform(73.6, 136),
    pars: P72,
  },
  {
    id: 'cape-kidnappers',
    name: 'Cape Kidnappers',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 139),
    pars: P72,
  },
  {
    id: 'kauri-cliffs',
    name: 'Kauri Cliffs',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.9, 135),
    pars: P72,
  },
  {
    id: 'streamsong-red',
    name: 'Streamsong Red',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.5, 133),
    pars: P72,
  },
  {
    id: 'streamsong-blue',
    name: 'Streamsong Blue',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.1, 130),
    pars: P72,
  },
  {
    id: 'streamsong-black',
    name: 'Streamsong Black',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 136),
    pars: P72,
  },
  {
    id: 'cabot-links',
    name: 'Cabot Links',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(72.5, 131),
    pars: P72,
  },
  {
    id: 'cabot-cliffs',
    name: 'Cabot Cliffs',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.2, 139),
    pars: P72,
  },
  {
    id: 'wolf-creek',
    name: 'Wolf Creek',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.2, 138),
    pars: P72,
  },
  {
    id: 'gamble-sands',
    name: 'Gamble Sands',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(71.8, 124),
    pars: P72,
  },
  {
    id: 'arcadia-bluffs',
    name: 'Arcadia Bluffs',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.1, 139),
    pars: P72,
  },
  {
    id: 'tobacco-road',
    name: 'Tobacco Road',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(71.5, 135),
    pars: P72,
  },
  {
    id: 'pinehurst-4',
    name: 'Pinehurst No. 4',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.2, 130),
    pars: P72,
  },
  {
    id: 'pinehurst-8',
    name: 'Pinehurst No. 8',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.8, 133),
    pars: P72,
  },
  {
    id: 'colonial-cc',
    name: 'Colonial Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(71.9, 127),
    pars: P72,
  },
  {
    id: 'quail-hollow',
    name: 'Quail Hollow',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.2, 135),
    pars: P72,
  },
  {
    id: 'sedgefield',
    name: 'Sedgefield Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(71.3, 127),
    pars: P72,
  },
  {
    id: 'wilmington-cc',
    name: 'Wilmington Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.5, 130),
    pars: P72,
  },
  {
    id: 'liberty-national',
    name: 'Liberty National',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.2, 131),
    pars: P72,
  },
  {
    id: 'ridgewood-cc',
    name: 'Ridgewood Country Club',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.1, 132),
    pars: P72,
  },
  {
    id: 'caves-valley',
    name: 'Caves Valley',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(74.8, 135),
    pars: P72,
  },
  {
    id: 'workday-bradenton-cc',
    name: 'Workday Championship Bradenton CC',
    defaultTee: 'Blue',
    byPlatform: uniformByPlatform(73.0, 128),
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
  return normSearch(course.name).includes(q);
}
