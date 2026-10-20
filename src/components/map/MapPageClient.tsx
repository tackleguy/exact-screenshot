"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoLineString, MapMarker, MapMode } from "@/lib/types";
import type { SkiArea, SkiFeatureSummary } from "@/lib/ski";
import type { CatalogMapPoint, CatalogMapResult, CatalogTrail } from "@/lib/trail-catalog/types";
import { displayMiles, sourceName, countryName } from "@/lib/trail-catalog/types";
import { MapView, type MapPopupInfo } from "@/components/map/MapView";
import { ModeSwitcher } from "@/components/map/ModeSwitcher";
import { OpenTrailFeaturePanel } from "@/components/map/OpenTrailFeaturePanel";
import { SkiFeaturePanel } from "@/components/map/SkiFeaturePanel";
import { LocationPermissionPrompt } from "@/components/gps/LocationPermissionPrompt";
import { useLocationPermission } from "@/components/gps/useLocationPermission";
import type { OpenTrailFeatureSummary } from "@/lib/opentrailmap";
import {
  activityForTrail,
  formatDistanceAway,
  haversineKm,
  recordUrl,
} from "@/lib/map";
import { resolveDifficulty } from "@/lib/trail-difficulty";

type NearbySkiArea = SkiArea & { distance_km?: number };

interface MapFilters {
  country: "" | "US" | "CA" | "intl";
  kind: "" | "route" | "segment";
  difficulty: string;
  minMiles: string;
  maxMiles: string;
  showParks: boolean;
  includeWinter: boolean;
}

const EMPTY_FILTERS: MapFilters = {
  country: "",
  kind: "",
  difficulty: "",
  minMiles: "",
  maxMiles: "",
  showParks: false,
  includeWinter: false,
};

interface MapPageClientProps {
  markers: MapMarker[];
  catalogMap: CatalogMapResult | null;
}

function catalogMarkers(points: CatalogMapPoint[]): MapMarker[] {
  return points.map((point) => {
    if (point.trail) {
      return {
        id: point.trail.id,
        type: "trail" as const,
        name: point.trail.name,
        latitude: point.latitude,
        longitude: point.longitude,
        subtitle: [
          point.trail.region,
          displayMiles(point.trail.miles),
          sourceName(point.trail.source),
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/explore/trails?q=${encodeURIComponent(point.trail.name)}`,
      };
    }
    return {
      id: point.id,
      type: "trail" as const,
      name: `${point.count.toLocaleString()} trails`,
      latitude: point.latitude,
      longitude: point.longitude,
      subtitle: "Zoom in to see individual sections",
      href: "/explore/trails",
      clusterCount: point.count,
    };
  });
}

function trailPopup(trail: CatalogTrail): MapPopupInfo {
  const difficulty = resolveDifficulty({
    reported: trail.difficulty,
    miles: trail.miles,
    name: trail.name,
  });
  const rows = [
    { label: "Difficulty", value: `${difficulty.difficulty} · ${difficulty.label}` },
    { label: "Distance", value: displayMiles(trail.miles) },
    {
      label: "Location",
      value: [trail.region, countryName(trail.country)].filter(Boolean).join(", "),
    },
    { label: "Source", value: sourceName(trail.source) },
  ];
  if (trail.kind === "route") {
    rows.unshift({ label: "Type", value: "Through-hike" });
  }
  if (trail.surface) rows.push({ label: "Surface", value: trail.surface });
  if (trail.manager) rows.push({ label: "Manager", value: trail.manager });

  return {
    longitude: trail.longitude,
    latitude: trail.latitude,
    title: trail.name,
    rows,
    primaryHref: recordUrl(activityForTrail(difficulty.difficulty), {
      trailId: trail.id,
    }),
    primaryLabel: "Record",
    secondaryHref: `/explore/trails/${trail.id}`,
    secondaryLabel: "Explore",
  };
}

function filterQuery(filters: MapFilters): string {
  const params = new URLSearchParams();
  if (filters.country) params.set("country", filters.country);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.difficulty) params.set("difficulty", filters.difficulty);
  if (filters.minMiles) params.set("minMiles", filters.minMiles);
  if (filters.maxMiles) params.set("maxMiles", filters.maxMiles);
  if (filters.includeWinter) params.set("includeWinter", "true");
  const qs = params.toString();
  return qs ? `&${qs}` : "";
}

export function MapPageClient({
  markers: initialMarkers,
  catalogMap: initialCatalog,
}: MapPageClientProps) {
  const [mode, setMode] = useState<MapMode>("trail");
  const [filters, setFilters] = useState<MapFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [explicitLocation, setUserLoc] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [catalog, setCatalog] = useState<CatalogMapResult | null>(initialCatalog);
  const [nearbySkiAreas, setNearbySkiAreas] = useState<NearbySkiArea[]>([]);
  const [selectedTrail, setSelectedTrail] = useState<CatalogTrail | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<GeoLineString | null>(null);
  const [selectedSkiFeature, setSelectedSkiFeature] =
    useState<SkiFeatureSummary | null>(null);
  const [selectedOpenTrail, setSelectedOpenTrail] =
    useState<OpenTrailFeatureSummary | null>(null);
  const [mapFocus, setMapFocus] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
  } | null>(null);
  const [trailLabel, setTrailLabel] = useState<string | null>(
    initialCatalog
      ? `${initialCatalog.total.toLocaleString()} hiking trails across Canada & the U.S.`
      : null,
  );
  const [nearbyLabel, setNearbyLabel] = useState<string | null>(null);
  const location = useLocationPermission();
  const userLoc = explicitLocation ?? location.coords;
  const boundsAbort = useRef<AbortController | null>(null);
  const geometryAbort = useRef<AbortController | null>(null);
  const lastBounds = useRef<{
    west: number;
    south: number;
    east: number;
    north: number;
  } | null>(null);
  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const resolvedFocus = useMemo(
    () =>
      mapFocus ??
      (location.coords ? { ...location.coords, zoom: 11 } : null),
    [mapFocus, location.coords],
  );

  const activeFilterCount = [
    filters.country,
    filters.kind,
    filters.difficulty,
    filters.minMiles,
    filters.maxMiles,
    filters.showParks,
    filters.includeWinter,
  ].filter(Boolean).length;

  const onGeolocate = useCallback((lat: number, lng: number) => {
    setUserLoc({ lat, lng });
  }, []);

  const handleRequestLocation = useCallback(async () => {
    const coords = await location.requestLocation();
    if (coords) {
      setUserLoc(coords);
      setMapFocus({ lat: coords.lat, lng: coords.lng, zoom: 11 });
    }
  }, [location]);

  const loadCatalogForBounds = useCallback(
    (
      bounds: { west: number; south: number; east: number; north: number },
      nextFilters: MapFilters = filtersRef.current,
    ) => {
      lastBounds.current = bounds;
      boundsAbort.current?.abort();
      const controller = new AbortController();
      boundsAbort.current = controller;
      const bbox = [bounds.west, bounds.south, bounds.east, bounds.north]
        .map((n) => n.toFixed(5))
        .join(",");

      void fetch(`/api/trail-catalog/map?bbox=${bbox}${filterQuery(nextFilters)}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("catalog map failed");
          return response.json() as Promise<CatalogMapResult>;
        })
        .then((data) => {
          setCatalog(data);
          setTrailLabel(
            data.total > 0
              ? `${data.total.toLocaleString()} hiking trails in this view`
              : "No hiking trails in this view — pan, zoom, or clear filters",
          );
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setTrailLabel("Trail sections could not refresh — try moving the map");
        });
    },
    [],
  );

  useEffect(() => {
    if (mode !== "trail") return;
    if (lastBounds.current) {
      loadCatalogForBounds(lastBounds.current, filters);
      return;
    }
    const params = new URLSearchParams();
    if (filters.country) params.set("country", filters.country);
    if (filters.kind) params.set("kind", filters.kind);
    if (filters.difficulty) params.set("difficulty", filters.difficulty);
    if (filters.minMiles) params.set("minMiles", filters.minMiles);
    if (filters.maxMiles) params.set("maxMiles", filters.maxMiles);
    if (filters.includeWinter) params.set("includeWinter", "true");
    const qs = params.toString();
    void fetch(`/api/trail-catalog/map${qs ? `?${qs}` : ""}`)
      .then((r) => r.json())
      .then((data: CatalogMapResult) => {
        setCatalog(data);
        setTrailLabel(
          `${data.total.toLocaleString()} hiking trails across Canada & the U.S.`,
        );
      })
      .catch(() => undefined);
  }, [filters, mode, loadCatalogForBounds]);

  useEffect(() => {
    if (mode !== "ski" || !userLoc) return;

    fetch(
      `/api/ski/nearby?lat=${userLoc.lat}&lng=${userLoc.lng}&radius=150&limit=30`,
    )
      .then((r) => r.json())
      .then((data) => {
        const areas: NearbySkiArea[] = data.areas ?? [];
        setNearbySkiAreas(areas);
        setNearbyLabel(
          areas.length > 0
            ? `${areas.length} ski areas near you`
            : "Enable location to find nearby ski areas",
        );
      })
      .catch(() => setNearbyLabel(null));
  }, [mode, userLoc]);

  const handleModeChange = (next: MapMode) => {
    setMode(next);
    setSelectedTrail(null);
    setSelectedRoute(null);
    setSelectedSkiFeature(null);
    setSelectedOpenTrail(null);
    setMapFocus(null);
  };

  const markers = useMemo((): MapMarker[] => {
    if (mode !== "trail") {
      return nearbySkiAreas.map((area) => ({
        id: area.id,
        type: "resort" as const,
        name: area.name,
        latitude: area.lat,
        longitude: area.lng,
        subtitle:
          area.distance_km != null
            ? formatDistanceAway(area.distance_km)
            : undefined,
        href: `/explore/ski`,
      }));
    }

    const parks = filters.showParks
      ? initialMarkers.filter((m) => m.type === "park")
      : [];
    return [...parks, ...catalogMarkers(catalog?.points ?? [])];
  }, [mode, nearbySkiAreas, initialMarkers, catalog, filters.showParks]);

  const routes = useMemo(
    () => (mode === "trail" && selectedRoute ? [selectedRoute] : []),
    [mode, selectedRoute],
  );

  const popup = useMemo(
    () => (selectedTrail ? trailPopup(selectedTrail) : null),
    [selectedTrail],
  );

  const skiFeatureDistance =
    selectedSkiFeature && userLoc
      ? haversineKm(
          userLoc.lat,
          userLoc.lng,
          selectedSkiFeature.lat,
          selectedSkiFeature.lng,
        )
      : undefined;

  const openCatalogTrail = useCallback((trail: CatalogTrail) => {
    geometryAbort.current?.abort();
    const controller = new AbortController();
    geometryAbort.current = controller;
    setSelectedTrail(trail);
    setSelectedRoute(null);
    setMapFocus({ lat: trail.latitude, lng: trail.longitude, zoom: 13 });

    void fetch(`/api/trail-catalog/${encodeURIComponent(trail.id)}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("geometry unavailable");
        return response.json() as Promise<{ lines: [number, number][][] }>;
      })
      .then((data) => {
        const line = data.lines?.[0];
        if (!line?.length) return;
        setSelectedRoute({
          type: "LineString",
          coordinates: line.map(([lng, lat]) => [lng, lat]),
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-cream">
            Adventure Map
          </h1>
          <p className="mt-1 text-sm text-mist">
            {mode === "ski"
              ? (nearbyLabel ?? "Ski areas — drag to rotate satellite · 3D available")
              : (trailLabel ??
                "Hiking sections — tap a pin for difficulty and stats")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {mode === "trail" && (
            <button
              type="button"
              className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface px-3 py-2 text-sm font-semibold text-cream"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
            </button>
          )}
          <ModeSwitcher mode={mode} onChange={handleModeChange} />
        </div>
      </div>

      {mode === "trail" && filtersOpen && (
        <form
          className="surface-card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-cream">Country</span>
            <select
              className="rounded-[var(--radius-lg)] border border-[var(--control-border)] bg-surface-muted px-3 py-2 text-cream"
              value={filters.country}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  country: event.target.value as MapFilters["country"],
                }))
              }
            >
              <option value="">All countries</option>
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="intl">International</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-cream">Type</span>
            <select
              className="rounded-[var(--radius-lg)] border border-[var(--control-border)] bg-surface-muted px-3 py-2 text-cream"
              value={filters.kind}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  kind: event.target.value as MapFilters["kind"],
                }))
              }
            >
              <option value="">Routes & sections</option>
              <option value="route">Through-hikes</option>
              <option value="segment">Sections</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-cream">Difficulty</span>
            <select
              className="rounded-[var(--radius-lg)] border border-[var(--control-border)] bg-surface-muted px-3 py-2 text-cream"
              value={filters.difficulty}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  difficulty: event.target.value,
                }))
              }
            >
              <option value="">Any</option>
              <option value="easy">Easy</option>
              <option value="moderate">Moderate</option>
              <option value="hard">Hard</option>
              <option value="expert">Expert</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-cream">Min miles</span>
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder="Any"
              className="rounded-[var(--radius-lg)] border border-[var(--control-border)] bg-surface-muted px-3 py-2 text-cream"
              value={filters.minMiles}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  minMiles: event.target.value,
                }))
              }
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-cream">Max miles</span>
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder="Any"
              className="rounded-[var(--radius-lg)] border border-[var(--control-border)] bg-surface-muted px-3 py-2 text-cream"
              value={filters.maxMiles}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  maxMiles: event.target.value,
                }))
              }
            />
          </label>
          <div className="grid gap-2 self-end text-sm">
            <label className="flex items-center gap-2 text-cream">
              <input
                type="checkbox"
                checked={filters.showParks}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    showParks: event.target.checked,
                  }))
                }
              />
              Show parks
            </label>
            <label className="flex items-center gap-2 text-cream">
              <input
                type="checkbox"
                checked={filters.includeWinter}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    includeWinter: event.target.checked,
                  }))
                }
              />
              Include ski / snow routes
            </label>
            <button
              type="button"
              className="justify-self-start text-sm font-semibold text-accent"
              onClick={() => setFilters(EMPTY_FILTERS)}
            >
              Clear filters
            </button>
          </div>
        </form>
      )}

      {mode === "ski" && nearbySkiAreas.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {nearbySkiAreas.slice(0, 6).map((area) => (
            <button
              key={area.id}
              type="button"
              onClick={() => {
                setMapFocus({ lat: area.lat, lng: area.lng, zoom: 12 });
                setSelectedSkiFeature({
                  id: area.id,
                  name: area.name,
                  type: "skiArea",
                  lat: area.lat,
                  lng: area.lng,
                  runs_count: area.runs_count,
                  lifts_count: area.lifts_count,
                  activities: area.activities,
                });
              }}
              className="shrink-0 rounded-lg border border-[var(--border)] bg-surface px-3 py-1.5 text-xs font-semibold text-cream"
            >
              {area.name}
              {area.distance_km != null && (
                <span className="ml-1 text-mist">
                  · {formatDistanceAway(area.distance_km)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {(location.needsPrompt || location.permission === "denied") && (
        <LocationPermissionPrompt
          permission={location.permission}
          loading={location.loading}
          error={location.error}
          onRequest={handleRequestLocation}
        />
      )}

      <MapView
        key={mode}
        mode={mode}
        markers={markers}
        routes={routes}
        popup={popup}
        className="h-[calc(100vh-240px)] min-h-[420px]"
        geolocate
        fitToMarkers={mode === "trail" && !userLoc && !catalog}
        fitToRoutes={Boolean(selectedRoute)}
        focus={resolvedFocus}
        onGeolocate={onGeolocate}
        onPopupClose={() => {
          setSelectedTrail(null);
          setSelectedRoute(null);
        }}
        onBoundsChange={mode === "trail" ? loadCatalogForBounds : undefined}
        onOpenTrailFeatureClick={(feature) => {
          setSelectedOpenTrail(feature);
          setSelectedSkiFeature(null);
          setSelectedTrail(null);
          setSelectedRoute(null);
          setMapFocus({ lat: feature.lat, lng: feature.lng, zoom: 14 });
        }}
        onMarkerClick={(marker) => {
          if (marker.type === "park") {
            window.location.href = marker.href;
            return;
          }
          if (marker.type === "resort") {
            setMapFocus({
              lat: marker.latitude,
              lng: marker.longitude,
              zoom: 12,
            });
            setSelectedSkiFeature({
              id: marker.id,
              name: marker.name,
              type: "skiArea",
              lat: marker.latitude,
              lng: marker.longitude,
            });
            setSelectedOpenTrail(null);
            setSelectedTrail(null);
            setSelectedRoute(null);
            return;
          }

          const point = catalog?.points.find((p) => p.id === marker.id);
          if (point?.bounds) {
            setMapFocus({
              lat: (point.bounds[1] + point.bounds[3]) / 2,
              lng: ((point.bounds[0] + point.bounds[2]) / 2 + 540) % 360 - 180,
              zoom: 9,
            });
            setSelectedTrail(null);
            setSelectedRoute(null);
            setSelectedOpenTrail(null);
            return;
          }
          if (point?.trail) {
            openCatalogTrail(point.trail);
            return;
          }
          setMapFocus({
            lat: marker.latitude,
            lng: marker.longitude,
            zoom: 13,
          });
        }}
      />

      {mode === "ski" && selectedSkiFeature && (
        <SkiFeaturePanel
          feature={selectedSkiFeature}
          distanceKm={skiFeatureDistance}
          onClose={() => setSelectedSkiFeature(null)}
        />
      )}

      {selectedOpenTrail && (
        <OpenTrailFeaturePanel
          feature={selectedOpenTrail}
          mode={mode === "ski" ? "ski" : "trail"}
          onClose={() => setSelectedOpenTrail(null)}
        />
      )}

      {mode === "trail" && (
        <p className="text-xs text-mist">
          Right-drag or two-finger twist to rotate (works on satellite). Compass resets north.
          Ski and snowmobile-named sections stay hidden unless you enable them in Filters.{" "}
          <Link href="/explore/trails" className="font-semibold text-accent">
            Browse the trail list
          </Link>
        </p>
      )}

      {mode === "ski" && (
        <p className="text-xs text-mist">
          Zoom in to see nordic ski trails from OpenStreetMap. Tap a path for
          details, or{" "}
          <Link
            href="/explore/trails?activity=ski&includeWinter=true"
            className="font-semibold text-accent"
          >
            browse catalog ski sections
          </Link>
          .
        </p>
      )}
    </div>
  );
}
