"use client";

import { useEffect, useRef, useState } from "react";
import type * as maplibreTypes from "maplibre-gl";
import * as maplibregl from "@/lib/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useRouter } from "next/navigation";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { BASEMAPS, explorerStyle, setSky, type Basemap } from "@/components/explore/explorer-map";
import "@/components/explore/explorer.css";

const NO_TRAILS: CatalogTrail[] = [];
const NO_LINES: [number, number][][] = [];
const NO_PINS: MapPin[] = [];
const TRAIL_COLOR = "#2f9e5b";

export interface MapPin {
  latitude: number;
  longitude: number;
  label: string;
  kind: "start" | "origin" | "option";
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
}: {
  trails?: CatalogTrail[];
  lines?: [number, number][][];
  /** Driving route to the start, [lng, lat] pairs; the map fits it when present. */
  route?: [number, number][];
  pins?: MapPin[];
  /** Trail name, drawn along the line. */
  name?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibreTypes.Map | null>(null);
  const markers = useRef<maplibreTypes.Marker[]>([]);
  const [failed, setFailed] = useState(false);
  const [basemap, setBasemap] = useState<Basemap>(readBasemap);
  const [picker, setPicker] = useState(false);
  const [is3d, setIs3d] = useState(false);
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
        map = new maplibregl.Map({ container: container.current, style, center: [-98, 45], zoom: 3, maxPitch: 80, attributionControl: false, cooperativeGestures: true });
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
        // Start the compact attribution folded; the (i) button still opens it.
        container.current?.querySelector(".maplibregl-compact-show")?.classList.remove("maplibregl-compact-show");
      });
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
    try { localStorage.setItem("hyked:basemap", basemap); } catch { /* storage unavailable */ }
    const map = mapRef.current;
    if (!map) return;
    let live = true;
    void explorerStyle(basemap).then((style) => {
      if (!live) return;
      map.setStyle(style, { diff: false });
      map.once("style.load", () => { if (is3d) { map.setTerrain({ source: "terrain", exaggeration: 1.4 }); setSky(map, true); } });
    });
    return () => { live = false; };
  }, [basemap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (is3d) { map.setTerrain({ source: "terrain", exaggeration: 1.4 }); setSky(map, true); map.easeTo({ pitch: 60, duration: 600 }); }
    else { map.setTerrain(null); setSky(map, false); map.easeTo({ pitch: 0, bearing: 0, duration: 600 }); }
  }, [is3d, ready]);

  return (
    <div className="catalog-map-gl">
      <div ref={container} className="catalog-map-canvas" role="region" aria-label="Trail map" />
      <div className="catalog-map-tools">
        <button type="button" className="catalog-map-tool" aria-pressed={is3d} onClick={() => setIs3d((v) => !v)}>3D</button>
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
