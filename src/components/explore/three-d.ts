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
const MAX_3D_ZOOM = 14.2;

/** Terrain exaggeration: 1.35 from afar so relief reads, easing to a near-true 1.15 up close (like a real view). */
export const terrainExaggeration = (zoom: number) => (zoom > 13 ? 1.15 : 1.35);

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
  // Capped at zoom 14.2 so the camera stays above steep terrain (closer in, it can end up inside a cliff).
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

export interface FlyoverState { playing: boolean; /** 0–1 along the trail. */ progress: number; meters: number; totalMeters: number; speed: number }
export interface Flyover {
  play(): void;
  pause(): void;
  /** Jump to a fraction of the trail (0–1); the camera follows whether playing or paused. */
  seek(progress: number): void;
  setSpeed(speed: number): void;
  /** Stops and removes the marker and the travelled line. */
  destroy(): void;
  readonly state: FlyoverState;
}

/** Source and layer for the part of the trail the flyover has covered. */
export const FLYOVER_SOURCE = "flyover-progress";

/**
 * A flyover of the trail: a marker travels the line at a steady ground speed while the camera chases it from
 * behind and above, looking ahead, with the heading eased so switchbacks don't spin the view. The part already
 * covered is drawn brighter. It can be played, paused, scrubbed and sped up; `onChange` reports each step.
 * A full pass takes 25–75 s at 1× depending on the trail's length.
 */
export function createFlyover(map: maplibreTypes.Map, maplibre: typeof maplibreTypes, lines: LngLat[][], onChange: (s: FlyoverState) => void, beforeLayer?: string): Flyover | null {
  const route = new Route(chainLines(lines.filter((l) => l.length > 1)));
  const total = route.meters;
  if (!total) return null;
  const baseSeconds = Math.min(75, Math.max(25, total / 160));
  const lookAhead = Math.min(350, Math.max(60, total / 10));
  const zoom = total < 1500 ? 15.6 : total < 6000 ? 15 : total < 20000 ? 14.3 : 13.6;
  const state: FlyoverState = { playing: false, progress: 0, meters: 0, totalMeters: total, speed: 1 };
  let heading = bearing(pointAt(route, 0), pointAt(route, lookAhead));
  let frame = 0, last = 0, lastLine = -1, dead = false;

  const el = document.createElement("span");
  el.className = "flyover-marker";
  const marker = new maplibre.Marker({ element: el }).setLngLat(route.points[0]).addTo(map);
  const ensureLayer = () => {
    if (map.getSource(FLYOVER_SOURCE)) return;
    map.addSource(FLYOVER_SOURCE, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } } });
    map.addLayer({ id: FLYOVER_SOURCE, type: "line", source: FLYOVER_SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffd23f", "line-width": 5 } }, beforeLayer && map.getLayer(beforeLayer) ? beforeLayer : undefined);
  };
  /** The line from the start to `meters`, for the travelled highlight. */
  const travelled = (meters: number): LngLat[] => {
    const { points, along } = route;
    let hi = 0;
    while (hi < along.length && along[hi] <= meters) hi++;
    return [...points.slice(0, hi), pointAt(route, meters)];
  };
  const render = (snap: boolean) => {
    const at = state.progress * total;
    const here = pointAt(route, at);
    const target = bearing(here, pointAt(route, Math.min(total, at + lookAhead)));
    const delta = ((target - heading + 540) % 360) - 180;
    heading = (heading + delta * (snap ? 1 : 0.05) + 360) % 360;
    marker.setLngLat(here);
    // The camera looks at a point a little ahead of the marker, so the marker sits in the lower part of the frame.
    map.jumpTo({ center: pointAt(route, Math.min(total, at + lookAhead * 0.35)), bearing: heading, pitch: 68, zoom });
    const step = Math.floor(at / 15);
    if (step !== lastLine || snap) {
      lastLine = step;
      ensureLayer();
      (map.getSource(FLYOVER_SOURCE) as maplibreTypes.GeoJSONSource | undefined)?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: travelled(at) } });
    }
    state.meters = at;
    onChange({ ...state });
  };
  const tick = (now: number) => {
    if (dead || !state.playing) return;
    const dt = Math.min(0.3, (now - last) / 1000); // slow devices still keep pace
    last = now;
    state.progress = Math.min(1, state.progress + (dt * state.speed) / baseSeconds);
    if (state.progress >= 1) state.playing = false;
    render(false);
    if (state.playing) frame = requestAnimationFrame(tick);
  };
  return {
    state,
    play() {
      if (dead || state.playing) return;
      if (state.progress >= 1) { state.progress = 0; heading = bearing(pointAt(route, 0), pointAt(route, lookAhead)); }
      state.playing = true;
      last = performance.now();
      frame = requestAnimationFrame(tick);
      onChange({ ...state });
    },
    pause() { state.playing = false; cancelAnimationFrame(frame); onChange({ ...state }); },
    seek(progress) { state.progress = Math.min(1, Math.max(0, progress)); render(true); },
    setSpeed(speed) { state.speed = speed; onChange({ ...state }); },
    destroy() {
      dead = true;
      state.playing = false;
      cancelAnimationFrame(frame);
      marker.remove();
      if (map.getLayer(FLYOVER_SOURCE)) map.removeLayer(FLYOVER_SOURCE);
      if (map.getSource(FLYOVER_SOURCE)) map.removeSource(FLYOVER_SOURCE);
    },
  };
}
