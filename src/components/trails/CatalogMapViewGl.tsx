"use client";

import { useEffect, useRef, useState } from "react";
import type * as maplibreTypes from "maplibre-gl";
import * as maplibregl from "@/lib/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { BASEMAPS, explorerStyle, type Basemap } from "@/components/explore/explorer-map";
import { cameraUpTrail, flyThrough, PITCH_3D, setThreeD, trailLine3d } from "@/components/explore/three-d";
import "@/components/explore/explorer.css";
import { chainLines, MILE_METERS, Route } from "@/lib/geo/line";
import { emitTrailHover, onTrailHover } from "@/lib/trail-hover";

const NO_TRAILS: CatalogTrail[] = [];
const NO_LINES: [number, number][][] = [];
const NO_PINS: MapPin[] = [];
const TRAIL_COLOR = "#2f9e5b";
const TRAIL_IDS = { line: "trail-line", casing: "trail-casing" };

export interface MapPin {
  latitude: number;
  longitude: number;
  label: string;
  kind: "start" | "origin" | "option";
}

/** [west, south, east, north] around everything the map will show, or null when there's nothing yet. */
function initialBounds(lines: [number, number][][], route: [number, number][] | undefined, pins: MapPin[], trails: CatalogTrail[]): [number, number, number, number] | null {
  let w = 180, s = 90, e = -180, n = -90;
  const add = (x: number, y: number) => { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; };
  for (const l of lines) for (const [x, y] of l) add(x, y);
  for (const [x, y] of route ?? []) add(x, y);
  for (const p of pins) if (p.kind !== "option") add(p.longitude, p.latitude);
  for (const t of trails) add(t.longitude, t.latitude);
  if (w > e) return null;
  // A single point gets a small box (about 1 km) so it opens at street level.
  if (e - w < 0.002 && n - s < 0.002) return [w - 0.005, s - 0.005, e + 0.005, n + 0.005];
  return [w, s, e, n];
}

const readBasemap = (): Basemap => {
  try { const saved = localStorage.getItem("hyked:basemap"); return BASEMAPS.some((b) => b.key === saved) ? (saved as Basemap) : "topo"; } catch { return "topo"; }
};

/**
 * Trail map on trail pages (MapLibre, the same basemaps as the explorer): the trail's line with its name, the
 * driving route to the start, start/origin pins, or clickable pins for a list of trails. A style picker, 3D
 * terrain and full screen sit in the corner.
 */
export function CatalogMapView({
  trails = NO_TRAILS,
  lines = NO_LINES,
  route,
  pins = NO_PINS,
  name,
  trailId,
  live = null,
  start3d = false,
}: {
  trails?: CatalogTrail[];
  lines?: [number, number][][];
  /** Driving route to the start, [lng, lat] pairs; the map fits it when present. */
  route?: [number, number][];
  pins?: MapPin[];
  /** Trail name, drawn along the line. */
  name?: string;
  /** The catalog trail shown, so 3D can look up toward its highest point (from its elevation profile). */
  trailId?: string;
  /** The visitor's live position while recording, drawn as a dot and followed. */
  live?: [number, number] | null;
  /** Open in 3D (the recorder's 3D view). */
  start3d?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibreTypes.Map | null>(null);
  const markers = useRef<maplibreTypes.Marker[]>([]);
  const [failed, setFailed] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>(readBasemap);
  const [picker, setPicker] = useState(false);
  const [is3d, setIs3d] = useState(start3d);
  const [flying, setFlying] = useState(false);
  const stopFlight = useRef<(() => void) | null>(null);
  const liveMarker = useRef<maplibreTypes.Marker | null>(null);
  // 3D switches to satellite imagery; the chosen style comes back (and stays remembered) when 3D is turned off.
  const before3d = useRef<Basemap | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const data = useRef({ lines, route, name });
  useEffect(() => { data.current = { lines, route, name }; }, [lines, route, name]);

  // Trail and route layers, added again after every style change.
  const install = (map: maplibreTypes.Map) => {
    const { lines: ls, route: rt, name: nm } = data.current;
    if (!map.getSource("trail")) {
      map.addSource("trail", { type: "geojson", data: { type: "Feature", properties: { name: nm ?? "" }, geometry: { type: "MultiLineString", coordinates: ls } } });
      map.addLayer({ id: "trail-casing", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 14, 8], "line-opacity": 0.9 } });
      map.addLayer({ id: "trail-line", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": TRAIL_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 14, 5] } });
      map.addLayer({ id: "trail-label", type: "symbol", source: "trail", minzoom: 11, layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 13, "symbol-spacing": 350 }, paint: { "text-color": "#14532d", "text-halo-color": "#ffffff", "text-halo-width": 2 } });
    }
    if (!map.getSource("drive")) {
      map.addSource("drive", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: rt && rt.length > 1 ? rt : [] } } });
      map.addLayer({ id: "drive-line", type: "line", source: "drive", layout: { "line-cap": "round" }, paint: { "line-color": "#2563eb", "line-width": 4, "line-dasharray": [2, 1.5], "line-opacity": 0.85 } });
    }
  };

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    void explorerStyle(basemap).then((style) => {
      if (disposed || !container.current) return;
      let map: maplibreTypes.Map;
      try {
        // Open framed on the trail (40 px padding) so the first paint never shows a continent-wide view.
        const first = initialBounds(data.current.lines, data.current.route, pins, trails);
        map = new maplibregl.Map({ container: container.current, style, ...(first ? { bounds: first, fitBoundsOptions: { padding: 40, maxZoom: 15 } } : { center: [-98, 45], zoom: 3 }), maxPitch: 80, attributionControl: false, cooperativeGestures: true });
      } catch {
        setFailed(true);
        return;
      }
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
      map.addControl(new maplibregl.FullscreenControl(), "top-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "imperial", maxWidth: 90 }), "bottom-left");
      map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Trails © OpenStreetMap contributors (ODbL), NPS, USFS, BLM, USGS, Parks Canada" }), "bottom-right");
      map.on("style.load", () => install(map));
      map.on("load", () => {
        setReady(true);
      });
      // Start the compact attribution folded (after the first render, when MapLibre opens it); the (i) button still opens it.
      map.once("idle", () => container.current?.querySelector(".maplibregl-compact-show")?.classList.remove("maplibregl-compact-show"));
      map.on("error", (e) => { if (/style/i.test(e.error?.message ?? "")) setFailed(true); });
      observer = new ResizeObserver(() => map.resize());
      observer.observe(container.current);
    }).catch(() => setFailed(true));
    return () => {
      disposed = true;
      observer?.disconnect();
      markers.current.forEach((m) => m.remove());
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Data: lines, route, pins and trail markers; fit everything in view.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("trail") as maplibreTypes.GeoJSONSource | undefined)?.setData({ type: "Feature", properties: { name: name ?? "" }, geometry: { type: "MultiLineString", coordinates: lines } });
    (map.getSource("drive") as maplibreTypes.GeoJSONSource | undefined)?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route && route.length > 1 ? route : [] } });
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const bounds = new maplibregl.LngLatBounds();
    for (const line of lines) for (const p of line) bounds.extend(p);
    for (const p of route ?? []) bounds.extend(p);
    for (const pin of pins) {
      const el = document.createElement("span");
      el.className = `catalog-map-pin ${pin.kind}`;
      el.title = pin.label;
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([pin.longitude, pin.latitude]).setPopup(new maplibregl.Popup({ offset: 12, closeButton: false }).setText(pin.label)).addTo(map));
      if (pin.kind !== "option") bounds.extend([pin.longitude, pin.latitude]);
    }
    for (const t of trails) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "catalog-map-dot";
      el.title = t.name;
      el.setAttribute("aria-label", `Open ${t.name}`);
      el.addEventListener("click", () => router.push(`/explore/trails/${encodeURIComponent(t.id)}`));
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([t.longitude, t.latitude]).addTo(map));
      bounds.extend([t.longitude, t.latitude]);
    }
    if (!bounds.isEmpty()) {
      const ne = bounds.getNorthEast(), sw = bounds.getSouthWest();
      if (ne.lng === sw.lng && ne.lat === sw.lat) map.jumpTo({ center: ne, zoom: 12 });
      else map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 0 });
    }
  }, [ready, lines, route, pins, trails, name, router]);

  // Style changes keep the view and re-add the trail.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!before3d.current) try { localStorage.setItem("hyked:basemap", basemap); } catch { /* storage unavailable */ }
    const map = mapRef.current;
    if (!map) return;
    let live = true;
    void explorerStyle(basemap).then((style) => {
      if (!live) return;
      map.setStyle(style, { diff: false });
      map.once("style.load", () => { if (is3d) { setThreeD(map, true); trailLine3d(map, true, TRAIL_IDS); } });
    });
    return () => { live = false; };
  }, [basemap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setThreeD(map, is3d);
    trailLine3d(map, is3d, TRAIL_IDS);
    if (!is3d) { stopFlight.current?.(); return; }
    const ls = data.current.lines;
    if (!ls.length || live) { map.easeTo({ pitch: PITCH_3D, duration: 900 }); return; }
    cameraUpTrail(map, ls, null, 40);
    // Then aim toward the highest point once the elevation profile is known (cached by the trail service).
    if (trailId) fetch(`/api/trail-catalog/${encodeURIComponent(trailId)}/elevation`).then((r) => (r.ok ? r.json() : null)).then((e: { profile?: [number, number][] } | null) => {
      if (e?.profile?.length && mapRef.current === map && map.getPitch() > 30 && !stopFlight.current) cameraUpTrail(map, ls, e.profile, 40);
    }).catch(() => undefined);
    // The trail's lines are read when 3D turns on; later line updates don't re-aim the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is3d, ready, trailId]);

  // Live position while recording: a dot that the camera follows.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!live) { liveMarker.current?.remove(); liveMarker.current = null; return; }
    if (!liveMarker.current) {
      const el = document.createElement("span");
      el.className = "catalog-map-live";
      el.setAttribute("aria-label", "Your position");
      liveMarker.current = new maplibregl.Marker({ element: el }).setLngLat(live).addTo(map);
    } else liveMarker.current.setLngLat(live);
    map.easeTo({ center: live, duration: 800 });
  }, [live, ready]);

  // The elevation chart and the map point at the same place: chart hover moves a dot along the line, and
  // hovering the line moves the chart's cursor. Miles run along the chained line, as the chart measures them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !trailId || !lines.length) return;
    const route = new Route(chainLines(lines));
    const el = document.createElement("span");
    el.className = "catalog-map-hover";
    const dot = new maplibregl.Marker({ element: el });
    const off = onTrailHover((h) => {
      if (h.trailId !== trailId || h.from !== "chart") return;
      const at = h.mile === null ? null : route.pointAt(h.mile * MILE_METERS);
      if (at) dot.setLngLat(at).addTo(map); else dot.remove();
    });
    const move = (ev: maplibreTypes.MapLayerMouseEvent) => {
      const { alongMeters, offMeters } = route.locate([ev.lngLat.lng, ev.lngLat.lat]);
      if (offMeters < 200) emitTrailHover({ trailId, mile: alongMeters / MILE_METERS, from: "map" });
    };
    const leave = () => emitTrailHover({ trailId, mile: null, from: "map" });
    map.on("mousemove", TRAIL_IDS.line, move);
    map.on("mouseleave", TRAIL_IDS.line, leave);
    return () => { off(); dot.remove(); map.off("mousemove", TRAIL_IDS.line, move); map.off("mouseleave", TRAIL_IDS.line, leave); };
  }, [ready, trailId, lines]);

  /** 3D on switches to satellite imagery; off brings the chosen style back. */
  const toggle3d = () => {
    if (!is3d && basemap !== "satellite" && basemap !== "hybrid") { before3d.current = basemap; setBasemap("satellite"); }
    if (is3d && before3d.current) { const back = before3d.current; before3d.current = null; setBasemap(back); }
    setIs3d(!is3d);
  };

  const fly = () => {
    const map = mapRef.current;
    if (!map) return;
    if (flying) { stopFlight.current?.(); return; }
    setFlying(true);
    stopFlight.current = flyThrough(map, data.current.lines, () => { setFlying(false); stopFlight.current = null; });
  };

  return (
    <div className="catalog-map-gl">
      <div ref={container} className="catalog-map-canvas" role="region" aria-label="Trail map" />
      <div className="catalog-map-tools">
        <button type="button" className="catalog-map-tool" aria-pressed={is3d} onClick={toggle3d}>3D</button>
        {is3d && !live && lines.length > 0 && <button type="button" className="catalog-map-tool" aria-pressed={flying} onClick={fly}>{flying ? "Stop" : "Fly-through"}</button>}
        <button type="button" className="catalog-map-tool" aria-expanded={picker} onClick={() => setPicker((v) => !v)}>Map style</button>
        {picker && (
          <div className="hx-pop hx-pop--right hx-layers catalog-map-picker">
            <div className="hx-layer-grid" role="group" aria-label="Map style">
              {BASEMAPS.map(({ key, label, hint }) => (
                <button key={key} type="button" className={`hx-layer hx-layer--${key}`} aria-pressed={basemap === key} title={hint} onClick={() => { setBasemap(key); setPicker(false); }}>
                  <span className="hx-layer-swatch" aria-hidden="true" />
                  <span className="hx-layer-name">{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {failed && (
        <p role="status" className="catalog-muted">
          The map couldn’t load. Check your connection, or download the GPX to see the trail in another app.
        </p>
      )}
    </div>
  );
}
