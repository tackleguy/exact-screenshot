import type { LngLat } from "@/lib/geo/tiles";
import { Route, MILE_METERS, round } from "@/lib/geo/line";
import type { TownDayOptions } from "./town-days";

/** Pure trip-planning helpers shared by the API routes and the in-browser trail service. */
type TrailLines = { trail: { miles: number | null; name: string }; lines: LngLat[][] };

export const num = (v: unknown, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

/** Town-day options from query params or a JSON body. `days` is required to make a plan. */
export function townDayOptions(input: Record<string, unknown>): Omit<TownDayOptions, "trailMiles"> | null {
  const days = num(input.days, 1, 365);
  if (days === undefined) return null;
  const startDate = typeof input.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.startDate) ? input.startDate : null;
  return {
    days,
    foodLbPerDay: num(input.foodLbPerDay, 0.5, 4),
    maxCarryDays: num(input.maxCarryDays, 1, 14),
    maxMilesOffTrail: num(input.maxMilesOffTrail, 1, 40),
    zeroDays: input.zeroDays === true || input.zeroDays === "true",
    startDate,
    consumables: Array.isArray(input.consumables) ? input.consumables.filter((c): c is string => typeof c === "string").slice(0, 20) : undefined,
  };
}

/**
 * Share of the stated length that is mapped. Town positions are measured along the mapped line, so a
 * route that is mostly unmapped (e.g. a through-hike with few mapped sections) can't be planned.
 */
export function mappedShare(t: TrailLines) {
  if (!t.lines.length || !t.trail.miles) return t.lines.length ? 1 : 0;
  return new Route(t.lines).meters / MILE_METERS / t.trail.miles;
}
export const MIN_MAPPED_SHARE = 0.6;
export const unplannable = (t: TrailLines) =>
  `Only ${Math.round(mappedShare(t) * 100)}% of ${t.trail.name} is mapped, so town stops can't be placed along it. Plan resupply from the official trail guide.`;

/** Miles used for planning: the mapped line (which town positions are measured on), else the stated length. */
export const planningMiles = (t: TrailLines) => (t.lines.length ? round(new Route(t.lines).meters / MILE_METERS, 1) : t.trail.miles ?? 0);

