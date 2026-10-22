import { elevationProfile, type ElevationProfile } from "@/lib/trip/elevation";
import { naismithHours } from "@/lib/trail-difficulty";
import { buildGraph, type LngLat, type NetworkTrail, type TrailGraph } from "./graph";
import { featuresAlong, fetchFeatures, type RouteFeature } from "./features";
import { routeThrough, RouteError, type TrailRoute } from "./route";

export { RouteError } from "./route";
export type { LngLat } from "./graph";

export interface BuiltRoute extends TrailRoute {
  features: RouteFeature[];
  elevation: ElevationProfile | null;
  /** Naismith's rule; null over 50 mi or without a measured climb. */
  hours: number | null;
}

type Box = [number, number, number, number];
let cached: { box: Box; connectors: boolean; graph: Promise<TrailGraph> } | null = null;

/** The box the network is loaded for: the points' extent padded by 30% (at least ~10 km), at most 3° a side. */
export function networkBox(points: LngLat[]): Box {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  let w = Math.min(...xs), e = Math.max(...xs), s = Math.min(...ys), n = Math.max(...ys);
  const px = Math.max(0.1, (e - w) * 0.3), py = Math.max(0.08, (n - s) * 0.3);
  w -= px; e += px; s -= py; n += py;
  if (e - w > 3 || n - s > 3) throw new RouteError("These points are too far apart to route in one go. Add a closer end point, or build the route in parts.");
  return [w, s, e, n];
}

const within = (inner: Box, outer: Box) => inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];

async function loadNetwork(box: Box, signal?: AbortSignal): Promise<NetworkTrail[]> {
  const res = await fetch(`/api/trail-catalog/network?bbox=${box.map((v) => v.toFixed(4)).join(",")}`, { signal });
  const data = (await res.json().catch(() => null)) as (GeoJSON.FeatureCollection & { error?: string }) | null;
  if (!res.ok || !data) throw new RouteError(data?.error ?? "Trails for this area couldn’t load. Try again.");
  return data.features.flatMap((f) => {
    const p = f.properties ?? {};
    const lines = f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as LngLat[][]) : f.geometry.type === "LineString" ? [f.geometry.coordinates as LngLat[]] : [];
    return lines.length ? [{ id: String(p.id ?? f.id), name: String(p.name ?? "Trail"), quality: Number(p.q) || 0, tier: p.tier ?? null, lines }] : [];
  });
}

export function graphFor(points: LngLat[], connectors: boolean, signal?: AbortSignal): Promise<TrailGraph> {
  const need = networkBox(points);
  if (cached && cached.connectors === connectors && within(need, cached.box)) return cached.graph;
  // Load a little more than needed so small edits (moving a waypoint) reuse the same network.
  const box: Box = [need[0] - 0.05, need[1] - 0.05, need[2] + 0.05, need[3] + 0.05];
  const graph = loadNetwork(box, signal).then((trails) => buildGraph(trails, { connectors }));
  cached = { box, connectors, graph };
  graph.catch(() => { if (cached?.graph === graph) cached = null; });
  return graph;
}

/** Route along trails through the points, then the features along it and its elevation profile. */
export async function buildRoute(points: LngLat[], options: { connectors?: boolean; signal?: AbortSignal } = {}): Promise<BuiltRoute> {
  const graph = await graphFor(points, Boolean(options.connectors), options.signal);
  if (!graph.nodes.length) throw new RouteError("No mapped trails in this area yet.");
  const route = routeThrough(graph, points);
  const xs = route.coordinates.map((p) => p[0]), ys = route.coordinates.map((p) => p[1]);
  const box: Box = [Math.min(...xs) - 0.005, Math.min(...ys) - 0.005, Math.max(...xs) + 0.005, Math.max(...ys) + 0.005];
  const [features, elevation] = await Promise.all([
    fetchFeatures(box, undefined, options.signal).then((list) => featuresAlong(route.coordinates, list)),
    elevationProfile([route.coordinates], 400).catch(() => null),
  ]);
  return { ...route, features, elevation, hours: naismithHours(route.miles, elevation?.gainFt ?? null) };
}
