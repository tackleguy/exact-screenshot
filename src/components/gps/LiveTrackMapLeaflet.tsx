"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GpsPoint } from "@/lib/types";

interface LiveTrackMapProps {
  points: GpsPoint[];
  heading?: number | null;
  className?: string;
  /** The trail being followed, [lng, lat] lines, drawn under the live track. */
  trail?: [number, number][][];
}

export function LiveTrackMap({
  points,
  className = "",
  trail,
}: LiveTrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const startMarkerRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [39.8283, -98.5795],
      zoom: 14,
    });
    // Outdoor topo basemap (Esri World Topo Map) with trails, contours and relief.
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Basemap © Esri and its data providers",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      lineRef.current = null;
      userMarkerRef.current = null;
      startMarkerRef.current = null;
    };
  }, []);

  const pointsRef = useRef(points);
  // The trail being followed: drawn once, and the map starts on it before GPS has a fix.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trail?.length) return;
    const layer = L.layerGroup(trail.filter((l) => l.length > 1).flatMap((line) => {
      const latlngs = line.map(([lng, lat]) => [lat, lng] as L.LatLngExpression);
      return [L.polyline(latlngs, { color: "#ffffff", weight: 8, opacity: 0.85 }), L.polyline(latlngs, { color: "#d97706", weight: 4, opacity: 0.95, dashArray: "1 0" })];
    })).addTo(map);
    const bounds = L.latLngBounds(trail.flat().map(([lng, lat]) => [lat, lng] as L.LatLngTuple));
    if (bounds.isValid() && !pointsRef.current.length) map.fitBounds(bounds.pad(0.1));
    return () => { layer.remove(); };
  }, [trail]);

  useEffect(() => {
    pointsRef.current = points;
    const map = mapRef.current;
    if (!map || points.length === 0) return;

    const latlngs = points.map((p) => [p.lat, p.lng] as L.LatLngExpression);
    const last = points[points.length - 1];
    const first = points[0];

    if (lineRef.current) {
      lineRef.current.setLatLngs(latlngs);
    } else {
      lineRef.current = L.polyline(latlngs, {
        color: "#059669",
        weight: 4,
        opacity: 0.9,
      }).addTo(map);
    }

    if (!startMarkerRef.current) {
      startMarkerRef.current = L.circleMarker([first.lat, first.lng], {
        radius: 6,
        color: "#059669",
        weight: 2,
        fillColor: "#ffffff",
        fillOpacity: 1,
      }).addTo(map);
    } else {
      startMarkerRef.current.setLatLng([first.lat, first.lng]);
    }

    if (!userMarkerRef.current) {
      userMarkerRef.current = L.circleMarker([last.lat, last.lng], {
        radius: 8,
        color: "#ffffff",
        weight: 2,
        fillColor: "#059669",
        fillOpacity: 1,
      }).addTo(map);
    } else {
      userMarkerRef.current.setLatLng([last.lat, last.lng]);
    }

    map.setView([last.lat, last.lng], Math.max(map.getZoom(), 15));
    map.invalidateSize();
  }, [points]);

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-stone-800 ${className}`}
    >
      <div ref={containerRef} className="h-full w-full" />
      {points.length === 0 && !trail?.length && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-900/40 text-sm text-white">
          Map loads when GPS starts
        </div>
      )}
      {points.length > 0 && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg bg-black/50 px-2 py-1 text-[10px] font-medium text-white backdrop-blur">
          {points.length} pts · live track
        </div>
      )}
    </div>
  );
}
