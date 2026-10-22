import { Route } from "@/lib/geo/line";
import type { LngLat } from "@/lib/geo/tiles";

/**
 * The stretch of a mapped route between two points (a guide section's start and end), cut from the real line.
 * Null when either point is more than `maxOffMeters` from the route, so a section is never drawn from a guess.
 */
export function sliceRoute(lines: LngLat[][], start: LngLat, end: LngLat, maxOffMeters = 3000): LngLat[][] | null {
  const route = new Route(lines);
  if (route.points.length < 2) return null;
  const a = route.locate(start), b = route.locate(end);
  if (a.offMeters > maxOffMeters || b.offMeters > maxOffMeters) return null;
  const [from, to] = a.alongMeters <= b.alongMeters ? [a, b] : [b, a];
  const out: LngLat[][] = [];
  let current: LngLat[] = [from.at];
  for (let i = 0; i < route.points.length; i++) {
    const along = route.along[i];
    if (along <= from.alongMeters) continue;
    if (along >= to.alongMeters) break;
    // A new piece starts where the along distance doesn't grow between consecutive points.
    if (i > 0 && route.along[i] === route.along[i - 1] && current.length > 1) { out.push(current); current = []; }
    current.push(route.points[i]);
  }
  current.push(to.at);
  if (current.length > 1) out.push(current);
  return out.length ? out : null;
}
