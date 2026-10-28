/**
 * Measured versus estimated parts of a recorded route.
 *
 * When a phone pauses GPS (the page in the background), the recorder bridges the gap: along the followed trail
 * when both ends are on it, or with a straight join otherwise (src/lib/gps-track.ts). Those stretches are saved
 * with the activity as `route_geojson.estimated` (a GeoJSON foreign member, so the line stays valid for any
 * reader), and completed activities draw them dashed and say how much of the distance and climb they make up.
 *
 * Routes saved before this existed, manual logs and GPX imports have no `estimated` member: everything on them is
 * treated as measured, exactly as they were shown before.
 */
import type { GeoLineString, GpsPoint, RouteEstimates } from "@/lib/types";

type Kind = "trail" | "direct";

function metersBetween(a: [number, number, number?], b: [number, number, number?]) {
  const r = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

/**
 * The estimated stretches of a recorded track as coordinate ranges. A point marked estimated means the step
 * arriving at it wasn't measured, so a run of estimated points k..m of one kind is the range [k-1, m].
 */
export function estimatedRanges(points: Pick<GpsPoint, "estimated">[]): RouteEstimates["ranges"] {
  const out: RouteEstimates["ranges"] = [];
  for (let i = 1; i < points.length; i++) {
    const kind = points[i].estimated;
    if (!kind) continue;
    const last = out[out.length - 1];
    if (last && last[1] === i - 1 && last[2] === kind) last[1] = i;
    else out.push([i - 1, i, kind]);
  }
  return out;
}

/** The recorded line to save, with its estimated stretches when there are any (ordinary recordings unchanged). */
export function recordedLine(points: GpsPoint[], estimatedGainFt = 0): GeoLineString {
  const coordinates = points.map((p) => (p.altitude !== null ? [p.lng, p.lat, p.altitude] : [p.lng, p.lat]) as [number, number, number?]);
  const ranges = estimatedRanges(points);
  if (!ranges.length) return { type: "LineString", coordinates };
  let meters = 0;
  for (const [from, to] of ranges) for (let i = from + 1; i <= to; i++) meters += metersBetween(coordinates[i - 1], coordinates[i]);
  return { type: "LineString", coordinates, estimated: { version: 1, ranges, meters: Math.round(meters), gainFt: Math.round(Math.max(0, estimatedGainFt)) } };
}

/**
 * A saved route's estimates, checked before use: null for routes without any (older saves, manual logs, imports)
 * and for anything malformed, so a bad record shows as an ordinary route instead of breaking the page.
 */
export function routeEstimates(route: GeoLineString | null | undefined): RouteEstimates | null {
  const e = route?.estimated as Partial<RouteEstimates> | undefined;
  const n = route?.coordinates?.length ?? 0;
  if (!e || e.version !== 1 || !Array.isArray(e.ranges)) return null;
  const ranges = e.ranges.filter((r): r is [number, number, Kind] =>
    Array.isArray(r) && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 0 && r[1] > r[0] && r[1] < n && (r[2] === "trail" || r[2] === "direct"));
  if (!ranges.length) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return { version: 1, ranges, meters: num(e.meters), gainFt: num(e.gainFt) };
}

/** The route split into measured and estimated runs, in order, for drawing (estimated runs dashed). */
export function routeRuns(route: GeoLineString | null | undefined): { estimated: Kind | null; coordinates: [number, number][] }[] {
  const coords = (route?.coordinates ?? []).map((c) => [c[0], c[1]] as [number, number]);
  if (coords.length < 2) return [];
  const ranges = [...(routeEstimates(route)?.ranges ?? [])].sort((a, b) => a[0] - b[0]);
  const runs: { estimated: Kind | null; coordinates: [number, number][] }[] = [];
  let at = 0;
  for (const [from, to, kind] of ranges) {
    if (from < at) continue; // overlapping ranges in a malformed record: keep the first
    if (from > at) runs.push({ estimated: null, coordinates: coords.slice(at, from + 1) });
    runs.push({ estimated: kind, coordinates: coords.slice(from, to + 1) });
    at = to;
  }
  if (at < coords.length - 1) runs.push({ estimated: null, coordinates: coords.slice(at) });
  return runs;
}
