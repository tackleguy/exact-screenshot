import { MILE_METERS, formatDistance, measureLines, metersBetween, routeTypeOf, type Lines, type Point } from "./quality";

/** A mapped place to start from: an OpenStreetMap trailhead or parking area, or a trail end. */
export interface AccessPoint {
  kind: "trailhead" | "parking" | "trail-end";
  name: string | null;
  latitude: number;
  longitude: number;
  /** Straight-line distance from this point to the trail's nearest end, in meters. */
  toTrailMeters: number;
  osmUrl?: string;
  /** Official agency record for the trailhead (USFS). */
  officialUrl?: string;
  source?: "osm" | "usfs";
  /** Agency note on water at the trailhead, e.g. "No water is available". */
  water?: string;
  closestTowns?: string;
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

export function bearingDegrees(a: Point, b: Point) {
  const rad = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * rad) * Math.cos(b[1] * rad);
  const x = Math.cos(a[1] * rad) * Math.sin(b[1] * rad) - Math.sin(a[1] * rad) * Math.cos(b[1] * rad) * Math.cos((b[0] - a[0]) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}
export const compass = (degrees: number) => COMPASS[Math.round(degrees / 45) % 8];

/** The two ends of the longest mapped line, which is where a hike on it starts and finishes. */
export function trailEnds(lines: Lines): [Point, Point] | null {
  let longest: Point[] | null = null, best = -1;
  for (const line of lines) {
    if (line.length < 2) continue;
    const m = measureLines([line]).meters;
    if (m > best) { best = m; longest = line; }
  }
  return longest ? [longest[0], longest[longest.length - 1]] : null;
}

/** Picks the start: the nearest mapped trailhead, then parking, then the trail end itself. */
export function chooseStart(ends: [Point, Point], candidates: AccessPoint[]): AccessPoint {
  const ranked = [...candidates].sort((a, b) =>
    (a.kind === "trailhead" ? 0 : 1) - (b.kind === "trailhead" ? 0 : 1) || a.toTrailMeters - b.toTrailMeters);
  return ranked[0] ?? { kind: "trail-end", name: null, latitude: ends[0][1], longitude: ends[0][0], toTrailMeters: 0 };
}

/** Distance from an access point to the nearer trail end. */
export function distanceToEnds(point: Point, ends: [Point, Point]) {
  return Math.min(metersBetween(point, ends[0]), metersBetween(point, ends[1]));
}

/**
 * Plain-language steps for walking the mapped line from `start`. Generated only from geometry and the
 * route type; it does not know junction names, signage or current conditions.
 */
export function onTrailInstructions(name: string, miles: number | null, lines: Lines, start: AccessPoint): string[] {
  const ends = trailEnds(lines);
  if (!ends) return [];
  const startPoint: Point = [start.longitude, start.latitude];
  const [from, to] = metersBetween(startPoint, ends[0]) <= metersBetween(startPoint, ends[1]) ? ends : [ends[1], ends[0]];
  const measure = measureLines(lines);
  const type = routeTypeOf(measure);
  const length = formatDistance(miles ?? measure.meters / MILE_METERS).primary;
  const steps: string[] = [];
  const place = start.kind === "trail-end" ? "the mapped trail end" : start.name ? `${start.name}` : start.kind === "trailhead" ? "the mapped trailhead" : "the mapped parking area";
  steps.push(`Start at ${place}.`);
  if (start.kind !== "trail-end" && start.toTrailMeters > 40) {
    steps.push(`Walk about ${formatDistance(start.toTrailMeters / MILE_METERS).primary} ${compass(bearingDegrees(startPoint, from))} to reach ${name}.`);
  }
  if (type === "loop") {
    steps.push(`Follow ${name} around the loop for ${length}; it returns to where you started.`);
  } else if (type === "network") {
    steps.push(`${name} is mapped as ${measure.pieces} connected pieces (${length} in total). Pick a route at the junctions; the map shows every piece.`);
  } else {
    steps.push(`Follow ${name} ${compass(bearingDegrees(from, to))} for ${length} to its far end.`);
    const back = formatDistance(2 * (miles ?? measure.meters / MILE_METERS)).primary;
    steps.push(`Turn around and return the same way (${back} round trip), or arrange a pickup at the far end.`);
  }
  return steps;
}

/** Google Maps directions to a point. Uses the documented URL API; no key is needed. */
export function googleMapsDirectionsUrl(latitude: number, longitude: number, travelmode: "driving" | "walking" | "transit" | "bicycling" = "driving") {
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: `${latitude},${longitude}`, travelmode })}`;
}
export function appleMapsDirectionsUrl(latitude: number, longitude: number, label?: string) {
  return `https://maps.apple.com/?${new URLSearchParams({ daddr: `${latitude},${longitude}`, dirflg: "d", ...(label ? { q: label } : {}) })}`;
}

/** One OSRM route step (https://project-osrm.org/docs/v5.24.0/api/#routestep-object). */
export interface RouteStep {
  name: string;
  ref?: string;
  distance: number;
  duration: number;
  maneuver: { type: string; modifier?: string; exit?: number };
  destinations?: string;
}

/** Turns an OSRM step into a readable instruction ("Turn left onto Main Street"). */
export function stepInstruction(step: RouteStep) {
  const road = step.name || step.ref || "";
  const onto = road ? ` onto ${road}` : "";
  const { type, modifier, exit } = step.maneuver;
  const turn = modifier === "uturn" ? "Make a U-turn" : modifier === "straight" ? "Continue straight" : modifier ? `Turn ${modifier}` : "Turn";
  switch (type) {
    case "depart": return road ? `Start on ${road}` : "Start driving";
    case "arrive": return `Arrive at the start${modifier === "left" || modifier === "right" ? `, on the ${modifier}` : ""}`;
    case "merge": return `Merge${modifier ? ` ${modifier.replace("slight ", "")}` : ""}${onto}`;
    case "on ramp": return `Take the ramp${modifier && /left|right/.test(modifier) ? ` on the ${modifier.replace(/sharp |slight /, "")}` : ""}${onto}`;
    case "off ramp": return `Take the exit${step.destinations ? ` toward ${step.destinations}` : ""}${onto}`;
    case "fork": return `Keep ${modifier?.includes("left") ? "left" : modifier?.includes("right") ? "right" : "straight"} at the fork${onto}`;
    case "roundabout":
    case "rotary": return `At the roundabout, take the ${exit ? `${ordinal(exit)} exit` : "exit"}${onto}`;
    case "end of road": return `At the end of the road, ${turn.toLowerCase()}${onto}`;
    case "continue":
    case "new name": return `Continue${road ? ` on ${road}` : ""}`;
    default: return `${turn}${onto}`;
  }
}
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

export interface CachedTrailhead { osm: string; name: string | null; latitude: number; longitude: number; source?: "osm" | "usfs"; url?: string; water?: string | null; closestTowns?: string | null }
export interface TrailheadCache { retrievedAt: string; dataTimestamp: string | null; trailheads: CachedTrailhead[] }

/** A trailhead within this distance of a trail end is that trail's start. */
export const TRAILHEAD_METERS = 800;

/** Grid lookup of mapped trailheads near a trail's ends. */
export class TrailheadIndex {
  private cells = new Map<string, CachedTrailhead[]>();
  private static cell = 0.01;
  constructor(trailheads: CachedTrailhead[]) {
    for (const t of trailheads) {
      const k = TrailheadIndex.key(t.longitude, t.latitude);
      const list = this.cells.get(k);
      if (list) list.push(t); else this.cells.set(k, [t]);
    }
  }
  private static key(lng: number, lat: number) { return `${Math.floor(lng / TrailheadIndex.cell)}:${Math.floor(lat / TrailheadIndex.cell)}`; }

  /** Nearest trailhead within TRAILHEAD_METERS of either end, preferring named ones when distances are close. */
  nearest(ends: [Point, Point]): AccessPoint | null {
    let best: AccessPoint | null = null, score = Infinity;
    for (const end of ends) {
      const reach = Math.ceil(TRAILHEAD_METERS / 111_000 / Math.max(0.2, Math.cos(end[1] * Math.PI / 180)) / TrailheadIndex.cell);
      const cx = Math.floor(end[0] / TrailheadIndex.cell), cy = Math.floor(end[1] / TrailheadIndex.cell);
      for (let x = cx - reach; x <= cx + reach; x++) for (let y = cy - 1; y <= cy + 1; y++) {
        for (const t of this.cells.get(`${x}:${y}`) ?? []) {
          const meters = metersBetween(end, [t.longitude, t.latitude]);
          if (meters > TRAILHEAD_METERS) continue;
          // Official (USFS) trailheads and named ones win over unnamed map points at similar distances.
          const s = meters + (t.name ? 0 : 150) - (t.source === "usfs" ? 200 : 0);
          if (s < score) {
            score = s;
            best = {
              kind: "trailhead", name: t.name, latitude: t.latitude, longitude: t.longitude, toTrailMeters: Math.round(meters),
              ...(t.source === "usfs" ? { source: "usfs" as const, ...(t.url ? { officialUrl: t.url } : {}), ...(t.water ? { water: t.water } : {}), ...(t.closestTowns ? { closestTowns: t.closestTowns } : {}) } : { source: "osm" as const, osmUrl: `https://www.openstreetmap.org/${t.osm}` }),
            };
          }
        }
      }
    }
    return best;
  }
}

/** Readable steps with consecutive identical instructions ("Continue on US 66") combined. */
export function routeSteps(steps: RouteStep[]) {
  const out: { instruction: string; distanceMeters: number }[] = [];
  for (const step of steps) {
    const instruction = stepInstruction(step);
    const last = out[out.length - 1];
    if (last && last.instruction === instruction) last.distanceMeters += step.distance;
    else out.push({ instruction, distanceMeters: step.distance });
  }
  return out;
}
