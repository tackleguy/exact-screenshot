import { MILE_METERS, metersBetween } from "@/lib/geo/line";
import { projectOnSegment, type LngLat } from "./graph";

/** A hike feature from /api/trail-catalog/features (OpenStreetMap, built by the pipeline's feature pass). */
export interface HikeFeature { id: string; type: string; name: string; lat: number; lon: number; source: string; extra?: Record<string, unknown> }

/** Same shape as PersonalTrail.features (src/lib/personal-trails.ts). */
export interface RouteFeature { id: string; type: string; name: string; lat: number; lon: number; mile: number; offRouteFt: number; source: string }

export const WATER_TYPES = ["spring", "drinking_water", "lake", "river", "crossing", "ford"] as const;
export const CAMP_TYPES = ["campsite", "camp_pitch", "shelter", "hut"] as const;
export const OTHER_TYPES = ["trailhead", "parking", "toilets", "viewpoint", "peak", "pass", "bridge", "picnic_site", "ranger_station", "waterfall"] as const;
export type FeatureGroup = "water" | "camping" | "other";

export const FEATURE_LABELS: Record<string, string> = {
  spring: "Spring", drinking_water: "Drinking water", lake: "Lake", river: "River", crossing: "Stream crossing", ford: "Ford",
  campsite: "Campsite", camp_pitch: "Camp pitch", shelter: "Shelter", hut: "Hut", trailhead: "Trailhead", parking: "Parking",
  toilets: "Toilets", viewpoint: "Viewpoint", peak: "Peak", pass: "Pass", bridge: "Bridge", picnic_site: "Picnic site",
  ranger_station: "Ranger station", waterfall: "Waterfall",
};
export const GROUP_COLORS: Record<FeatureGroup, string> = { water: "#0284c7", camping: "#d97706", other: "#475569" };

export function featureGroup(type: string): FeatureGroup {
  if ((WATER_TYPES as readonly string[]).includes(type)) return "water";
  if ((CAMP_TYPES as readonly string[]).includes(type)) return "camping";
  return "other";
}
export const isCampType = (type: string) => (CAMP_TYPES as readonly string[]).includes(type);

/** How far off the route a feature may be to be listed: water within 200 m, everything else within 300 m. */
export const nearLimitMeters = (type: string) => (featureGroup(type) === "water" ? 200 : 300);

export function featureName(f: { type: string; name: string }) {
  return f.name?.trim() || FEATURE_LABELS[f.type] || "Feature";
}

/** Features along a route line, each at its mile (nearest point on the route) with its distance off-route. */
export function featuresAlong(route: LngLat[], features: HikeFeature[]): RouteFeature[] {
  if (route.length < 2) return [];
  const along = [0];
  for (let i = 1; i < route.length; i++) along.push(along[i - 1] + metersBetween(route[i - 1], route[i]));
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of route) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const pad = 0.005;
  const out: RouteFeature[] = [];
  for (const f of features) {
    if (f.lon < w - pad || f.lon > e + pad || f.lat < s - pad || f.lat > n + pad) continue;
    const limit = nearLimitMeters(f.type);
    const p: LngLat = [f.lon, f.lat];
    let best: { meters: number; along: number } | null = null;
    for (let i = 0; i + 1 < route.length; i++) {
      const a = route[i], b = route[i + 1];
      // Cheap reject: both ends far away in latitude.
      if (Math.min(a[1], b[1]) - f.lat > 0.004 || f.lat - Math.max(a[1], b[1]) > 0.004) continue;
      const hit = projectOnSegment(p, a, b);
      if (hit.meters <= limit && (!best || hit.meters < best.meters)) best = { meters: hit.meters, along: along[i] + (along[i + 1] - along[i]) * hit.t };
    }
    if (best) out.push({ id: f.id, type: f.type, name: featureName(f), lat: f.lat, lon: f.lon, mile: Math.round((best.along / MILE_METERS) * 100) / 100, offRouteFt: Math.round(best.meters * 3.28084), source: f.source || "OpenStreetMap" });
  }
  return out.sort((a, b) => a.mile - b.mile);
}

/** Loads hike features in a box; an empty list when the layer isn't available. */
export async function fetchFeatures(bbox: [number, number, number, number], types?: readonly string[], signal?: AbortSignal): Promise<HikeFeature[]> {
  const params = new URLSearchParams({ bbox: bbox.map((v) => v.toFixed(4)).join(",") });
  if (types?.length) params.set("types", types.join(","));
  try {
    const res = await fetch(`/api/trail-catalog/features?${params}`, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: HikeFeature[] };
    return Array.isArray(data.features) ? data.features.filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon) && typeof f.type === "string") : [];
  } catch {
    return [];
  }
}
