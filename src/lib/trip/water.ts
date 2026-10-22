import { tileFeaturesOrNull, type LngLat, type TileFeature } from "@/lib/geo/tiles";
import { MILE_METERS, Route, round, segmentIntersection } from "@/lib/geo/line";
import { FEATURE_LABELS, type TrailFeature } from "@/lib/trail-catalog/features";

export type WaterKind = "tap" | "spring" | "river" | "stream" | "lake";
/** potable: a mapped drinking-water tap; treat: natural water to filter or treat; seasonal: mapped as intermittent. */
export type WaterReliability = "potable" | "treat" | "seasonal";

export interface WaterSource {
  kind: WaterKind;
  name: string | null;
  /** Mile along the trail where the source is (or is closest to it). */
  mile: number;
  /** How far the source is from the trail line. 0 for crossings. */
  offTrailMeters: number;
  crossing: boolean;
  reliability: WaterReliability;
  latitude: number;
  longitude: number;
}

export interface WaterReport {
  sources: WaterSource[];
  /** Longest stretch of trail between dependable sources (taps, springs, lakes, year-round streams). */
  longestDryMiles: number;
  trailMiles: number;
  /** True when the trail was too long to scan completely, or some map data could not be read. */
  partial: boolean;
  /** Map tiles that could not be read; the result is then incomplete and not cached. */
  unreadableTiles: number;
  attribution: string;
  notes: string[];
}

const Z = 14;
const MAX_TILES = 140;
const POINT_RADIUS = 300;
const LAKE_RADIUS = 200;
const ALONG_RADIUS = 60;
const MERGE_METERS = 150;

function lines(geometry: GeoJSON.Geometry): LngLat[][] {
  if (geometry.type === "LineString") return [geometry.coordinates as LngLat[]];
  if (geometry.type === "MultiLineString") return geometry.coordinates as LngLat[][];
  if (geometry.type === "Polygon") return geometry.coordinates as LngLat[][];
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as LngLat[][][]).flat();
  return [];
}
const pointOf = (geometry: GeoJSON.Geometry): LngLat | null => (geometry.type === "Point" ? (geometry.coordinates as LngLat) : null);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function pointKind(f: TileFeature): WaterKind | null {
  const p = f.properties;
  if (p.natural === "spring" || p.class === "spring" || p.subclass === "spring") return "spring";
  if (["drinking_water", "water_point"].includes(String(p.amenity ?? "")) || p.man_made === "water_tap" || p.class === "drinking_water" || p.subclass === "drinking_water" || p.subclass === "water_point") return "tap";
  return null;
}

/** Water along a trail from OpenStreetMap US vector tiles (OpenMapTiles + trails schema). */
export async function waterAlong(trailLines: LngLat[][]): Promise<WaterReport> {
  const route = new Route(trailLines);
  const tiles = route.tiles(Z, 0, MAX_TILES);
  const partial = route.tiles(Z, 0, MAX_TILES + 1).length > MAX_TILES;
  const results = (await Promise.all(tiles.map(([x, y]) => Promise.all([
    tileFeaturesOrNull("openmaptiles", Z, x, y, ["waterway", "water", "poi"]),
    tileFeaturesOrNull("trails", Z, x, y, ["trail_poi"]),
  ])))).flat();
  const unreadable = results.filter((r) => r === null).length;
  const features = results.flatMap((r) => r ?? []);

  const found: WaterSource[] = [];
  const add = (s: Omit<WaterSource, "mile" | "latitude" | "longitude">, alongMeters: number, at: LngLat) =>
    found.push({ ...s, mile: round(alongMeters / MILE_METERS, 2), latitude: round(at[1], 5), longitude: round(at[0], 5) });

  // Route segments, for crossing tests.
  const segs: [LngLat, LngLat, number, number][] = [];
  for (let i = 1; i < route.points.length; i++) {
    if (route.along[i] === route.along[i - 1] && i > 0) continue;
    segs.push([route.points[i - 1], route.points[i], route.along[i - 1], route.along[i]]);
  }

  for (const f of features) {
    if (f.layer === "waterway") {
      const cls = String(f.properties.class ?? "");
      if (!["stream", "river", "canal"].includes(cls)) continue;
      const kind: WaterKind = cls === "river" ? "river" : "stream";
      const intermittent = f.properties.intermittent === 1 || f.properties.intermittent === true || f.properties.intermittent === "1";
      const reliability: WaterReliability = intermittent ? "seasonal" : "treat";
      const name = text(f.properties.name);
      let crossed = false;
      for (const line of lines(f.geometry)) {
        for (let i = 1; i < line.length; i++) {
          const c = line[i - 1], d = line[i];
          const minX = Math.min(c[0], d[0]), maxX = Math.max(c[0], d[0]), minY = Math.min(c[1], d[1]), maxY = Math.max(c[1], d[1]);
          for (const [a, b, s0, s1] of segs) {
            if (Math.max(a[0], b[0]) < minX || Math.min(a[0], b[0]) > maxX || Math.max(a[1], b[1]) < minY || Math.min(a[1], b[1]) > maxY) continue;
            const hit = segmentIntersection(a, b, c, d);
            if (!hit) continue;
            const t = Math.hypot(hit[0] - a[0], hit[1] - a[1]) / Math.max(1e-12, Math.hypot(b[0] - a[0], b[1] - a[1]));
            add({ kind, name, offTrailMeters: 0, crossing: true, reliability }, s0 + (s1 - s0) * t, hit);
            crossed = true;
          }
        }
      }
      if (!crossed) {
        // A stream running beside the trail is water too, if it comes close.
        let best: ReturnType<Route["locate"]> | null = null, bestPoint: LngLat | null = null;
        for (const line of lines(f.geometry)) for (const p of line) { const l = route.locate(p); if (!best || l.offMeters < best.offMeters) { best = l; bestPoint = p; } }
        if (best && bestPoint && best.offMeters <= ALONG_RADIUS) add({ kind, name, offTrailMeters: Math.round(best.offMeters), crossing: false, reliability }, best.alongMeters, bestPoint);
      }
    } else if (f.layer === "water") {
      const cls = String(f.properties.class ?? "");
      if (!["lake", "pond", "river"].includes(cls) || f.properties.intermittent === 1) continue;
      let best: ReturnType<Route["locate"]> | null = null, bestPoint: LngLat | null = null;
      for (const ring of lines(f.geometry)) for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 200))) {
        const l = route.locate(ring[i]);
        if (!best || l.offMeters < best.offMeters) { best = l; bestPoint = ring[i]; }
      }
      if (best && bestPoint && best.offMeters <= LAKE_RADIUS) add({ kind: cls === "river" ? "river" : "lake", name: null, offTrailMeters: Math.round(best.offMeters), crossing: false, reliability: "treat" }, best.alongMeters, bestPoint);
    } else {
      const kind = pointKind(f);
      const p = pointOf(f.geometry);
      if (!kind || !p) continue;
      const l = route.locate(p);
      if (l.offMeters <= POINT_RADIUS) add({ kind, name: text(f.properties.name), offTrailMeters: Math.round(l.offMeters), crossing: false, reliability: kind === "tap" ? "potable" : "treat" }, l.alongMeters, p);
    }
  }

  // Tiles overlap and long features repeat: keep one source per kind/name within MERGE_METERS along.
  found.sort((a, b) => a.mile - b.mile || a.offTrailMeters - b.offTrailMeters);
  const sources: WaterSource[] = [];
  for (const s of found) {
    const dup = sources.find((o) => o.kind === s.kind && (o.name ?? "") === (s.name ?? "") && Math.abs(o.mile - s.mile) * MILE_METERS < MERGE_METERS);
    if (dup) { if (!dup.name && s.name) dup.name = s.name; continue; }
    sources.push(s);
  }

  const trailMiles = round(route.meters / MILE_METERS, 2);
  const dependable = sources.filter((s) => s.reliability !== "seasonal").map((s) => s.mile);
  const stops = [0, ...dependable, trailMiles].sort((a, b) => a - b);
  let longestDryMiles = 0;
  for (let i = 1; i < stops.length; i++) longestDryMiles = Math.max(longestDryMiles, stops[i] - stops[i - 1]);

  const notes = [
    "Treat or filter all natural water. Taps are mapped as drinking water but may be turned off seasonally.",
    "Streams marked seasonal are mapped as intermittent and may be dry.",
  ];
  if (!sources.length) notes.unshift("No water is mapped along this trail. Carry all the water you need.");
  if (partial) notes.push("This trail is long, so only its first part was scanned for water.");
  if (unreadable) notes.push("Some map data couldn’t be loaded, so this list may be missing sources. Reload to try again.");
  return {
    sources,
    longestDryMiles: round(longestDryMiles, 1),
    trailMiles,
    partial: partial || unreadable > 0,
    unreadableTiles: unreadable,
    attribution: "Water features © OpenStreetMap contributors, via OpenStreetMap US tiles (OpenMapTiles schema).",
    notes,
  };
}

/** The water report from the build-time feature layer (features already placed at their trail miles). */
export function waterFromFeatures(features: TrailFeature[], trailMiles: number): WaterReport {
  const kindOf: Partial<Record<TrailFeature["type"], WaterKind>> = { spring: "spring", drinking_water: "tap", lake: "lake", river: "river", crossing: "stream", ford: "stream" };
  const sources: WaterSource[] = [];
  for (const f of features) {
    const kind = f.type === "crossing" && f.extra.waterway === "river" ? "river" : kindOf[f.type];
    if (!kind) continue;
    const crossing = f.type === "crossing" || f.type === "ford";
    const seasonal = f.extra.intermittent === true || f.extra.seasonal === "yes";
    sources.push({
      kind, name: f.name && f.name !== FEATURE_LABELS[f.type] ? f.name : null, mile: round(f.mile, 2), offTrailMeters: crossing ? 0 : Math.round(f.offTrailFt / 3.28084), crossing,
      reliability: kind === "tap" ? "potable" : seasonal ? "seasonal" : "treat", latitude: f.lat, longitude: f.lon,
    });
  }
  const dependable = sources.filter((s) => s.reliability !== "seasonal").map((s) => s.mile);
  const stops = [0, ...dependable, trailMiles].sort((a, b) => a - b);
  let longestDryMiles = 0;
  for (let i = 1; i < stops.length; i++) longestDryMiles = Math.max(longestDryMiles, stops[i] - stops[i - 1]);
  const notes = [
    "Treat or filter all natural water. Taps are mapped as drinking water but may be turned off seasonally.",
    "Streams marked seasonal are mapped as intermittent and may be dry.",
  ];
  if (!sources.length) notes.unshift("No water is mapped along this trail. Carry all the water you need.");
  return { sources, longestDryMiles: round(longestDryMiles, 1), trailMiles: round(trailMiles, 2), partial: false, unreadableTiles: 0, attribution: "Water features © OpenStreetMap contributors (ODbL), from Hyked's feature layer.", notes };
}
