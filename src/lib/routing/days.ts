import { isCampType, type RouteFeature } from "./features";

/** Same shape as PersonalTrailDay (src/lib/personal-trails.ts). */
export interface RouteDay { day: number; fromMile: number; toMile: number; miles: number; stop: RouteFeature | null }

/**
 * Splits a route into days of about `targetMiles`. Each night stops at the campsite, shelter or hut nearest the
 * day's target mile, within 60–130% of a day's distance; with none in that window the day ends at the target
 * mile with no stop (the hiker must find legal camping). The last day ends at the trailhead.
 */
export function splitDays(totalMiles: number, features: RouteFeature[], targetMiles: number): RouteDay[] {
  if (!Number.isFinite(totalMiles) || totalMiles <= 0 || !Number.isFinite(targetMiles) || targetMiles <= 0) return [];
  const camps = features.filter((f) => isCampType(f.type)).sort((a, b) => a.mile - b.mile);
  const days: RouteDay[] = [];
  let from = 0;
  const round = (n: number) => Math.round(n * 10) / 10;
  while (totalMiles - from > targetMiles * 1.3 && days.length < 120) {
    const goal = from + targetMiles;
    const options = camps.filter((c) => c.mile >= from + targetMiles * 0.6 && c.mile <= from + targetMiles * 1.3 && c.mile < totalMiles - 0.5);
    const stop = options.sort((a, b) => Math.abs(a.mile - goal) - Math.abs(b.mile - goal) || a.offRouteFt - b.offRouteFt)[0] ?? null;
    const to = stop ? stop.mile : goal;
    days.push({ day: days.length + 1, fromMile: round(from), toMile: round(to), miles: round(to - from), stop });
    from = to;
  }
  days.push({ day: days.length + 1, fromMile: round(from), toMile: round(totalMiles), miles: round(totalMiles - from), stop: null });
  return days;
}
