"use client";

import { useEffect, useRef } from "react";
import type { FeatureCollection } from "geojson";
import * as maplibregl from "@/lib/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useNavigate } from "react-router-dom";
import { geometryLines, saveOsmTrail, osmTrailHref } from "@/lib/osm-trail";

export const SKI_ATTRIBUTION = "© OpenStreetMap contributors (OpenTrailMap, OpenSkiMap)";

export const skiLineColor: maplibregl.ExpressionSpecification = [
  "case",
  ["==", ["get", "kind"], "ski-run"],
  ["match", ["coalesce", ["get", "difficulty"], ""], ["novice", "easy"], "#2f9e5b", "intermediate", "#2f7fd8", ["advanced", "expert", "freeride", "extreme"], "#111111", "#8a8a8a"],
  ["==", ["get", "kind"], "mountain-biking"], "#e07b24",
  "#8c4a32",
];

/** Open the trail behind a ski-area line: official ones go to the catalog, OSM ones to the OSM page. */
export function useOpenSkiFeature() {
  const navigate = useNavigate();
  return (f: { properties?: Record<string, unknown> | null; geometry: GeoJSON.Geometry }) => {
    const p = f.properties ?? {};
    const id = p.id ? String(p.id) : null;
    if (!id) return;
    if (p.source === "official" || p.dataSource === "official") { navigate(`/trail/${encodeURIComponent(id)}`); return; }
    const t = { id, name: (p.name as string) ?? null, lines: geometryLines(f.geometry), tags: { ...p }, origin: "ski" as const };
    saveOsmTrail(t);
    navigate(osmTrailHref(t));
  };
}

export const RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: SKI_ATTRIBUTION } },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

export function SkiAreaMap({ geojson, center, className }: { geojson: FeatureCollection | null; center: [number, number]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const open = useOpenSkiFeature();
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({ container: ref.current, style: RASTER_STYLE, center: [center[1], center[0]], zoom: 12, attributionControl: false });
    map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: SKI_ATTRIBUTION }));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    mapRef.current = map;
    map.on("load", () => {
      map.addSource("ski", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "ski-lines", type: "line", source: "ski", layout: { "line-cap": "round" }, paint: { "line-color": skiLineColor, "line-width": 3 } });
      map.addLayer({ id: "ski-hit", type: "line", source: "ski", paint: { "line-width": 12, "line-opacity": 0 } });
      map.on("click", "ski-hit", (e) => { const f = e.features?.[0]; if (f) openRef.current(f); });
      map.on("mouseenter", "ski-hit", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "ski-hit", () => { map.getCanvas().style.cursor = ""; });
    });
    return () => { map.remove(); mapRef.current = null; };
  }, [center]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource("ski") as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      const data = geojson ?? { type: "FeatureCollection" as const, features: [] };
      src.setData(data);
      const pts = data.features.flatMap((f) => geometryLines(f.geometry).flat());
      if (pts.length) {
        const b = new maplibregl.LngLatBounds(pts[0], pts[0]);
        pts.forEach((p) => b.extend(p));
        map.fitBounds(b, { padding: 30, maxZoom: 15, duration: 0 });
      }
    };
    if (map.getSource("ski")) apply(); else map.once("load", apply);
  }, [geojson]);

  return <div ref={ref} className={className} />;
}
