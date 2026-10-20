import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { tileFeaturesOrNull, tileOf, type LngLat } from "@/lib/geo/tiles";
import { MILE_METERS, Route, metersBetween, round } from "@/lib/geo/line";
import type { ServiceKey, TownServices } from "./services";

export interface Town {
  id: number;
  name: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
  population: number;
}
export interface TownNearTrail extends Town {
  /** Mile along the trail closest to the town. */
  trailMile: number;
  /** Straight-line miles from the trail to the town centre. */
  milesOffTrail: number;
}

export { SERVICE_LABELS } from "./services";
export type { ServiceKey, TownServices } from "./services";

let townsPromise: Promise<Town[]> | null = null;
export function loadTowns() {
  townsPromise ??= readFile(path.join(process.cwd(), "data/towns/towns.json.gz"))
    .then((raw) => {
      const data = JSON.parse(gunzipSync(raw).toString()) as { towns: [number, string, string, string, number, number, number][] };
      return data.towns.map(([id, name, state, country, latitude, longitude, population]) => ({ id, name, state, country, latitude, longitude, population }));
    })
    .catch((error) => { townsPromise = null; throw error; });
  return townsPromise;
}

/**
 * Towns within `maxMilesOff` of the trail, closest first with bigger towns breaking near-ties.
 * Distance is straight-line from the trail to the town centre; road distance is longer.
 */
export function townsNear(towns: Town[], trailLines: LngLat[][], maxMilesOff = 20, limit = 8): TownNearTrail[] {
  const route = new Route(trailLines);
  if (!route.points.length) return [];
  let west = 180, south = 90, east = -180, north = -90;
  for (const [x, y] of route.points) { west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y); }
  const padLat = (maxMilesOff * MILE_METERS) / 110_540;
  const padLng = padLat / Math.max(0.2, Math.cos(((south + north) / 2) * Math.PI / 180));
  const candidates = towns.filter((t) => t.latitude >= south - padLat && t.latitude <= north + padLat && t.longitude >= west - padLng && t.longitude <= east + padLng);
  const near = candidates
    .map((t) => {
      const l = route.locate([t.longitude, t.latitude]);
      return { ...t, trailMile: round(l.alongMeters / MILE_METERS, 1), milesOffTrail: round(l.offMeters / MILE_METERS, 1) };
    })
    .filter((t) => t.milesOffTrail <= maxMilesOff);
  // Score: distance off trail, with a bonus for larger towns (more likely to have a full grocery).
  const score = (t: TownNearTrail) => t.milesOffTrail - Math.min(4, Math.log10(Math.max(1, t.population)) - 2.5);
  near.sort((a, b) => score(a) - score(b));
  // Spread picks along long trails: keep the best town per 15-mile stretch first, then fill.
  const picked: TownNearTrail[] = [];
  const stretch = new Set<number>();
  for (const t of near) { const k = Math.floor(t.trailMile / 15); if (!stretch.has(k)) { stretch.add(k); picked.push(t); } }
  for (const t of near) if (picked.length < limit && !picked.includes(t)) picked.push(t);
  return picked.slice(0, limit).sort((a, b) => a.trailMile - b.trailMile || a.milesOffTrail - b.milesOffTrail);
}

function serviceOf(p: Record<string, unknown>): ServiceKey | null {
  const cls = String(p.class ?? ""), sub = String(p.subclass ?? "");
  if (cls === "grocery" || ["supermarket", "convenience", "grocery", "greengrocer", "deli", "general"].includes(sub)) return "grocery";
  if (["outdoor", "sports", "hunting", "fishing", "bicycle"].includes(sub)) return "outfitter";
  if (cls === "post" || sub === "post_office") return "post";
  if (cls === "campsite" || ["camp_site", "caravan_site"].includes(sub)) return "campground";
  if (cls === "lodging" || ["hotel", "motel", "hostel", "guest_house", "chalet", "alpine_hut"].includes(sub)) return "lodging";
  if (cls === "laundry" || ["laundry", "dry_cleaning"].includes(sub)) return "laundry";
  if (cls === "fuel" || sub === "fuel") return "fuel";
  if (["restaurant", "fast_food", "cafe", "bar", "beer"].includes(cls) || ["restaurant", "fast_food", "cafe", "pub", "food_court"].includes(sub)) return "food";
  if (["pharmacy", "chemist"].includes(sub) || cls === "pharmacy") return "pharmacy";
  if (cls === "hospital" || ["clinic", "doctors", "hospital"].includes(sub)) return "medical";
  if (["atm", "bank"].includes(cls) || ["atm", "bank"].includes(sub)) return "money";
  if (cls === "library") return "library";
  return null;
}

const servicesCache = new Map<number, Promise<TownServices>>();
/** What a town offers, from mapped points of interest around its centre. */
export function townServices(town: Town): Promise<TownServices> {
  const cached = servicesCache.get(town.id);
  if (cached) return cached;
  const task = (async () => {
    const radiusKm = town.population > 20_000 ? 6 : town.population > 3_000 ? 4 : 3;
    const z = 14;
    const [cx, cy] = tileOf([town.longitude, town.latitude], z);
    const ring = radiusKm > 4 ? 2 : 1;
    const tiles: [number, number][] = [];
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) tiles.push([cx + dx, cy + dy]);
    const results = await Promise.all(tiles.map(([x, y]) => tileFeaturesOrNull("openmaptiles", z, x, y, ["poi"])));
    // A town with unreadable map data would look like it has no shops: fail so it isn't cached.
    if (results.some((r) => r === null)) throw new Error("Town map data unavailable");
    const features = results.flatMap((r) => r ?? []);
    const counts: TownServices["counts"] = {}, places: TownServices["places"] = {};
    const seen = new Set<string>();
    for (const f of features) {
      if (f.geometry.type !== "Point") continue;
      const p = f.geometry.coordinates as LngLat;
      if (metersBetween(p, [town.longitude, town.latitude]) > radiusKm * 1000) continue;
      const service = serviceOf(f.properties);
      if (!service) continue;
      const name = typeof f.properties.name === "string" ? f.properties.name : null;
      const key = `${service}:${name ?? ""}:${p[0].toFixed(4)},${p[1].toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[service] = (counts[service] ?? 0) + 1;
      if (name && (places[service]?.length ?? 0) < 3) (places[service] ??= []).push({ name, latitude: round(p[1], 5), longitude: round(p[0], 5) });
    }
    return { counts, places, radiusKm };
  })();
  task.catch(() => servicesCache.delete(town.id));
  servicesCache.set(town.id, task);
  if (servicesCache.size > 2000) servicesCache.delete(servicesCache.keys().next().value!);
  return task;
}

export const TOWNS_ATTRIBUTION = "Towns from GeoNames (CC BY 4.0). Services © OpenStreetMap contributors, via OpenStreetMap US tiles. Check hours and availability before relying on any business.";
