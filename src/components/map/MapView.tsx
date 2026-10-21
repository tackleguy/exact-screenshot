"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "@/lib/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapMarker, MapMode, GeoLineString } from "@/lib/types";
import type { SkiFeatureSummary } from "@/lib/ski";
import {
  isOpenTrailMapClickableLayer,
  loadMapStyle,
  openTrailFeatureFromProperties,
  type OpenTrailFeatureSummary,
} from "@/lib/opentrailmap";
import clsx from "clsx";

export type MapBasemap = "map" | "satellite" | "hybrid";

export interface MapPopupInfo {
  longitude: number;
  latitude: number;
  title: string;
  rows: { label: string; value: string }[];
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}

const DEFAULT_CENTER: [number, number] = [-98.5795, 39.8283];
const DEFAULT_ZOOM = 4;

const ESRI_SAT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_LABELS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const ESRI_ROADS =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";
const TERRARIUM_DEM =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

const TERRAIN_SOURCE: maplibregl.RasterDEMSourceSpecification = {
  type: "raster-dem",
  tiles: [TERRARIUM_DEM],
  encoding: "terrarium",
  tileSize: 256,
  maxzoom: 15,
  attribution: "© Mapzen / AWS Terrain Tiles",
};

function buildRasterStyle(basemap: Exclude<MapBasemap, "map">): maplibregl.StyleSpecification {
  const sources: maplibregl.StyleSpecification["sources"] = {
    terrain: TERRAIN_SOURCE,
    satellite: {
      type: "raster",
      tiles: [ESRI_SAT],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics",
    },
  };
  const layers: maplibregl.LayerSpecification[] = [
    { id: "satellite", type: "raster", source: "satellite" },
  ];

  if (basemap === "hybrid") {
    sources.roads = {
      type: "raster",
      tiles: [ESRI_ROADS],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© Esri",
    };
    sources.labels = {
      type: "raster",
      tiles: [ESRI_LABELS],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© Esri",
    };
    layers.push({ id: "roads", type: "raster", source: "roads" });
    layers.push({ id: "labels", type: "raster", source: "labels" });
  }

  layers.push({
    id: "hillshade",
    type: "hillshade",
    source: "terrain",
    layout: { visibility: "none" },
    paint: {
      "hillshade-exaggeration": 0.45,
      "hillshade-shadow-color": "#1a1a1a",
      "hillshade-highlight-color": "#ffffff",
    },
  });

  return { version: 8, sources, layers };
}

/** Clone OTM style and inject Terrarium DEM so 3D terrain works without mutating the cache. */
function withTerrainSource(
  style: maplibregl.StyleSpecification,
): maplibregl.StyleSpecification {
  if (style.sources?.terrain) return style;
  return {
    ...style,
    sources: {
      ...style.sources,
      terrain: TERRAIN_SOURCE,
    },
  };
}

function popupHtml(info: MapPopupInfo): string {
  const rows = info.rows
    .map(
      (row) =>
        `<div class="hs-popup-row"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`,
    )
    .join("");
  const actions = [
    info.primaryHref && info.primaryLabel
      ? `<a class="hs-popup-primary" href="${escapeAttr(info.primaryHref)}">${escapeHtml(info.primaryLabel)}</a>`
      : "",
    info.secondaryHref && info.secondaryLabel
      ? `<a class="hs-popup-secondary" href="${escapeAttr(info.secondaryHref)}">${escapeHtml(info.secondaryLabel)}</a>`
      : "",
  ]
    .filter(Boolean)
    .join("");
  return `<div class="hs-popup"><p class="hs-popup-title">${escapeHtml(info.title)}</p>${rows}${actions ? `<div class="hs-popup-actions">${actions}</div>` : ""}</div>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value: string) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

interface MapViewProps {
  mode: MapMode;
  markers?: MapMarker[];
  routes?: GeoLineString[];
  center?: [number, number];
  zoom?: number;
  className?: string;
  geolocate?: boolean;
  fitToMarkers?: boolean;
  fitToRoutes?: boolean;
  focus?: { lat: number; lng: number; zoom?: number } | null;
  popup?: MapPopupInfo | null;
  showBasemapControls?: boolean;
  onMarkerClick?: (marker: MapMarker) => void;
  onGeolocate?: (lat: number, lng: number) => void;
  onBoundsChange?: (bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  }) => void;
  onPopupClose?: () => void;
  onSkiFeatureClick?: (feature: SkiFeatureSummary) => void;
  onOpenTrailFeatureClick?: (feature: OpenTrailFeatureSummary) => void;
}

export function MapView({
  mode,
  markers = [],
  routes = [],
  center,
  zoom,
  className,
  geolocate = false,
  fitToMarkers = true,
  fitToRoutes = true,
  focus,
  popup = null,
  showBasemapControls = true,
  onMarkerClick,
  onGeolocate,
  onBoundsChange,
  onPopupClose,
  onSkiFeatureClick,
  onOpenTrailFeatureClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const layerHandlersRef = useRef<
    Array<{
      layerId: string;
      onClick: (e: maplibregl.MapLayerMouseEvent) => void;
      onEnter: () => void;
      onLeave: () => void;
    }>
  >([]);
  const onMarkerClickRef = useRef(onMarkerClick);
  const onGeolocateRef = useRef(onGeolocate);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const onPopupCloseRef = useRef(onPopupClose);
  const onOpenTrailFeatureClickRef = useRef(onOpenTrailFeatureClick);
  const onSkiFeatureClickRef = useRef(onSkiFeatureClick);
  const [mapError, setMapError] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<MapBasemap>("map");
  const [is3d, setIs3d] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [ready, setReady] = useState(false);
  const [styleKind, setStyleKind] = useState<"opentrailmap" | "raster">("opentrailmap");

  const mapCenter = center ?? DEFAULT_CENTER;
  const mapZoom = zoom ?? DEFAULT_ZOOM;

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
  }, [onMarkerClick]);
  useEffect(() => {
    onGeolocateRef.current = onGeolocate;
  }, [onGeolocate]);
  useEffect(() => {
    onBoundsChangeRef.current = onBoundsChange;
  }, [onBoundsChange]);
  useEffect(() => {
    onPopupCloseRef.current = onPopupClose;
  }, [onPopupClose]);
  useEffect(() => {
    onOpenTrailFeatureClickRef.current = onOpenTrailFeatureClick;
  }, [onOpenTrailFeatureClick]);
  useEffect(() => {
    onSkiFeatureClickRef.current = onSkiFeatureClick;
  }, [onSkiFeatureClick]);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    setMapError(null);
    setReady(false);

    const clearLayerHandlers = (map: maplibregl.Map) => {
      for (const { layerId, onClick, onEnter, onLeave } of layerHandlersRef.current) {
        map.off("click", layerId, onClick);
        map.off("mouseenter", layerId, onEnter);
        map.off("mouseleave", layerId, onLeave);
      }
      layerHandlersRef.current = [];
    };

    const attachTrailHandlers = (map: maplibregl.Map) => {
      clearLayerHandlers(map);

      const layers = map.getStyle()?.layers ?? [];
      const clickableLayers = layers
        .filter((layer) => isOpenTrailMapClickableLayer(layer.id))
        .map((layer) => layer.id)
        .reverse();

      for (const layerId of clickableLayers) {
        const onClick = (e: maplibregl.MapLayerMouseEvent) => {
          const props = e.features?.[0]?.properties as
            | Record<string, unknown>
            | undefined;
          const lngLat = e.lngLat;
          if (!props || !lngLat) return;

          const feature = openTrailFeatureFromProperties(
            props,
            lngLat.lat,
            lngLat.lng,
          );
          if (feature) {
            onOpenTrailFeatureClickRef.current?.(feature);
          }
        };

        const onEnter = () => {
          map.getCanvas().style.cursor = "pointer";
        };
        const onLeave = () => {
          map.getCanvas().style.cursor = "";
        };

        map.on("click", layerId, onClick);
        map.on("mouseenter", layerId, onEnter);
        map.on("mouseleave", layerId, onLeave);
        layerHandlersRef.current.push({ layerId, onClick, onEnter, onLeave });
      }
    };

    async function initMap() {
      try {
        let style: maplibregl.StyleSpecification | string;
        let nextKind: "opentrailmap" | "raster" = "raster";

        if (basemap === "map") {
          const loaded = await loadMapStyle(mode);
          if (cancelled || !containerRef.current) return;
          style =
            typeof loaded.style === "string"
              ? loaded.style
              : withTerrainSource(loaded.style);
          nextKind = loaded.source === "opentrailmap" ? "opentrailmap" : "raster";
        } else {
          style = buildRasterStyle(basemap);
        }

        if (cancelled || !containerRef.current) return;
        setStyleKind(nextKind);

        const map = new maplibregl.Map({
          container: containerRef.current,
          style,
          center: mapCenter,
          zoom: mapZoom,
          pitch: 0,
          bearing: 0,
          attributionControl: false,
          maxPitch: 85,
          dragRotate: true,
          touchPitch: true,
          pitchWithRotate: true,
          touchZoomRotate: true,
        });

        map.addControl(
          new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
          "top-right",
        );
        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

        if (geolocate) {
          const geo = new maplibregl.GeolocateControl({
            positionOptions: {
              enableHighAccuracy: true,
              maximumAge: 0,
              timeout: 15000,
            },
            trackUserLocation: true,
            showUserLocation: true,
            showAccuracyCircle: true,
          });
          map.addControl(geo, "top-right");
          geo.on("geolocate", (e) => {
            onGeolocateRef.current?.(e.coords.latitude, e.coords.longitude);
          });
        }

        map.on("style.load", () => {
          if (cancelled) return;
          if (nextKind === "opentrailmap") attachTrailHandlers(map);
        });

        map.on("load", () => {
          if (cancelled) return;
          mapRef.current = map;
          setReady(true);
          const b = map.getBounds();
          onBoundsChangeRef.current?.({
            west: b.getWest(),
            south: b.getSouth(),
            east: b.getEast(),
            north: b.getNorth(),
          });
        });
        map.on("error", (e) => {
          const msg = e.error?.message ?? "";
          if (msg && !msg.includes("Failed to fetch")) setMapError(msg);
        });
        map.on("rotate", () => setBearing(map.getBearing()));
        map.on("pitch", () => setBearing(map.getBearing()));

        let boundsTimer: ReturnType<typeof setTimeout> | undefined;
        const emitBounds = () => {
          const b = map.getBounds();
          onBoundsChangeRef.current?.({
            west: b.getWest(),
            south: b.getSouth(),
            east: b.getEast(),
            north: b.getNorth(),
          });
        };
        map.on("moveend", () => {
          clearTimeout(boundsTimer);
          boundsTimer = setTimeout(emitBounds, 280);
        });

        const ro = new ResizeObserver(() => map.resize());
        ro.observe(containerRef.current);

        return () => {
          cancelled = true;
          clearTimeout(boundsTimer);
          ro.disconnect();
          clearLayerHandlers(map);
          popupRef.current?.remove();
          popupRef.current = null;
          markersRef.current.forEach((m) => m.remove());
          markersRef.current = [];
          map.remove();
          mapRef.current = null;
          setReady(false);
        };
      } catch (err) {
        if (!cancelled) {
          setMapError(
            err instanceof Error ? err.message : "Failed to load map style",
          );
        }
      }
    }

    let cleanup: (() => void) | undefined;
    void initMap().then((fn) => {
      cleanup = fn;
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, geolocate, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const apply = () => {
      if (is3d) {
        // Raster styles use a dedicated hillshade layer; OTM already draws its own.
        if (styleKind === "raster" && map.getLayer("hillshade")) {
          map.setLayoutProperty("hillshade", "visibility", "visible");
        }
        try {
          if (map.getSource("terrain")) {
            map.setTerrain({ source: "terrain", exaggeration: 1.35 });
          }
        } catch {
          /* terrain may still be loading */
        }
        map.easeTo({ pitch: 58, bearing: map.getBearing() || -18, duration: 700 });
      } else {
        if (styleKind === "raster" && map.getLayer("hillshade")) {
          map.setLayoutProperty("hillshade", "visibility", "none");
        }
        map.setTerrain(null);
        map.easeTo({ pitch: 0, duration: 500 });
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [is3d, ready, basemap, styleKind]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || !ready) return;
    map.easeTo({
      center: [focus.lng, focus.lat],
      zoom: focus.zoom ?? Math.max(map.getZoom(), 11),
      duration: 600,
    });
  }, [focus, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const sourceId = "trail-routes";
    const casingId = "trail-routes-casing";
    const lineId = "trail-routes-line";

    const apply = () => {
      if (map.getLayer(lineId)) map.removeLayer(lineId);
      if (map.getLayer(casingId)) map.removeLayer(casingId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      if (routes.length === 0) return;

      map.addSource(sourceId, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: routes.map((geometry, index) => ({
            type: "Feature" as const,
            properties: { index },
            geometry: {
              type: "LineString" as const,
              coordinates: geometry.coordinates.map(([lng, lat, ele]) =>
                ele != null ? [lng, lat, ele] : [lng, lat],
              ),
            },
          })),
        },
      });

      const color = mode === "ski" ? "#38bdf8" : "#245b47";
      map.addLayer({
        id: casingId,
        type: "line",
        source: sourceId,
        paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.85 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: lineId,
        type: "line",
        source: sourceId,
        paint: { "line-color": color, "line-width": 4, "line-opacity": 0.95 },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      if (fitToRoutes) {
        const bounds = new maplibregl.LngLatBounds();
        for (const route of routes) {
          for (const coord of route.coordinates) bounds.extend([coord[0], coord[1]]);
        }
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, {
            padding: 48,
            maxZoom: 14,
            pitch: is3d ? 58 : map.getPitch(),
            duration: 0,
          });
        }
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once("idle", apply);
  }, [routes, fitToRoutes, mode, ready, is3d, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    markers.forEach((marker) => {
      const el = document.createElement("button");
      el.type = "button";
      el.title = marker.name;
      el.setAttribute("aria-label", marker.name);
      const isCluster = (marker.clusterCount ?? 0) > 1;
      el.className = clsx(
        "hs-map-pin",
        marker.type === "park" && "hs-map-pin--park",
        marker.type === "resort" && "hs-map-pin--resort",
        marker.type === "trail" && !isCluster && "hs-map-pin--trail",
        isCluster && "hs-map-pin--cluster",
      );
      el.textContent = isCluster
        ? String(marker.clusterCount! > 99 ? "99+" : marker.clusterCount)
        : "";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onMarkerClickRef.current?.(marker);
      });

      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([marker.longitude, marker.latitude])
          .addTo(map),
      );
    });

    if (fitToMarkers && markers.length > 0 && !focus && routes.length === 0) {
      const bounds = new maplibregl.LngLatBounds();
      for (const m of markers) bounds.extend([m.longitude, m.latitude]);
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: 48,
          maxZoom: 12,
          pitch: is3d ? 58 : map.getPitch(),
          duration: 0,
        });
      }
    }
  }, [markers, fitToMarkers, focus, routes.length, ready, is3d, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    popupRef.current?.remove();
    popupRef.current = null;
    if (!popup) return;

    const next = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      offset: 18,
      maxWidth: "280px",
      className: "hs-maplibre-popup",
      anchor: "bottom",
    })
      .setLngLat([popup.longitude, popup.latitude])
      .setHTML(popupHtml(popup))
      .addTo(map);

    next.on("close", () => onPopupCloseRef.current?.());
    popupRef.current = next;
  }, [popup, ready, basemap]);

  return (
    <div className={clsx("relative min-h-[320px] overflow-hidden rounded-2xl", className)}>
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />

      {showBasemapControls && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-surface/95 p-0.5 shadow-md backdrop-blur">
            {(
              [
                ["map", "Map"],
                ["satellite", "Sat"],
                ["hybrid", "Hybrid"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setBasemap(id)}
                className={clsx(
                  "rounded-md px-2.5 py-1.5 text-xs font-semibold transition",
                  basemap === id
                    ? "bg-accent text-forest"
                    : "text-mist hover:bg-surface-muted hover:text-cream",
                )}
              >
                {label}
              </button>
            ))}
            <span className="mx-0.5 h-4 w-px bg-[var(--border)]" aria-hidden />
            <button
              type="button"
              onClick={() => setIs3d((v) => !v)}
              className={clsx(
                "rounded-md px-2.5 py-1.5 text-xs font-semibold transition",
                is3d ? "bg-accent text-forest" : "text-mist hover:bg-surface-muted hover:text-cream",
              )}
              aria-pressed={is3d}
            >
              3D
            </button>
          </div>
          {Math.abs(bearing) > 1 && (
            <button
              type="button"
              className="pointer-events-auto rounded-lg border border-[var(--border)] bg-surface/95 px-2.5 py-1.5 text-xs font-semibold text-cream shadow-md backdrop-blur"
              onClick={() => mapRef.current?.easeTo({ bearing: 0, duration: 400 })}
              title="Reset north"
            >
              N {Math.round(((bearing % 360) + 360) % 360)}°
            </button>
          )}
        </div>
      )}

      {mapError && (
        <div className="absolute inset-x-4 top-16 z-10 rounded-xl border border-amber-500/30 bg-amber-950/80 px-4 py-2 text-sm text-amber-100">
          {mapError}
        </div>
      )}
    </div>
  );
}
