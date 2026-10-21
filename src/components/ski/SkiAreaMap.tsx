"use client";

import { useEffect, useRef } from "react";
import type { FeatureCollection, Geometry, LineString, MultiLineString } from "geojson";

interface SkiAreaMapProps {
  geojson: FeatureCollection | null;
  center: [number, number]; // [lat, lng]
  className?: string;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  novice: "#6ee7b7",
  easy: "#34d399",
  intermediate: "#60a5fa",
  advanced: "#f472b6",
  expert: "#ef4444",
  freeride: "#a78bfa",
  extreme: "#dc2626",
};

function lineColor(properties: Record<string, unknown> | null): string {
  const difficulty = typeof properties?.difficulty === "string" ? properties.difficulty.toLowerCase() : "";
  return DIFFICULTY_COLORS[difficulty] ?? "#a8df8e";
}

function geometryLines(geometry: Geometry): [number, number][][] {
  if (geometry.type === "LineString") return [(geometry as LineString).coordinates as [number, number][]];
  if (geometry.type === "MultiLineString") return (geometry as MultiLineString).coordinates as [number, number][][];
  return [];
}

export function SkiAreaMap({ geojson, center, className = "" }: SkiAreaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let map: import("leaflet").Map | null = null;

    (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css" as string).catch(() => undefined);
      if (disposed || !containerRef.current) return;

      map = L.map(containerRef.current, {
        center,
        zoom: 12,
        attributionControl: true,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

      const bounds: [number, number][] = [];
      for (const feature of geojson?.features ?? []) {
        if (!feature.geometry) continue;
        const color = lineColor(feature.properties as Record<string, unknown> | null);
        for (const line of geometryLines(feature.geometry)) {
          if (line.length < 2) continue;
          const latlngs = line.map(([lng, lat]) => [lat, lng] as [number, number]);
          bounds.push(...latlngs);
          const name = feature.properties?.name;
          const polyline = L.polyline(latlngs, { color, weight: 2.5, opacity: 0.85 });
          if (typeof name === "string" && name) polyline.bindTooltip(name);
          polyline.addTo(map);
        }
      }

      if (bounds.length > 1) {
        map.fitBounds(L.latLngBounds(bounds).pad(0.1), { maxZoom: 15 });
      } else {
        L.marker(center).addTo(map);
        map.setView(center, 13);
      }
      map.invalidateSize();
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [geojson, center]);

  return <div ref={containerRef} className={`bg-surface-muted ${className}`} />;
}
