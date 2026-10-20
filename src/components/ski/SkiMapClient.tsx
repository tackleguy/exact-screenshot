"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SkiArea, SkiFeatureSummary } from "@/lib/ski";
import type { MapMarker } from "@/lib/types";
import { MapView } from "@/components/map/MapView";
import { OpenTrailFeaturePanel } from "@/components/map/OpenTrailFeaturePanel";
import { SkiFeaturePanel } from "@/components/map/SkiFeaturePanel";
import { LocationPermissionPrompt } from "@/components/gps/LocationPermissionPrompt";
import { useLocationPermission } from "@/components/gps/useLocationPermission";
import type { OpenTrailFeatureSummary } from "@/lib/opentrailmap";

export function SkiMapClient() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkiArea[]>([]);
  const [selectedFeature, setSelectedFeature] =
    useState<SkiFeatureSummary | null>(null);
  const [selectedOpenTrail, setSelectedOpenTrail] =
    useState<OpenTrailFeatureSummary | null>(null);
  const [mapFocus, setMapFocus] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const trimmedQuery = query.trim();
  const location = useLocationPermission();

  const handleRequestLocation = useCallback(async () => {
    const coords = await location.requestLocation();
    if (coords) {
      setMapFocus({ lat: coords.lat, lng: coords.lng, zoom: 11 });
    }
  }, [location]);

  const flyToArea = useCallback((area: SkiArea) => {
    setMapFocus({ lat: area.lat, lng: area.lng, zoom: 12 });
    setSelectedOpenTrail(null);
    setSelectedFeature({
      id: area.id,
      name: area.name,
      type: "skiArea",
      lat: area.lat,
      lng: area.lng,
      runs_count: area.runs_count,
      lifts_count: area.lifts_count,
      activities: area.activities,
    });
  }, []);

  useEffect(() => {
    if (!trimmedQuery) return;

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/ski/nearby?q=${encodeURIComponent(trimmedQuery)}&limit=20`,
        );
        const data = await res.json();
        const areas: SkiArea[] = data.areas ?? [];
        setResults(areas);
        if (areas.length === 1) flyToArea(areas[0]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [trimmedQuery, flyToArea]);

  useEffect(() => {
    const areaId = searchParams.get("area");
    if (!areaId) return;

    fetch(`/api/ski/nearby?id=${encodeURIComponent(areaId)}`)
      .then((r) => r.json())
      .then((data) => {
        const match = (data.areas ?? []).find(
          (a: SkiArea) => a.id === areaId,
        );
        if (match) flyToArea(match);
      })
      .catch(() => {});
  }, [searchParams, flyToArea]);

  const markers = useMemo((): MapMarker[] => {
    return results.map((area) => ({
      id: area.id,
      type: "resort" as const,
      name: area.name,
      latitude: area.lat,
      longitude: area.lng,
      subtitle: area.region,
      href: `/explore/ski?area=${area.id}`,
    }));
  }, [results]);

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[480px] flex-col md:h-[calc(100dvh-4.5rem)]">
      <div className="shrink-0 border-b border-[var(--border)] bg-surface-elevated px-4 py-3">
        <p className="section-label">Explore · Ski</p>
        <h1 className="font-display text-xl font-semibold text-cream">
          Nordic ski trails
        </h1>
        <p className="mt-1 text-xs text-mist">
          Zoom in for OpenStreetMap nordic ski trails. Search a resort to fly
          there, or{" "}
          <Link
            href="/explore/trails?activity=ski&includeWinter=true"
            className="font-semibold text-accent"
          >
            browse catalog ski trails
          </Link>
          .
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => {
              const value = e.target.value;
              setQuery(value);
              if (!value.trim()) setResults([]);
            }}
            placeholder="Search resorts (e.g. Vail, Aspen)..."
            className="flex-1 rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-muted px-4 py-2.5 text-sm text-cream outline-none placeholder:text-mist focus:border-accent/40"
          />
          {loading && (
            <span className="self-center text-xs text-stone-400">
              Searching…
            </span>
          )}
        </div>
        {trimmedQuery && results.length > 0 && (
          <ul className="mt-2 max-h-32 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-muted">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => flyToArea(r)}
                  className="w-full px-4 py-2 text-left text-sm text-cream hover:bg-surface-elevated"
                >
                  <span className="font-medium">{r.name}</span>
                  {r.region && (
                    <span className="ml-2 text-mist">{r.region}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {(location.needsPrompt || location.permission === "denied") && (
          <div className="absolute inset-x-0 top-2 z-20 px-3">
            <LocationPermissionPrompt
              permission={location.permission}
              loading={location.loading}
              error={location.error}
              onRequest={handleRequestLocation}
              compact
            />
          </div>
        )}
        <MapView
          mode="ski"
          markers={markers}
          className="h-full w-full rounded-none"
          geolocate
          fitToMarkers={markers.length > 0 && !mapFocus}
          focus={mapFocus}
          onGeolocate={(lat, lng) =>
            setMapFocus({ lat, lng, zoom: 11 })
          }
          onOpenTrailFeatureClick={(feature) => {
            setSelectedOpenTrail(feature);
            setSelectedFeature(null);
            setMapFocus({ lat: feature.lat, lng: feature.lng, zoom: 14 });
          }}
          onMarkerClick={(marker) => {
            const area = results.find((r) => r.id === marker.id);
            if (area) flyToArea(area);
          }}
        />

        {selectedFeature && (
          <div className="absolute bottom-4 left-4 right-4 z-20 md:left-auto md:w-96">
            <SkiFeaturePanel
              feature={selectedFeature}
              onClose={() => setSelectedFeature(null)}
            />
          </div>
        )}

        {selectedOpenTrail && (
          <div className="absolute bottom-4 left-4 right-4 z-20 md:left-auto md:w-96">
            <OpenTrailFeaturePanel
              feature={selectedOpenTrail}
              mode="ski"
              onClose={() => setSelectedOpenTrail(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
