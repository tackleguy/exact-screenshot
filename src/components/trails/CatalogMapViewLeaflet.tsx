"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { useRouter } from "next/navigation";
import "leaflet/dist/leaflet.css";
import type { CatalogTrail } from "@/lib/trail-catalog/types";

const NO_TRAILS: CatalogTrail[] = [];
const NO_LINES: [number, number][][] = [];
const NO_PINS: MapPin[] = [];

export interface MapPin {
  latitude: number;
  longitude: number;
  label: string;
  kind: "start" | "origin" | "option";
}

const tileUrl =
  process.env.NEXT_PUBLIC_CATALOG_TILE_URL ??
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const tileAttribution =
  process.env.NEXT_PUBLIC_CATALOG_TILE_ATTRIBUTION ??
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function CatalogMapView({
  trails = NO_TRAILS,
  lines = NO_LINES,
  route,
  pins = NO_PINS,
}: {
  trails?: CatalogTrail[];
  lines?: [number, number][][];
  /** Driving route to the start, [lng, lat] pairs; the map fits it when present. */
  route?: [number, number][];
  pins?: MapPin[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!container.current) return;

    const points = lines.flat();
    const center: L.LatLngExpression = points[0]
      ? [points[0][1], points[0][0]]
      : trails.length
        ? [trails[0].latitude, trails[0].longitude]
        : [45, -98];

    let map: L.Map;
    try {
      map = L.map(container.current, {
        center,
        zoom: points.length ? 12 : 4,
      });
      L.tileLayer(tileUrl, {
        attribution: tileAttribution,
        maxZoom: 19,
      }).addTo(map);
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }

    const bounds = L.latLngBounds([]);
    const markers: L.Marker[] = [];

    for (const line of lines) {
      if (line.length < 2) continue;
      const latlngs = line.map(([lon, lat]) => [lat, lon] as L.LatLngExpression);
      const poly = L.polyline(latlngs, {
        color: "#235834",
        weight: 4,
        opacity: 0.95,
      }).addTo(map);
      bounds.extend(poly.getBounds());
    }

    if (route && route.length > 1) {
      const poly = L.polyline(route.map(([lon, lat]) => [lat, lon] as L.LatLngExpression), {
        color: "#2563eb",
        weight: 5,
        opacity: 0.85,
        dashArray: "8 8",
      }).addTo(map);
      bounds.extend(poly.getBounds());
    }

    for (const pin of pins) {
      const marker = L.marker([pin.latitude, pin.longitude], {
        title: pin.label,
        icon: L.divIcon({
          className: "hikesync-leaflet-marker",
          html: `<span class="catalog-map-pin ${pin.kind}" aria-hidden="true"></span>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      });
      marker.bindTooltip(pin.label, { direction: "top" });
      marker.addTo(map);
      markers.push(marker);
      if (pin.kind !== "option") bounds.extend([pin.latitude, pin.longitude]);
    }

    for (const t of trails) {
      bounds.extend([t.latitude, t.longitude]);
      const marker = L.marker([t.latitude, t.longitude], {
        title: t.name,
        icon: L.divIcon({
          className: "hikesync-leaflet-marker",
          html: `<span class="catalog-map-dot" aria-hidden="true"></span>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      });
      marker.bindTooltip(t.name, { direction: "top" });
      marker.on("click", () => {
        router.push(`/explore/trails/${encodeURIComponent(t.id)}`);
      });
      marker.addTo(map);
      markers.push(marker);
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.12), { maxZoom: 17 });
    }

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      markers.forEach((m) => m.remove());
      map.remove();
    };
  }, [trails, lines, route, pins, router]);

  return (
    <div>
      <div
        ref={container}
        className="catalog-map-canvas"
        role="region"
        aria-label="Trail section map"
      />
      {failed && (
        <p role="status" className="catalog-muted">
          Some map content could not load. Check your connection or use the
          original source link for this trail.
        </p>
      )}
    </div>
  );
}
