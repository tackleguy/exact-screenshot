/**
 * "Go anywhere" routes: from a start to an end through up to three stops, at any distance. Each leg (between
 * two consecutive points) is travelled the way that works for its length:
 *
 *   - On foot: mapped trails when both ends are near them (the trail router, src/lib/routing/route.ts), otherwise
 *     a walking route over OpenStreetMap paths and roads (OSRM foot profile).
 *   - Driving: a road route (OSRM car) for legs too long to walk in "fastest" travel.
 *   - Flying: between the airports with scheduled flights nearest each end (OurAirports), drawn as a great-circle
 *     arc, with ground routes to and from the airports. Used for long legs, and for any leg no road or path
 *     connects (an ocean in between).
 *
 * Where nothing at all is mapped (no road to a remote airport), the part is a marked "gap": a dashed straight line
 * that is labelled as such, never presented as a path on the ground.
 */
import { metersBetween } from "@/lib/geo/line";
import type { LngLat } from "./graph";
import { graphFor, roadConnector } from "./index";
import { routeThrough } from "./route";

export type TravelMode = "trail" | "walk" | "drive" | "flight" | "gap";
/** "fastest": walk short legs, drive middle ones, fly long ones. "walk": on foot wherever a way exists. */
export type TravelPreference = "fastest" | "walk";

export interface JourneyPart {
  mode: TravelMode;
  coordinates: LngLat[];
  meters: number;
  seconds: number;
  /** "Mist Trail", "Walk", "Drive", "Flight SFO → NRT", "No mapped route". */
  label: string;
}
export interface Journey {
  parts: JourneyPart[];
  meters: number;
  seconds: number;
  /** Meters travelled at the end of each leg (between consecutive points). */
  legEndsMeters: number[];
  byMode: Partial<Record<TravelMode, number>>;
  coordinates: LngLat[];
}

/** Start, up to three stops, end. */
export const MAX_POINTS = 5;

const WALK_MPS = 1.34; // 3 mph
const FLIGHT_KMH = 800;
const FLIGHT_OVERHEAD_S = 2.5 * 3600; // check-in, security, boarding, taxi
/** Straight-line leg lengths that decide how a leg is travelled. */
const TRAIL_MAX_M = 30_000;
const FASTEST_WALK_MAX_M = 4_000;
const FASTEST_DRIVE_MAX_M = 900_000;
const WALK_ROUTE_MAX_M = 600_000;
/** How close the ends must be to a mapped trail for the trail router to be used. */
const NEAR_TRAIL_M = 200;

export class JourneyError extends Error {}

type Ground = (from: LngLat, to: LngLat, signal?: AbortSignal) => Promise<JourneyPart | null>;

/** Calls a /api/directions-style router; null when it finds no route or is unavailable. */
async function routed(profile: "foot" | "car", from: LngLat, to: LngLat, signal?: AbortSignal): Promise<JourneyPart | null> {
  const q = new URLSearchParams({ from: `${from[1].toFixed(6)},${from[0].toFixed(6)}`, to: `${to[1].toFixed(6)},${to[0].toFixed(6)}`, ...(profile === "foot" ? { profile: "foot" } : {}) });
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`/api/directions?${q}`, { signal }).catch((e: unknown) => { if ((e as Error)?.name === "AbortError") throw e; return null; });
    if (res?.status === 429 && attempt === 0) { await new Promise((r) => setTimeout(r, 1100)); continue; }
    if (!res?.ok) return null;
    const d = (await res.json().catch(() => null)) as { line?: LngLat[]; distanceMeters?: number; durationSeconds?: number } | null;
    if (!d?.line?.length || !Number.isFinite(d.distanceMeters)) return null;
    const walk = profile === "foot";
    return { mode: walk ? "walk" : "drive", coordinates: d.line, meters: d.distanceMeters!, seconds: walk ? d.distanceMeters! / WALK_MPS : d.durationSeconds ?? d.distanceMeters! / 20, label: walk ? "Walk" : "Drive" };
  }
  return null;
}

export const walkRoute: Ground = (a, b, signal) => routed("foot", a, b, signal);
export const driveRoute: Ground = (a, b, signal) => routed("car", a, b, signal);

/** Mapped trails between two points near trails (with road connectors between networks); null otherwise. */
export const trailRoute: Ground = async (a, b, signal) => {
  try {
    const graph = await graphFor([a, b], signal);
    if (!graph.nodes.length) return null;
    const r = await routeThrough(graph, [a, b], { connect: roadConnector(signal), maxSnap: NEAR_TRAIL_M });
    if (r.snapped.some((s) => s.offTrailMeters > NEAR_TRAIL_M)) return null;
    const names = [...new Set(r.trails.filter((t) => !t.connector).map((t) => t.name))];
    return { mode: "trail", coordinates: r.coordinates, meters: r.meters, seconds: r.meters / WALK_MPS, label: names.length ? names.slice(0, 3).join(" → ") + (names.length > 3 ? " …" : "") : "Trail" };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    return null;
  }
};

/** A labelled straight-line stretch where nothing is mapped. */
function gap(a: LngLat, b: LngLat): JourneyPart {
  const meters = metersBetween(a, b);
  return { mode: "gap", coordinates: [a, b], meters, seconds: meters / WALK_MPS, label: "No mapped route — check local transport" };
}

// ---- airports ----

export type Airport = [iata: string, name: string, city: string, country: string, lat: number, lng: number, size: "L" | "M"];
let airportList: Promise<Airport[]> | null = null;
function airports(): Promise<Airport[]> {
  airportList ??= fetch("/airports.json").then((r) => (r.ok ? r.json() : { airports: [] })).then((d: { airports: Airport[] }) => d.airports).catch(() => { airportList = null; return []; });
  return airportList;
}

/** The airport to fly from near a point: the nearest large one within 150 km, else the nearest of any size. */
export function nearestAirport(list: Airport[], p: LngLat): Airport | null {
  let large: [Airport, number] | null = null, any: [Airport, number] | null = null;
  for (const a of list) {
    const d = metersBetween(p, [a[5], a[4]]);
    if (!any || d < any[1]) any = [a, d];
    if (a[6] === "L" && (!large || d < large[1])) large = [a, d];
  }
  return large && large[1] <= 150_000 ? large[0] : any?.[0] ?? null;
}

/** Points along the great circle from a to b; longitudes stay continuous across the antimeridian. */
export function greatCircle(a: LngLat, b: LngLat, steps = 64): LngLat[] {
  const rad = Math.PI / 180;
  const [l1, p1, l2, p2] = [a[0] * rad, a[1] * rad, b[0] * rad, b[1] * rad];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d === 0) return [a, b];
  const out: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    let lng = Math.atan2(y, x) / rad;
    const prev = out[out.length - 1];
    if (prev) while (lng - prev[0] > 180) lng -= 360;
    if (prev) while (prev[0] - lng > 180) lng += 360;
    out.push([lng, Math.atan2(z, Math.hypot(x, y)) / rad]);
  }
  return out;
}

// ---- legs ----

interface Routers { trail: Ground; walk: Ground; drive: Ground; airports: () => Promise<Airport[]> }
const DEFAULT_ROUTERS: Routers = { trail: trailRoute, walk: walkRoute, drive: driveRoute, airports };

/** On the ground between two points, without flying: trails, then walking, then (fastest) driving. */
async function groundLeg(a: LngLat, b: LngLat, pref: TravelPreference, r: Routers, signal?: AbortSignal): Promise<JourneyPart | null> {
  const d = metersBetween(a, b);
  if (d < 25) return null;
  const tryAll = async (list: (Ground | false)[]) => { for (const g of list) { if (!g) continue; const part = await g(a, b, signal); if (part) return part; } return null; };
  if (pref === "walk") return tryAll([d <= TRAIL_MAX_M && r.trail, d <= WALK_ROUTE_MAX_M && r.walk]);
  if (d <= FASTEST_WALK_MAX_M) return tryAll([r.trail, r.walk, r.drive]);
  return tryAll([r.drive, d <= TRAIL_MAX_M && r.walk]);
}

/** Ground parts to or from an airport; a gap when no road or path reaches it. */
async function access(a: LngLat, b: LngLat, pref: TravelPreference, r: Routers, signal?: AbortSignal): Promise<JourneyPart[]> {
  if (metersBetween(a, b) < 50) return [];
  const part = await groundLeg(a, b, pref === "walk" && metersBetween(a, b) > 40_000 ? "fastest" : pref, r, signal);
  return [part ?? gap(a, b)];
}

/** One leg: on the ground when that suits its length and a way exists, otherwise by air. */
export async function journeyLeg(a: LngLat, b: LngLat, pref: TravelPreference, r: Routers = DEFAULT_ROUTERS, signal?: AbortSignal): Promise<JourneyPart[]> {
  const d = metersBetween(a, b);
  if (d < 25) return [];
  const groundFirst = pref === "walk" ? d <= WALK_ROUTE_MAX_M : d <= FASTEST_DRIVE_MAX_M;
  if (groundFirst) {
    const part = await groundLeg(a, b, pref, r, signal);
    if (part) return [part];
  }
  // By air: nearest airports with scheduled service, unless both ends share one.
  const list = await r.airports();
  const from = nearestAirport(list, a), to = nearestAirport(list, b);
  if (from && to && from[0] !== to[0]) {
    const fa: LngLat = [from[5], from[4]], ta: LngLat = [to[5], to[4]];
    const flightM = metersBetween(fa, ta);
    const flight: JourneyPart = { mode: "flight", coordinates: greatCircle(fa, ta), meters: flightM, seconds: FLIGHT_OVERHEAD_S + (flightM / 1000 / FLIGHT_KMH) * 3600, label: `Flight ${from[0]} → ${to[0]} (${from[2] || from[1]} to ${to[2] || to[1]})` };
    const [before, after] = await Promise.all([access(a, fa, pref, r, signal), access(ta, b, pref, r, signal)]);
    return [...before, flight, ...after];
  }
  // No flight makes sense (one airport serves both ends): the longest ground route there is, else a marked gap.
  const fallback = await groundLeg(a, b, "fastest", r, signal);
  return [fallback ?? gap(a, b)];
}

/** The whole journey through 2–5 points, leg by leg. */
export async function buildJourney(points: LngLat[], pref: TravelPreference = "fastest", options: { signal?: AbortSignal; routers?: Routers } = {}): Promise<Journey> {
  if (points.length < 2) throw new JourneyError("Choose a start and an end.");
  if (points.length > MAX_POINTS) throw new JourneyError(`A route can have up to ${MAX_POINTS} points (start, ${MAX_POINTS - 2} stops and end).`);
  const r = options.routers ?? DEFAULT_ROUTERS;
  const legs = await Promise.all(points.slice(1).map((b, i) => journeyLeg(points[i], b, pref, r, options.signal)));
  const parts: JourneyPart[] = [];
  const legEndsMeters: number[] = [];
  let meters = 0;
  for (const leg of legs) {
    for (const p of leg) { parts.push(p); meters += p.meters; }
    legEndsMeters.push(meters);
  }
  if (!parts.length) throw new JourneyError("The points are at the same place. Move one of them.");
  const byMode: Partial<Record<TravelMode, number>> = {};
  for (const p of parts) byMode[p.mode] = (byMode[p.mode] ?? 0) + p.meters;
  return { parts, meters, seconds: parts.reduce((t, p) => t + p.seconds, 0), legEndsMeters, byMode, coordinates: parts.flatMap((p) => p.coordinates) };
}
