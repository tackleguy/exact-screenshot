/**
 * 3D for every MapLibre map on the site: terrain from its own DEM source (hillshading has a separate one, as
 * MapLibre recommends), a camera that looks up the trail with all of it in view, a decluttered map (no contour
 * labels or minor road labels), sky and fog, and a fly-through along a trail.
 */
import type * as maplibreTypes from "maplibre-gl";
import { chainLines, Route } from "@/lib/geo/line";
import { setSky } from "./explorer-map";

type LngLat = [number, number];
export const TERRAIN_DEM = "terrain-dem";
export const HILLSHADE_DEM = "hillshade-dem";
export const PITCH_3D = 60;
const MAX_3D_ZOOM = 13;

/** Terrain exaggeration: 1.5, easing to 1.3 above zoom 13 where the relief is already large on screen. */
export const terrainExaggeration = (zoom: number) => (zoom > 13 ? 1.3 : 1.5);

/** Labels hidden in 3D (and contour labels below zoom 12): contour labels and minor-road names and shields. */
const CLUTTER = /^(contour-labels|highway-name-path|highway-name-minor|highway-shield.*|road_shield_us|road_one_way_arrow.*)$/;

export function declutter(map: maplibreTypes.Map, on: boolean) {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (CLUTTER.test(layer.id)) map.setLayoutProperty(layer.id, "visibility", on ? "none" : "visible");
  }
}

/** Compass bearing in degrees from a to b. */
export function bearing(a: LngLat, b: LngLat) {
  const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

/** The point `meters` along a route. */
export function pointAt(route: Route, meters: number): LngLat {
  const { points, along } = route;
  if (!points.length) return [0, 0];
  if (meters <= 0) return points[0];
  let lo = 0, hi = along.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (along[mid] < meters) lo = mid + 1; else hi = mid; }
  if (lo === 0) return points[0];
  const a = points[lo - 1], b = points[lo], span = along[lo] - along[lo - 1];
  const t = span > 0 ? Math.min(1, (meters - along[lo - 1]) / span) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * The bearing that looks up the trail: from its start toward its highest point (from an elevation profile of
 * [mile, feet] pairs when known), else toward its far end.
 */
export function bearingUpTrail(lines: LngLat[][], profile?: [number, number][] | null): number | null {
  const pieces = chainLines(lines.filter((l) => l.length > 1));
  if (!pieces.length) return null;
  const route = new Route(pieces);
  const start = route.points[0];
  let target = route.points[route.points.length - 1];
  if (profile && profile.length > 1) {
    const top = profile.reduce((best, p) => (p[1] > best[1] ? p : best), profile[0]);
    target = pointAt(route, top[0] * 1609.344);
  }
  if (Math.abs(start[0] - target[0]) + Math.abs(start[1] - target[1]) < 1e-5) target = route.points[Math.floor(route.points.length / 2)];
  return bearing(start, target);
}

/** Tilts to 60° looking up the trail, framed so the whole trail stays in view at that pitch. */
export function cameraUpTrail(map: maplibreTypes.Map, lines: LngLat[][], profile?: [number, number][] | null, padding = 60) {
  const pts = lines.flat();
  if (!pts.length) { map.easeTo({ pitch: PITCH_3D, duration: 900 }); return; }
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of pts) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  const b = bearingUpTrail(lines, profile) ?? map.getBearing();
  const cam = map.cameraForBounds([[w, s], [e, n]], { padding, bearing: b });
  if (!cam) { map.easeTo({ pitch: PITCH_3D, bearing: b, duration: 900 }); return; }
  // At 60° the far half of the frame shrinks; backing off ~0.7 zoom keeps the far end of the trail on screen.
  // Capped at zoom 13 so the camera stays well above steep terrain (closer in, it can end up inside a cliff).
  map.easeTo({ center: cam.center, zoom: Math.min(MAX_3D_ZOOM, Math.max(1, (cam.zoom ?? map.getZoom()) - 0.7)), bearing: b, pitch: PITCH_3D, duration: 1200 });
}

/** The selected trail reads against imagery in 3D: a 5 px line with an 8 px white casing; widths restored after. */
export function trailLine3d(map: maplibreTypes.Map, on: boolean, ids = { line: "hy-selected", casing: "hy-selected-casing" }) {
  const saved = (map as unknown as { __trail2d?: Record<string, unknown> }).__trail2d ??= {};
  for (const [id, width, color] of [[ids.line, 5, null], [ids.casing, 8, "#ffffff"]] as const) {
    if (!map.getLayer(id)) continue;
    if (on) {
      saved[`${id}:w`] ??= map.getPaintProperty(id, "line-width");
      if (color) saved[`${id}:c`] ??= map.getPaintProperty(id, "line-color");
      map.setPaintProperty(id, "line-width", width);
      if (color) map.setPaintProperty(id, "line-color", color);
    } else {
      if (saved[`${id}:w`] !== undefined) map.setPaintProperty(id, "line-width", saved[`${id}:w`] as never);
      if (color && saved[`${id}:c`] !== undefined) map.setPaintProperty(id, "line-color", saved[`${id}:c`] as never);
    }
  }
}

/** Turns 3D on or off: terrain (with its exaggeration following the zoom), sky and fog, decluttered labels. */
export function setThreeD(map: maplibreTypes.Map, on: boolean) {
  const apply = () => {
    if (!map.getSource(TERRAIN_DEM)) return;
    map.setTerrain(on ? { source: TERRAIN_DEM, exaggeration: terrainExaggeration(map.getZoom()) } : null);
    setSky(map, on);
    declutter(map, on);
  };
  apply();
  const zoomed = () => { if (map.getTerrain()) map.setTerrain({ source: TERRAIN_DEM, exaggeration: terrainExaggeration(map.getZoom()) }); };
  map.off("zoomend", zoomed as never);
  if (on) map.on("zoomend", zoomed);
  if (!on) map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
}

/**
 * Flies the camera along the trail over `seconds` (default 20): requestAnimationFrame steps the camera along the
 * line, looking a little ahead, with the heading eased so switchbacks don't spin the view. Returns a stop function.
 */
export function flyThrough(map: maplibreTypes.Map, lines: LngLat[][], onDone?: () => void, seconds = 20): () => void {
  const route = new Route(chainLines(lines.filter((l) => l.length > 1)));
  const total = route.meters;
  if (!total) { onDone?.(); return () => undefined; }
  const lookAhead = Math.min(400, total / 8);
  let heading = bearing(pointAt(route, 0), pointAt(route, lookAhead));
  let frame = 0, stopped = false;
  const started = performance.now();
  const zoom = Math.min(14, Math.max(12, map.getZoom() + 0.5));
  const step = (now: number) => {
    if (stopped) return;
    const t = Math.min(1, (now - started) / (seconds * 1000));
    const here = pointAt(route, t * total);
    const target = bearing(here, pointAt(route, Math.min(total, t * total + lookAhead)));
    const delta = ((target - heading + 540) % 360) - 180;
    heading = (heading + delta * 0.06 + 360) % 360;
    map.easeTo({ center: here, bearing: heading, pitch: 65, zoom, duration: 0 });
    if (t < 1) frame = requestAnimationFrame(step);
    else { stopped = true; onDone?.(); }
  };
  frame = requestAnimationFrame(step);
  return () => { if (!stopped) { stopped = true; cancelAnimationFrame(frame); onDone?.(); } };
}
