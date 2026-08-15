/**
 * Optional total yardage per course tee for GS Pro scorecard tee matching.
 * Prefer `CourseTee.yards` on COURSE_SEEDS when present; this map is a legacy fallback.
 */

import { getCourseById } from './courses';

export const COURSE_TEE_YARDAGES: Partial<Record<string, Partial<Record<string, number>>>> = {
  pebble: { Red: 5500, White: 6048, Blue: 6528, Black: 6828 },
  augusta: { Red: 5460, White: 6245, Green: 6510, Tournament: 6745, Black: 7045 },
  sawgrass: { Red: 5800, White: 6350, Blue: 6617, Black: 6957 },
  bethpage: { Red: 5800, White: 6300, Blue: 6550, Black: 7125 },
  st_andrews: { Red: 5900, White: 6300, Blue: 6600, Black: 6900 },
  pinehurst2: { Red: 5400, White: 6100, Blue: 6400, Black: 6800 },
  torrey: { Red: 5800, White: 6300, Blue: 6550, Black: 6900 },
  bandon_dunes: { Red: 5500, White: 6000, Blue: 6300, Black: 6700 },
};

export function yardageForCourseTee(courseId: string, teeName: string): number | undefined {
  const fromSeed = getCourseById(courseId)?.tees?.find((t) => t.name === teeName)?.yards;
  if (typeof fromSeed === 'number' && Number.isFinite(fromSeed) && fromSeed > 0) {
    return fromSeed;
  }
  return COURSE_TEE_YARDAGES[courseId]?.[teeName];
}
