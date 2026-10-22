"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "@/lib/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { CATALOG_ACTIVITY_LABELS, TRAIL_SECTIONS, sectionOf, type CatalogActivity, type TrailSectionKey } from "@/lib/trail-catalog/activity";
import { appleMapsDirectionsUrl, googleMapsDirectionsUrl, type AccessPoint } from "@/lib/trail-catalog/access";
import { storeSection } from "@/lib/preferred-section";
import type { ExploreCluster, ExplorePointTrail } from "@/lib/trail-catalog/server";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { localTrailsVisible, TRAIL_DETAIL_ZOOM, MAP_TRAIL_LIMIT, TRAIL_CARD_LIMIT } from "@/lib/trail-catalog/discovery";
import type { WeatherPeriod } from "@/lib/weather/types";
import { SectionIcon } from "./SectionIcon";
import { ConnectedTrails } from "./ConnectedTrails";
import type { Point } from "@/lib/trail-catalog/quality";
import { NearbyTrails } from "./NearbyTrails";
import {
  DIFFICULTY_COLORS,
  DIFFICULTY_LABELS,
  EMPTY,
  explorerStyle,
  installOverlay,
  setSky,
  setLayerGroupVisibility,
  type Basemap,
  type OverlayData,
} from "./explorer-map";
import { snapPointToNearestLine } from "@/lib/geo/snap";
import "./explorer.css";
import { duration as displayDuration, feet, join as joinParts, miles as displayMiles } from "@/lib/display";
import { naismithHours } from "@/lib/trail-difficulty";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { installExtras, applySectionFilter } from "./map-extras";
import { useOpenSkiFeature } from "@/components/ski/SkiAreaMap";


type Bounds = [number, number, number, number];
interface PointsResponse { total: number; trails: ExplorePointTrail[]; clusters: ExploreCluster[] }
interface Detail { trail: CatalogTrail; lines: [number, number][][] }
interface Elevation { profile: [number, number][]; gainFt: number; lossFt: number; minFt: number; maxFt: number; partial: boolean }
interface Drive { distanceMeters: number; durationSeconds: number; line: [number, number][] }

const LENGTHS = [
  { key: "", label: "Any length" },
  { key: "0-3", label: "Under 3 mi" },
  { key: "3-8", label: "3–8 mi" },
  { key: "8-15", label: "8–15 mi" },
  { key: "15-", label: "15 mi +" },
] as const;
const ROUTE_TYPES = [
  { key: "", label: "Any route" },
  { key: "loop", label: "Loop" },
  { key: "point-to-point", label: "Point to point" },
  { key: "network", label: "Trail network" },
] as const;
const SUB_ACTIVITIES: Record<TrailSectionKey, CatalogActivity[]> = {
  foot: ["hike", "walk", "backpack", "run"],
  bike: ["bike", "mtb", "path-bike"],
  horse: ["horse"],
  snow: ["ski"],
};
const ALL_LABEL: Partial<Record<CatalogActivity, string>> = { hike: "All on foot", bike: "All biking" };
const LINE_ZOOM = TRAIL_DETAIL_ZOOM;

interface Filters { activity: CatalogActivity; difficulty: string[]; length: string; routeType: string }

function filterParams(f: Filters) {
  const p = new URLSearchParams({ activity: f.activity });
  if (f.difficulty.length) p.set("difficulty", f.difficulty.join(","));
  const [min, max] = f.length.split("-");
  if (min) p.set("minMiles", min);
  if (max) p.set("maxMiles", max);
  if (f.routeType) p.set("routeType", f.routeType);
  return p;
}

const fmtMiles = displayMiles;
const fmtDuration = displayDuration;
const ROUTE_LABEL: Record<string, string> = { loop: "Loop", "point-to-point": "Point to point", network: "Network" };

function distanceKm(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r), y = (b[1] - a[1]) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

export interface ExplorerStart { activity: CatalogActivity; trail: string | null; center: [number, number] | null; zoom: number | null }

export function TrailExplorer({ start: initial, workspace = false }: { start: ExplorerStart; workspace?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const sourcesRef = useRef<OverlayData>({
    pins: EMPTY,
    grid: EMPTY,
    lines: EMPTY,
    selected: EMPTY,
    drive: EMPTY,
    route: EMPTY,
    thruHikes: EMPTY,
    pistes: EMPTY,
    lifts: EMPTY,
    pois: EMPTY,
  });
  const fetchAbort = useRef<AbortController | null>(null);
  const hovered = useRef<number | string | null>(null);

  const [filters, setFilters] = useState<Filters>({ activity: initial.activity, difficulty: [], length: "", routeType: "" });
  const filtersRef = useRef(filters);
  const [basemap, setBasemap] = useState<Basemap>("topo");
  const [layers, setLayers] = useState({
    thruHikes: true,
    dayTrails: true,
    ski: initial.activity === "ski",
    pois: true,
  });
  const [is3d, setIs3d] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<null | "section" | "difficulty" | "length" | "route" | "layers">(null);
  const [points, setPoints] = useState<PointsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  // The map never sits blank: a skeleton covers it until the style and the first trails have loaded.
  const [firstLoad, setFirstLoad] = useState(true);
  const [verifiedInView, setVerifiedInView] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const geolocateRef = useRef<maplibregl.GeolocateControl | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [center, setCenter] = useState<[number, number]>(initial.center ?? [-98.6, 39.8]);
  const [zoom, setZoom] = useState(initial.zoom ?? 3.6);
  const [selectedId, setSelectedId] = useState<string | null>(initial.trail);
  // Per-trail results are kept with the id they belong to, so a new selection never shows stale data.
  const [detailFor, setDetailFor] = useState<{ id: string; value: Detail } | null>(null);
  const [elevationFor, setElevationFor] = useState<{ id: string; value: Elevation | "none" } | null>(null);
  const [weatherFor, setWeatherFor] = useState<{ id: string; value: WeatherPeriod | null } | null>(null);
  const [driveFor, setDriveFor] = useState<{ id: string; value: Drive } | null>(null);
  const [driveStateFor, setDriveStateFor] = useState<{ id: string; value: string } | null>(null);
  const detail = detailFor?.id === selectedId ? detailFor.value : null;
  const elevation = elevationFor?.id === selectedId ? elevationFor.value : null;
  const weather = weatherFor?.id === selectedId ? weatherFor.value : null;
  const drive = driveFor?.id === selectedId ? driveFor.value : null;
  const driveState = driveStateFor?.id === selectedId ? driveStateFor.value : null;
  const [query, setQuery] = useState("");
  const [resultsFor, setResultsFor] = useState<{ q: string; value: CatalogTrail[] } | null>(null);
  const results = query.trim().length >= 3 && resultsFor?.q === query.trim() ? resultsFor.value : null;
  const [mapError, setMapError] = useState<string | null>(null);

  const section = sectionOf(filters.activity);
  const router = useRouter();
  const routerRef = useRef(router);
  const openSki = useOpenSkiFeature();
  const openSkiRef = useRef(openSki);
  const extrasRef = useRef({ skiPins: EMPTY, skiLines: EMPTY });
  const skiAreas = useRef<{ slug: string; lng: number; lat: number }[]>([]);
  const skiCache = useRef(new Map<string, GeoJSON.Feature[]>());
  const sectionKey = section.key as TrailSectionKey;
  const sectionRef = useRef(sectionKey);
  // Map event handlers read the latest values through refs, updated after each render.
  useEffect(() => { routerRef.current = router; openSkiRef.current = openSki; sectionRef.current = sectionKey; });

  const refreshSki = useCallback(async () => {
    const map = mapRef.current; const client = createClient();
    const setLines = (fc: GeoJSON.FeatureCollection) => { extrasRef.current.skiLines = fc; (map?.getSource("hy-ski-lines") as maplibregl.GeoJSONSource | undefined)?.setData(fc); };
    if (!map || !client || map.getZoom() < 12) { setLines(EMPTY); return; }
    const b = map.getBounds();
    const inView = skiAreas.current.filter((a) => b.contains([a.lng, a.lat])).slice(0, 8);
    const need = inView.filter((a) => !skiCache.current.has(a.slug)).map((a) => a.slug);
    if (need.length) {
      const { data } = await client.from("ski_area_details").select("slug,data").in("slug", need);
      for (const row of data ?? []) skiCache.current.set(row.slug, ((row.data as { geojson?: GeoJSON.FeatureCollection })?.geojson?.features ?? []));
    }
    setLines({ type: "FeatureCollection", features: inView.flatMap((a) => skiCache.current.get(a.slug) ?? []) });
  }, []);

  const setSource = useCallback((key: keyof OverlayData, data: GeoJSON.FeatureCollection) => {
    sourcesRef.current[key] = data;
    const idMap: Record<keyof OverlayData, string> = {
      pins: "hy-pins",
      grid: "hy-grid",
      lines: "hy-lines",
      selected: "hy-selected",
      drive: "hy-drive",
      route: "hy-route",
      thruHikes: "hy-thru-hikes",
      pistes: "hy-ski-pistes",
      lifts: "hy-ski-lifts",
      pois: "hy-pois",
    };
    const source = mapRef.current?.getSource(idMap[key]) as maplibregl.GeoJSONSource | undefined;
    source?.setData(data);
  }, []);

  // Sync layer visibility state with MapLibre layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setLayerGroupVisibility(map, "thru-hikes", layers.thruHikes);
    setLayerGroupVisibility(map, "day-trails", layers.dayTrails);
    setLayerGroupVisibility(map, "ski", layers.ski);
    setLayerGroupVisibility(map, "pois", layers.pois);
  }, [layers, ready]);


  const showConnectedRoute = useCallback((points: Point[]) => {
    setSource("route", { type: "FeatureCollection", features: points.length ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } }] : [] });
    if (mapRef.current?.getLayer("hy-route")) mapRef.current.moveLayer("hy-route");
  }, [setSource]);

  const refresh = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    fetchAbort.current?.abort();

    // Stream Long-Distance Through-Hikes once
    if ((sourcesRef.current.thruHikes?.features.length ?? 0) === 0) {
      void fetch("/api/trail-catalog/thru-hikes")
        .then((r) => (r.ok ? r.json() : null))
        .then((fc) => { if (fc) setSource("thruHikes", fc); })
        .catch(() => undefined);
    }

    const b = map.getBounds();
    if (!localTrailsVisible(map.getZoom())) {
      // Zoomed out: count bubbles from the build-time overview, sized by how many trails each area holds.
      setSource("pins", EMPTY); setSource("lines", EMPTY); setSource("pois", EMPTY);
      const cp = new URLSearchParams({ activity: filtersRef.current.activity, zoom: map.getZoom().toFixed(1), bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(3)).join(",") });
      const controller = new AbortController();
      fetchAbort.current = controller;
      setLoading(true);
      void fetch(`/api/trail-catalog/clusters?${cp}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("clusters"))))
        .then((data: { total: number; verified: number; clusters: [number, number, number, number, number, number, number, number][] }) => {
          if (controller.signal.aborted) return;
          setPoints({ trails: [], clusters: data.clusters.map(([lng, lat, count, , w2, s2, e2, n2]) => [lng, lat, count, w2, s2, e2, n2]), total: data.total });
          setVerifiedInView(data.verified);
          setLoadError(null);
          setSource("grid", { type: "FeatureCollection", features: data.clusters.map(([lng, lat, count, verified, w2, s2, e2, n2]) => ({ type: "Feature", properties: { count, verified, bounds: [w2, s2, e2, n2].join(",") }, geometry: { type: "Point", coordinates: [lng, lat] } })) });
        })
        .catch(() => { if (!controller.signal.aborted) setLoadError("Trail counts couldn’t load. Move the map to try again."); })
        .finally(() => { if (!controller.signal.aborted) { setLoading(false); setFirstLoad(false); } });
      return;
    }
    setSource("grid", EMPTY);
    const pad = 0.08;
    const w = b.getEast() - b.getWest(), h = b.getNorth() - b.getSouth();
    const bbox: Bounds = [Math.max(-180, b.getWest() - w * pad), Math.max(-85, b.getSouth() - h * pad), Math.min(180, b.getEast() + w * pad), Math.min(85, b.getNorth() + h * pad)];
    const params = filterParams(filtersRef.current);
    params.set("bbox", bbox.map((n) => n.toFixed(4)).join(","));
    params.set("zoom", String(map.getZoom()));
    params.set("limit", String(MAP_TRAIL_LIMIT));
    fetchAbort.current?.abort();
    const controller = new AbortController();
    fetchAbort.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    setLoading(true);
    void fetch(`/api/trail-catalog/points?${params}`, { signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("points"))))
      .then((data: PointsResponse) => {
        if (signal.aborted) return;
        setPoints(data);
        setVerifiedInView(null);
        setLoadError(null);
        setSource("pins", { type: "FeatureCollection", features: data.trails.map(([id, name, lng, lat, miles, d]) => ({ type: "Feature", properties: { id, name, miles, d }, geometry: { type: "Point", coordinates: [lng, lat] } })) });
        setSource("grid", { type: "FeatureCollection", features: data.clusters.map(([lng, lat, count, w2, s2, e2, n2]) => ({ type: "Feature", properties: { count, bounds: [w2, s2, e2, n2].join(",") }, geometry: { type: "Point", coordinates: [lng, lat] } })) });
      })
      .catch(() => {
        if (signal.aborted) return;
        setLoadError("Trails couldn’t load here. Move the map to try again.");
      })
      .finally(() => { if (!signal.aborted) { setLoading(false); setFirstLoad(false); } });
    if (map.getZoom() >= LINE_ZOOM && w < 4 && h < 3) {
      const lp = filterParams(filtersRef.current);
      lp.set("bbox", [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(4)).join(","));
      lp.set("zoom", String(Math.round(map.getZoom())));
      lp.set("limit", String(MAP_TRAIL_LIMIT));
      void fetch(`/api/trail-catalog/lines?${lp}`, { signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("lines"))))
        .then((data: GeoJSON.FeatureCollection) => { if (!signal.aborted) setSource("lines", { ...data, features: data.features.slice(0, MAP_TRAIL_LIMIT) }); })
        .catch(() => undefined);

      // Stream Mountain POIs (Trailheads, Water, Camps, Summits)
      const poiParams = new URLSearchParams();
      poiParams.set("bbox", [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(4)).join(","));
      void fetch(`/api/trail-catalog/pois?${poiParams}`, { signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((fc) => { if (fc && !signal.aborted) setSource("pois", fc); })
        .catch(() => undefined);
    } else {
      setSource("lines", EMPTY);
      setSource("pois", EMPTY);
    }
  }, [setSource]);

  // Map setup; the style is swapped in place when the basemap changes.
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const startCenter = initial.center ?? [-98.6, 39.8];
    const startZoom = initial.zoom ?? 3.6;
    void explorerStyle("topo").then((style) => {
      if (disposed || !containerRef.current) return;
      const map = new maplibregl.Map({ container: containerRef.current, style, center: startCenter, zoom: startZoom, maxPitch: 80, attributionControl: false, hash: false });
      mapRef.current = map;
      map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "imperial", maxWidth: 90 }), "bottom-left");
      // Blue dot for the visitor's position; our "Show my location" button triggers it.
      const geolocate = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true, timeout: 12_000 }, trackUserLocation: false, showUserLocation: true, showAccuracyCircle: true, fitBoundsOptions: { maxZoom: 12 } });
      map.addControl(geolocate, "bottom-right");
      geolocate.on("error", () => setLoadError("Location is off for this site. Allow it in your browser to see trails near you."));
      geolocateRef.current = geolocate;
      map.on("style.load", () => { installOverlay(map, sourcesRef.current); installExtras(map, extrasRef.current); applySectionFilter(map, sectionRef.current); });
      map.on("load", () => {
        setReady(true);
        refresh();
        // Start the compact attribution folded; the (i) button still opens it.
        containerRef.current?.querySelector(".maplibregl-compact-show")?.classList.remove("maplibregl-compact-show");
      });
      map.on("error", (e) => {
        const msg = e.error?.message ?? "";
        if (/style/i.test(msg)) setMapError("The map style didn’t load. Try Satellite from the layers button.");
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      map.on("moveend", () => {
        const c = map.getCenter();
        setCenter([c.lng, c.lat]);
        setZoom(map.getZoom());
        const params = new URLSearchParams(window.location.search);
        params.set("lat", c.lat.toFixed(4));
        params.set("lng", c.lng.toFixed(4));
        params.set("z", map.getZoom().toFixed(1));
        window.history.replaceState(null, "", `?${params}`);
        clearTimeout(timer);
        timer = setTimeout(() => { refresh(); void refreshSki(); }, 220);
      });
      map.on("rotate", () => setBearing(map.getBearing()));

      const select = (id: string) => setSelectedId(id);
      map.on("click", "hy-pin", (e) => { const id = e.features?.[0]?.properties?.id; if (id) select(String(id)); });
      map.on("click", "hy-lines", (e) => { const id = e.features?.[0]?.properties?.id; if (id) select(String(id)); });
      map.on("click", "hy-thru-hikes", (e) => { const id = e.features?.[0]?.properties?.id; if (id) select(String(id)); });
      map.on("click", "hy-pois-circle", (e) => { const id = e.features?.[0]?.properties?.id; if (id) select(String(id)); });
      map.on("click", "hy-ski-pistes", (e) => { const f = e.features?.[0]; if (f) openSkiRef.current(f); });
      const tappedOwn = (e: maplibregl.MapMouseEvent) => map.queryRenderedFeatures(e.point, { layers: ["hy-pin", "hy-lines", "hy-thru-hikes", "hy-ski-pistes", "hy-pois-circle", "hy-ski-hit", "hy-ski-pin"].filter((l) => map.getLayer(l)) }).length > 0;
      map.on("click", "hy-ski-hit", (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ["hy-pin", "hy-lines", "hy-thru-hikes"] }).length) return;
        const f = e.features?.[0]; if (f) openSkiRef.current(f);
      });
      map.on("click", "hy-ski-pin", (e) => { const s = e.features?.[0]?.properties?.slug; if (s) routerRef.current.push(`/ski-areas/${s}`); });

      // Precision Map-Snapping on click: snap to closest vector segment if clicked near a trail
      map.on("click", (e) => {
        if (tappedOwn(e)) return;
        if (map.getZoom() >= 12) {
          const renderedLines = map.queryRenderedFeatures({
            layers: ["hy-lines", "hy-thru-hikes"].filter((l) => map.getLayer(l)),
          });
          const candidateLines: [number, number][][] = [];
          for (const feat of renderedLines) {
            const geom = feat.geometry;
            if (geom.type === "LineString") candidateLines.push(geom.coordinates as [number, number][]);
            else if (geom.type === "MultiLineString") candidateLines.push(...(geom.coordinates as [number, number][][]));
          }
          if (candidateLines.length > 0) {
            const snapped = snapPointToNearestLine([e.lngLat.lng, e.lngLat.lat], candidateLines, 45);
            if (snapped && snapped.isSnapped) {
              const matchedFeature = renderedLines[snapped.lineIndex];
              const id = matchedFeature?.properties?.id;
              if (id) select(String(id));
            }
          }
        }
      });
      map.on("click", "hy-pins-cluster", async (e) => {
        const f = e.features?.[0];
        const source = map.getSource("hy-pins") as maplibregl.GeoJSONSource | undefined;
        if (!f || !source) return;
        const zoomTo = await source.getClusterExpansionZoom(Number(f.properties?.cluster_id));
        map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: zoomTo + 0.3, duration: 500 });
      });
      map.on("click", "hy-grid-cluster", (e) => {
        const raw = String(e.features?.[0]?.properties?.bounds ?? "");
        const [w, s, ea, n] = raw.split(",").map(Number);
        if ([w, s, ea, n].every(Number.isFinite)) map.fitBounds([[w, s], [ea, n]], { padding: 60, maxZoom: 11, duration: 600 });
      });
      for (const layer of [
        "hy-pin",
        "hy-lines",
        "hy-thru-hikes",
        "hy-ski-pistes",
        "hy-pois-circle",
        "hy-pins-cluster",
        "hy-grid-cluster",
        "hy-osm-hit",
        "hy-ski-hit",
        "hy-ski-pin",
      ]) {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
      }
      map.on("mousemove", "hy-lines", (e) => {
        const id = e.features?.[0]?.id;
        if (id === undefined || id === hovered.current) return;
        if (hovered.current !== null) map.setFeatureState({ source: "hy-lines", id: hovered.current }, { hover: false });
        hovered.current = id;
        map.setFeatureState({ source: "hy-lines", id }, { hover: true });
      });
      map.on("mouseleave", "hy-lines", () => {
        if (hovered.current !== null) map.setFeatureState({ source: "hy-lines", id: hovered.current }, { hover: false });
        hovered.current = null;
      });
      const ro = new ResizeObserver(() => map.resize());
      ro.observe(containerRef.current);
      map.once("remove", () => ro.disconnect());
    });
    return () => {
      disposed = true;
      fetchAbort.current?.abort();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The camera starts from the server-read URL once; later moves are the map's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  // Pins for every ski area (requires sign-in to read).
  useEffect(() => {
    const client = createClient(); if (!client) return;
    let live = true;
    void (async () => {
      const rows: { slug: string; name: string; latitude: number; longitude: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const { data } = await client.from("ski_areas").select("slug,name,latitude,longitude").range(i * 1000, i * 1000 + 999);
        if (!data?.length) break; rows.push(...data); if (data.length < 1000) break;
      }
      if (!live) return;
      skiAreas.current = rows.map((r) => ({ slug: r.slug, lng: r.longitude, lat: r.latitude }));
      const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: rows.map((r) => ({ type: "Feature", properties: { slug: r.slug, name: r.name }, geometry: { type: "Point", coordinates: [r.longitude, r.latitude] } })) };
      extrasRef.current.skiPins = fc;
      (mapRef.current?.getSource("hy-ski-pins") as maplibregl.GeoJSONSource | undefined)?.setData(fc);
      void refreshSki();
    })();
    return () => { live = false; };
  }, [refreshSki]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) applySectionFilter(map, sectionKey);
  }, [sectionKey, ready]);

  const is3dRef = useRef(is3d);
  const selectedIdRef = useRef(selectedId);
  const syncSelectedPin = useCallback(() => {
    const map = mapRef.current;
    if (map?.getLayer("hy-pin-selected")) map.setFilter("hy-pin-selected", ["==", ["get", "id"], selectedIdRef.current ?? ""]);
  }, []);

  // Basemap switch keeps the camera and re-installs Hyked layers on the new style.
  const firstBasemap = useRef(true);
  useEffect(() => {
    if (firstBasemap.current) { firstBasemap.current = false; return; }
    const map = mapRef.current;
    if (!map) return;
    let live = true;
    void explorerStyle(basemap).then((style) => {
      if (!live) return;
      map.setStyle(style, { diff: false });
      map.once("style.load", () => {
        if (is3dRef.current) { map.setTerrain({ source: "terrain", exaggeration: 1.4 }); setSky(map, true); }
        syncSelectedPin();
      });
    });
    return () => { live = false; };
  }, [basemap, syncSelectedPin]);

  useEffect(() => {
    is3dRef.current = is3d;
    const map = mapRef.current;
    if (!map || !ready) return;
    if (is3d) {
      map.setTerrain({ source: "terrain", exaggeration: 1.4 });
      setSky(map, true);
      map.easeTo({ pitch: 62, bearing: map.getBearing() || -20, zoom: Math.max(map.getZoom(), 11.5), duration: 900 });
    } else {
      map.setTerrain(null);
      setSky(map, false);
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
  }, [is3d, ready]);

  useEffect(() => {
    filtersRef.current = filters;
    if (ready) refresh();
  }, [filters, ready, refresh]);

  // Selection: full line, elevation and weather for the chosen trail.
  useEffect(() => {
    selectedIdRef.current = selectedId;
    syncSelectedPin();
    const params = new URLSearchParams(window.location.search);
    if (selectedId) params.set("trail", selectedId); else params.delete("trail");
    window.history.replaceState(null, "", `?${params}`);
    setSource("selected", EMPTY);
    setSource("drive", EMPTY);
    if (!selectedId) return;
    const controller = new AbortController();
    const id = encodeURIComponent(selectedId);
    const forId = selectedId;
    void fetch(`/api/trail-catalog/${id}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("detail"))))
      .then((d: Detail) => {
        setDetailFor({ id: forId, value: d });
        if (d.lines?.length) {
          setSource("selected", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: d.lines } }] });
          const map = mapRef.current;
          if (map) {
            const bounds = new maplibregl.LngLatBounds();
            for (const line of d.lines) for (const p of line) bounds.extend(p);
            const box = map.getBounds();
            // Only move when the trail isn't already comfortably in view.
            if (!box.contains(bounds.getNorthEast()) || !box.contains(bounds.getSouthWest()) || map.getZoom() < 11) {
              map.fitBounds(bounds, { padding: { top: 140, bottom: 300, left: 60, right: 80 }, maxZoom: 15, duration: 800 });
            }
          }
        } else {
          mapRef.current?.easeTo({ center: [d.trail.longitude, d.trail.latitude], zoom: Math.max(mapRef.current.getZoom(), 12), duration: 700 });
        }
        void fetch(`/api/weather/forecast?lat=${d.trail.latitude}&lng=${d.trail.longitude}`, { signal: controller.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((w: { forecast?: { periods: WeatherPeriod[] } } | null) => setWeatherFor({ id: forId, value: w?.forecast?.periods?.[0] ?? null }))
          .catch(() => undefined);
      })
      .catch(() => undefined);
    void fetch(`/api/trail-catalog/${id}/elevation`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : "none"))
      .then((e: Elevation | "none") => setElevationFor({ id: forId, value: e }))
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) setElevationFor({ id: forId, value: "none" }); });
    return () => controller.abort();
  }, [selectedId, setSource, syncSelectedPin]);

  const cards = useMemo(() => {
    if (!localTrailsVisible(zoom)) return [];
    // Nearest first, discounted by the quality score (40 points halve the distance), so whole, well-sourced
    // trails come before stubs and connectors that happen to be closer.
    const list = (points?.trails ?? []).map((t) => ({ t, km: distanceKm(center, [t[2], t[3]]) / (1 + Math.max(0, t[8] ?? 0) / 40) }));
    list.sort((a, b) => a.km - b.km);
    const out = list.slice(0, TRAIL_CARD_LIMIT).map((x) => x.t);
    if (selectedId && !out.some((t) => t[0] === selectedId)) {
      const hit = points?.trails.find((t) => t[0] === selectedId);
      if (hit) out.unshift(hit);
      else if (detail?.trail.id === selectedId) {
        const t = detail.trail;
        out.unshift([t.id, t.name, t.longitude, t.latitude, t.miles, "m", t.park ?? t.forest ?? t.region, t.routeType ?? null, t.qualityScore ?? 0]);
      }
    }
    return out.slice(0, TRAIL_CARD_LIMIT);
  }, [points, center, selectedId, detail, zoom]);

  useEffect(() => {
    if (!selectedId) return;
    railRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedId, cards]);

  // Trail search by name.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const p = filterParams({ ...filtersRef.current, difficulty: [], length: "", routeType: "" });
      p.set("q", q); p.set("limit", "8");
      void fetch(`/api/trail-catalog?${p}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { trails?: CatalogTrail[] } | null) => setResultsFor({ q, value: d?.trails ?? [] }))
        .catch(() => undefined);
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  const start: AccessPoint | null = detail?.trail.trailhead ?? (detail ? { kind: "trail-end", name: null, latitude: detail.trail.latitude, longitude: detail.trail.longitude, toTrailMeters: 0 } : null);

  function driveHere() {
    if (!start || !selectedId) return;
    const forId = selectedId;
    const setDriveState = (value: string | null) => setDriveStateFor(value === null ? null : { id: forId, value });
    if (!("geolocation" in navigator)) { setDriveState("Your browser can’t share its location. Use Google or Apple Maps."); return; }
    setDriveState("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDriveState("Planning the drive…");
        void fetch(`/api/directions?from=${pos.coords.latitude},${pos.coords.longitude}&to=${start.latitude},${start.longitude}`)
          .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d as Drive; })
          .then((d) => {
            setDriveFor({ id: forId, value: d });
            setDriveState(null);
            setSource("drive", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: d.line } }] });
            const bounds = new maplibregl.LngLatBounds();
            for (const p of d.line) bounds.extend(p);
            mapRef.current?.fitBounds(bounds, { padding: { top: 140, bottom: 320, left: 60, right: 80 }, duration: 900 });
          })
          .catch((error: Error) => setDriveState(error.message || "Directions are unavailable right now. Use Google or Apple Maps."));
      },
      () => setDriveState("Location is off. Allow location, or open Google or Apple Maps."),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 300_000 },
    );
  }

  function locate() {
    if (geolocateRef.current?.trigger()) return;
    navigator.geolocation?.getCurrentPosition(
      (pos) => mapRef.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 12, duration: 1200 }),
      () => setLoadError("Location is off for this site. Allow it in your browser to see trails near you."),
      { timeout: 12_000, maximumAge: 300_000 },
    );
  }
  function visit(lat: number, lng: number) {
    setSelectedId(null);
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 12, duration: 1000 });
  }

  const chooseSection = (key: TrailSectionKey) => {
    storeSection(key);
    const next = TRAIL_SECTIONS.find((s) => s.key === key);
    if (next) setFilters((f) => ({ ...f, activity: next.activity }));
    if (key === "snow") setLayers((prev) => ({ ...prev, ski: true }));
  };
  const activeFilters = filters.difficulty.length + (filters.length ? 1 : 0) + (filters.routeType ? 1 : 0);
  const selectedCard = cards.find((t) => t[0] === selectedId);
  const gain = elevation && elevation !== "none" ? elevation.gainFt : null;

  const zoomedOut = !localTrailsVisible(zoom);
  const total = points?.total ?? null;
  const countLabel = total === null ? "Loading trails…" : zoomedOut
    ? `${total.toLocaleString("en-US")} ${total === 1 ? "trail" : "trails"} in this area`
    : `${total.toLocaleString("en-US")} ${total === 1 ? "trail" : "trails"} in view`;
  const countDetail = total === null ? null : zoomedOut
    ? `${verifiedInView !== null ? `${verifiedInView.toLocaleString("en-US")} verified · ` : ""}zoom in or tap a circle to see them`
    : total > cards.length ? `Showing the first ${cards.length} of ${total.toLocaleString("en-US")}, best-documented first` : total ? "Best-documented first" : `No ${section.label.toLowerCase()} trails here. Zoom out or clear filters.`;

  function toggleFullscreen() {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  }
  function toggleTilt() {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: map.getPitch() > 5 ? 0 : 55, duration: 600 });
  }

  return (
    <div ref={shellRef} className={`hx${workspace ? " hx-workspace" : " hx-workspace hx-workspace--map"}`} onKeyDown={(e) => { if (e.key === "Escape") { setOpen(null); setQuery(""); setSearchOpen(false); } }}>
      <header className="hx-workspace-header"><div><h1>{workspace ? "Explore trails" : "Trail map"}</h1><p>Find a route. Make it your next adventure.</p></div><nav aria-label="Trail workspace"><Link className="hx-btn" href="/explore/trails/catalog">Browse list</Link><Link className="hx-btn hx-btn--primary" href="/plan">Plan a trip</Link></nav></header>
      <div ref={containerRef} className="hx-map" role="region" aria-label="Trail map" />
      {(firstLoad || !ready) && (
        <div className="hx-loading" role="status">
          <div className="hx-loading-sheen" aria-hidden="true" />
          <p>Loading the map and trails…</p>
        </div>
      )}

      <div className="hx-stack" role="toolbar" aria-label="Map controls">
        <button type="button" className="hx-ctl" aria-label="Search trails" aria-expanded={searchOpen} onClick={() => setSearchOpen((v) => !v)}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" /></svg>
        </button>
        <button type="button" className="hx-ctl" aria-label="Show my location" title="Show my location" onClick={locate}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
        </button>
        <button type="button" className="hx-ctl" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <button type="button" className="hx-ctl" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button type="button" className="hx-ctl" aria-label="Tilt the map" title="Tilt" onClick={toggleTilt}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" aria-hidden="true"><path d="M3 18h18L17 7H7L3 18Z" /><path d="M8 12h8" /></svg>
        </button>
        <button type="button" className="hx-ctl" aria-label="Full screen" title="Full screen" onClick={toggleFullscreen}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg>
        </button>
        <button type="button" className="hx-ctl hx-ctl--text" aria-pressed={is3d} aria-label={is3d ? "Show flat map" : "Show 3D terrain"} onClick={() => setIs3d((v) => !v)}>3D</button>
        <div className="hx-pop-anchor">
          <button type="button" className="hx-ctl hx-ctl--text" aria-expanded={open === "layers"} onClick={() => setOpen(open === "layers" ? null : "layers")}>Maps</button>
          {open === "layers" && (
            <div className="hx-pop hx-pop--right hx-layers">
              {([["topo", "Topo", "Contours and terrain shading"], ["satellite", "Satellite", "Aerial imagery with roads"], ["standard", "Standard", "Streets and places"]] as const).map(([key, label, hint]) => (
                <button key={key} type="button" className={`hx-layer hx-layer--${key}`} aria-pressed={basemap === key} onClick={() => setBasemap(key)}>
                  <span className="hx-layer-swatch" aria-hidden="true" />
                  <span><strong>{label}</strong><small>{hint}</small></span>
                </button>
              ))}
              <div className="hx-layer-toggles">
                <label className="hx-check"><input type="checkbox" checked={layers.thruHikes} onChange={(e) => setLayers((l) => ({ ...l, thruHikes: e.target.checked }))} /> Long-distance trails</label>
                <label className="hx-check"><input type="checkbox" checked={layers.dayTrails} onChange={(e) => setLayers((l) => ({ ...l, dayTrails: e.target.checked }))} /> Day trails</label>
                <label className="hx-check"><input type="checkbox" checked={layers.ski} onChange={(e) => setLayers((l) => ({ ...l, ski: e.target.checked }))} /> Ski runs and lifts</label>
                <label className="hx-check"><input type="checkbox" checked={layers.pois} onChange={(e) => setLayers((l) => ({ ...l, pois: e.target.checked }))} /> Trailheads, water, camps</label>
              </div>
            </div>
          )}
        </div>
        {(Math.abs(bearing) > 1 || is3d) && (
          <button type="button" className="hx-ctl" aria-label="Reset north" onClick={() => mapRef.current?.easeTo({ bearing: 0, pitch: is3d ? 60 : 0, duration: 500 })}>
            <svg viewBox="0 0 24 24" width="22" height="22" style={{ transform: `rotate(${-bearing}deg)` }} aria-hidden="true"><path d="M12 3 8.5 12h7L12 3Z" fill="#d8452f" /><path d="M12 21l3.5-9h-7L12 21Z" fill="currentColor" opacity="0.7" /></svg>
          </button>
        )}
      </div>

      {searchOpen && (
        <div className="hx-search hx-search--panel">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" /></svg>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search trails, parks or places" aria-label="Search trails" />
          {results && (
            <ul className="hx-results" role="listbox" aria-label="Matching trails">
              {results.length === 0 && <li className="hx-results-empty">No {section.label.toLowerCase()} trails match “{query.trim()}”.</li>}
              {results.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => { setQuery(""); setSearchOpen(false); setSelectedId(t.id); }}>
                    <strong>{t.name}</strong>
                    <span>{joinParts([t.park ?? t.forest ?? t.region, fmtMiles(t.miles)])}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="hx-top">
        <div className="hx-chips" role="toolbar" aria-label="Trail filters">
          <div className="hx-pop-anchor">
            <button type="button" className="hx-chip hx-chip--section" aria-expanded={open === "section"} onClick={() => setOpen(open === "section" ? null : "section")}>
              <SectionIcon section={section.key} size={18} />
              {filters.activity === section.activity ? section.label : CATALOG_ACTIVITY_LABELS[filters.activity]}
              <Caret />
            </button>
            {open === "section" && (
              <div className="hx-pop hx-pop--wide">
                <div className="hx-sections">
                  {TRAIL_SECTIONS.map((s) => (
                    <button key={s.key} type="button" className="hx-section" aria-pressed={section.key === s.key} onClick={() => chooseSection(s.key)}>
                      <SectionIcon section={s.key} />
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
                {SUB_ACTIVITIES[section.key].length > 1 && (
                  <div className="hx-subs">
                    {SUB_ACTIVITIES[section.key].map((a) => (
                      <button key={a} type="button" className="hx-sub" aria-pressed={filters.activity === a} onClick={() => setFilters((f) => ({ ...f, activity: a }))}>
                        {ALL_LABEL[a] ?? CATALOG_ACTIVITY_LABELS[a]}
                      </button>
                    ))}
                  </div>
                )}
                <p className="hx-pop-note">{section.blurb}. Bike and horse access comes from official agency use records where they exist.</p>
              </div>
            )}
          </div>
          <div className="hx-pop-anchor">
            <button type="button" className="hx-chip" aria-pressed={filters.difficulty.length > 0} aria-expanded={open === "difficulty"} onClick={() => setOpen(open === "difficulty" ? null : "difficulty")}>
              {filters.difficulty.length ? filters.difficulty.map((d) => DIFFICULTY_LABELS[d === "expert" ? "x" : d[0]]).join(", ") : "Difficulty"}
              <Caret />
            </button>
            {open === "difficulty" && (
              <div className="hx-pop">
                {(["easy", "moderate", "hard", "expert"] as const).map((d) => (
                  <label key={d} className="hx-check">
                    <input type="checkbox" checked={filters.difficulty.includes(d)} onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.checked ? [...f.difficulty, d] : f.difficulty.filter((x) => x !== d) }))} />
                    <span className="hx-dot" style={{ background: DIFFICULTY_COLORS[d === "expert" ? "x" : d[0]] }} />
                    {DIFFICULTY_LABELS[d === "expert" ? "x" : d[0]]}
                  </label>
                ))}
                <p className="hx-pop-note">Computed from distance and terrain (sac_scale): effort = miles + 2 × thousands of feet climbed.</p>
              </div>
            )}
          </div>
          <div className="hx-pop-anchor">
            <button type="button" className="hx-chip" aria-pressed={Boolean(filters.length)} aria-expanded={open === "length"} onClick={() => setOpen(open === "length" ? null : "length")}>
              {filters.length ? LENGTHS.find((l) => l.key === filters.length)?.label ?? "Length" : "Length"}
              <Caret />
            </button>
            {open === "length" && (
              <div className="hx-pop">
                {LENGTHS.map((l) => (
                  <label key={l.key} className="hx-check">
                    <input type="radio" name="hx-length" checked={filters.length === l.key} onChange={() => { setFilters((f) => ({ ...f, length: l.key })); setOpen(null); }} />
                    {l.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="hx-pop-anchor">
            <button type="button" className="hx-chip" aria-pressed={Boolean(filters.routeType)} aria-expanded={open === "route"} onClick={() => setOpen(open === "route" ? null : "route")}>
              {filters.routeType ? ROUTE_LABEL[filters.routeType] : "Route type"}
              <Caret />
            </button>
            {open === "route" && (
              <div className="hx-pop">
                {ROUTE_TYPES.map((r) => (
                  <label key={r.key} className="hx-check">
                    <input type="radio" name="hx-route" checked={filters.routeType === r.key} onChange={() => { setFilters((f) => ({ ...f, routeType: r.key })); setOpen(null); }} />
                    {r.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          {activeFilters > 0 && (
            <button type="button" className="hx-chip hx-chip--clear" onClick={() => setFilters((f) => ({ ...f, difficulty: [], length: "", routeType: "" }))}>
              Clear {activeFilters}
            </button>
          )}
        </div>
      </div>

      {(loadError ?? mapError) && <p className="hx-status hx-status--error" role="alert">{loadError ?? mapError}</p>}

      <div className="hx-legend" aria-label="Difficulty colours">
        {(["e", "m", "h", "x"] as const).map((d) => (
          <span key={d}><i style={{ background: DIFFICULTY_COLORS[d] }} />{DIFFICULTY_LABELS[d]}</span>
        ))}
      </div>

      <div className={`hx-rail-wrap${sheetOpen ? " is-open" : ""}`}>
        <button type="button" className="hx-sheet-handle" aria-expanded={sheetOpen} onClick={(e) => { setSheetOpen((v) => !v); e.currentTarget.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
          <span className="hx-sheet-grip" aria-hidden="true" />
          <span>{countLabel}</span>
          <small>{sheetOpen ? "Hide list" : "Show list"}</small>
        </button>
        <div className="hx-results-heading" aria-live="polite">
          <div><h2>{countLabel}</h2>{countDetail && <p>{countDetail}</p>}</div>
          {loading && <span className="hx-spinner" aria-hidden="true" />}
        </div>
        <ConnectedTrails selected={detail ? { id: detail.trail.id, name: detail.trail.name, lines: detail.lines } : null} onRoute={showConnectedRoute} />
        {cards.length > 0 ? (
          <div className="hx-rail" ref={railRef} role="list" aria-label="Trails in view, best-documented first">
            {cards.map((t) => {
              const [id, name, , , miles, d, place, routeType] = t;
              const active = id === selectedId;
              const hours = active && gain !== null ? naismithHours(miles, gain) : null;
              return (
                <article key={id} data-id={id} role="listitem" className={`hx-card${active ? " hx-card--active" : ""}`}>
                  <button type="button" className="hx-card-hit" onClick={() => setSelectedId(active ? null : id)} aria-pressed={active} aria-label={`${name}${active ? ", selected" : ""}`} />
                  <div className="hx-card-head">
                    <TrailShape id={id} lines={active ? detail?.lines : undefined} color={DIFFICULTY_COLORS[d]} />
                    <div className="hx-card-title">
                      <h3>{name}</h3>
                      <p>{joinParts([place, routeType && ROUTE_LABEL[routeType]]) ?? "Location not recorded"}</p>
                    </div>
                    {active && weather && (weather.temperatureF ?? weather.lowF) !== undefined && (
                      <span className="hx-weather" title={weather.shortForecast}>
                        <strong>{Math.round(weather.temperatureF ?? weather.lowF ?? 0)}°F</strong>
                        <small>{weather.name}</small>
                      </span>
                    )}
                  </div>
                  <dl className="hx-stats">
                    <div><dt>Difficulty</dt><dd><span className="hx-dot" style={{ background: DIFFICULTY_COLORS[d] }} />{DIFFICULTY_LABELS[d]}</dd></div>
                    {fmtMiles(miles) && <div><dt>Length</dt><dd>{fmtMiles(miles)}</dd></div>}
                    {active && feet(gain) && <div><dt>Gain</dt><dd>{feet(gain)}</dd></div>}
                    {fmtDuration(hours) && <div><dt>Est. time</dt><dd>{fmtDuration(hours)}</dd></div>}
                  </dl>
                  {active && (
                    <div className="hx-card-more">
                      {elevation && elevation !== "none" && elevation.profile.length > 2 ? <ElevationChart e={elevation} /> : elevation === null ? <div className="hx-elev hx-elev--loading" aria-label="Loading elevation" /> : null}
                      {drive && (
                        <p className="hx-drive">Drive: <strong>{fmtDuration(drive.durationSeconds / 3600)}</strong> · {Math.round(drive.distanceMeters / 1609.344)} mi to {start?.kind === "trail-end" ? "the trail" : start?.name ?? "the trailhead"}</p>
                      )}
                      {driveState && <p className="hx-drive" role="status">{driveState}</p>}
                      <div className="hx-actions">
                        <Link className="hx-btn hx-btn--primary" href={`/explore/trails/${encodeURIComponent(id)}`}>View trail</Link>
                        {start && (
                          <>
                            <a className="hx-btn" href={googleMapsDirectionsUrl(start.latitude, start.longitude)} target="_blank" rel="noopener noreferrer" aria-label={`Google Maps directions to ${name}`}>Google Maps</a>
                            <a className="hx-btn" href={appleMapsDirectionsUrl(start.latitude, start.longitude, start.name ?? name)} target="_blank" rel="noopener noreferrer">Apple Maps</a>
                            <button type="button" className="hx-btn" onClick={driveHere}>Drive here</button>
                          </>
                        )}
                      </div>
                      {start && <p className="hx-start">{start.kind === "trail-end" ? "No mapped trailhead — directions go to the trail’s mapped start. Check the land manager for access and parking." : `Directions go to ${start.name ?? (start.kind === "parking" ? "trailhead parking" : "the trailhead")}${start.toTrailMeters > 50 ? `, ${Math.round(start.toTrailMeters)} m from the trail` : ""}.`}</p>}
                      <NearbyTrails trailId={id} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : !zoomedOut ? null : (
          <div className="hx-discover">
            <button className="hx-btn hx-btn--primary" type="button" onClick={locate}>Trails near me</button>
            <div className="hx-destinations">
              <button type="button" className="hx-btn" onClick={() => visit(37.74, -119.58)}>Yosemite</button>
              <button type="button" className="hx-btn" onClick={() => visit(40.31, -105.64)}>Rocky Mountain</button>
              <button type="button" className="hx-btn" onClick={() => visit(47.50, -121.75)}>Cascades</button>
            </div>
          </div>
        )}
        {selectedCard === undefined && selectedId && detail === null && <p className="sr-only" role="status">Loading trail</p>}
      </div>
    </div>
  );
}

function Caret() {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
}

/** Outline of the actual trail when its line is loaded; otherwise a difficulty swatch (no invented shape). */
function TrailShape({ id, lines, color }: { id: string; lines?: [number, number][][]; color: string }) {
  if (!lines?.length) return <span className="hx-shape hx-shape--empty" style={{ background: color }} aria-hidden="true" />;
  let w = 180, s = 90, e = -180, n = -90;
  for (const l of lines) for (const [x, y] of l) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const k = Math.cos(((s + n) / 2) * Math.PI / 180);
  const scale = 44 / (Math.max((e - w) * k, n - s) || 1e-6);
  const ox = (56 - (e - w) * k * scale) / 2, oy = (56 - (n - s) * scale) / 2;
  const d = lines.map((l) => l.map(([x, y], i) => `${i ? "L" : "M"}${(ox + (x - w) * k * scale).toFixed(1)},${(oy + (n - y) * scale).toFixed(1)}`).join("")).join("");
  return (
    <svg className="hx-shape" viewBox="0 0 56 56" aria-hidden="true" data-trail={id}>
      <path d={d} fill="none" stroke="#000" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
      <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ElevationChart({ e }: { e: Elevation }) {
  const W = 320, H = 64;
  const maxMile = e.profile[e.profile.length - 1][0] || 1;
  const range = Math.max(40, e.maxFt - e.minFt);
  const pts = e.profile.map(([m, ft]) => [(m / maxMile) * W, H - 4 - ((ft - e.minFt) / range) * (H - 10)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  return (
    <figure className="hx-elev">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Elevation from ${e.minFt.toLocaleString("en-US")} to ${e.maxFt.toLocaleString("en-US")} feet, ${e.gainFt.toLocaleString("en-US")} feet of climbing`}>
        <path d={`${line}L${W},${H}L0,${H}Z`} className="hx-elev-fill" />
        <path d={line} className="hx-elev-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption>
        <span>{e.minFt.toLocaleString("en-US")}–{e.maxFt.toLocaleString("en-US")} ft</span>
        <span>{e.gainFt.toLocaleString("en-US")} ft up · {e.lossFt.toLocaleString("en-US")} ft down{e.partial ? " (partial)" : ""}</span>
      </figcaption>
    </figure>
  );
}
