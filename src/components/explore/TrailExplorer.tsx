"use client";

import { formatElevation, formatMeters } from "@/lib/units";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "@/lib/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { CATALOG_ACTIVITY_LABELS, TRAIL_SECTIONS, sectionOf, type CatalogActivity, type CatalogActivityFilter, type TrailSectionKey } from "@/lib/trail-catalog/activity";
import { appleMapsDirectionsUrl, googleMapsDirectionsUrl, type AccessPoint } from "@/lib/trail-catalog/access";
import { storeSection } from "@/lib/preferred-section";
import type { ExploreCluster, ExplorePointTrail } from "@/lib/trail-catalog/server";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { localTrailsVisible, TRAIL_DETAIL_ZOOM, MAP_TRAIL_LIMIT, TRAIL_CARD_LIMIT } from "@/lib/trail-catalog/discovery";
import type { WeatherPeriod } from "@/lib/weather/types";
import { SectionIcon } from "./SectionIcon";
import { RouteBuilder } from "@/components/route-builder/RouteBuilder";
import { FEATURE_LABELS, featureGroup, featureName, fetchFeatures, type HikeFeature } from "@/lib/routing/features";
import { usePersonalTrails } from "@/lib/personal-trails";
import type { Point } from "@/lib/trail-catalog/quality";
import { NearbyTrails } from "./NearbyTrails";
import {
  BASEMAPS,
  DIFFICULTY_COLORS,
  DIFFICULTY_LABELS,
  EMPTY,
  explorerStyle,
  installOverlay,
  setFeatureLabelGroups,
  setLayerGroupVisibility,
  type Basemap,
  type OverlayData,
} from "./explorer-map";
import { snapPointToNearestLine } from "@/lib/geo/snap";
import "./explorer.css";
import { duration as displayDuration, join as joinParts, miles as displayMiles } from "@/lib/display";
import { ROUTE_TYPE_LABELS } from "@/lib/trail-catalog/quality";
import { effortClimbFt, trailDifficulty, type TrailDifficulty } from "@/lib/trail-difficulty";
import { TrailStats } from "@/components/trails/TrailStats";
import type { RouteType } from "@/lib/trail-catalog/quality";
import { useRouter } from "next/navigation";
import { skiAreaRows } from "@/web/trail-service";
import { immediateStart, locate as locateVisitor, saveLastView } from "@/lib/start-location";
import { cameraUpTrail, PITCH_3D, setThreeD, trailLine3d } from "./three-d";
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
  { key: "out-and-back", label: "Out & back" },
  { key: "point-to-point", label: "Point to point" },
  { key: "segment", label: "Trail segment" },
] as const;
const SUB_ACTIVITIES: Record<TrailSectionKey, CatalogActivity[]> = {
  foot: ["hike", "walk", "backpack", "run"],
  bike: ["bike", "mtb", "path-bike"],
  horse: ["horse"],
  snow: ["ski", "sled"],
  water: ["paddle"],
};
const ALL_LABEL: Partial<Record<CatalogActivity, string>> = { hike: "All on foot", bike: "All biking" };
const LINE_ZOOM = TRAIL_DETAIL_ZOOM;

interface Filters { activity: CatalogActivityFilter; difficulty: string[]; length: string; routeType: string; verified: boolean; dogs: boolean }

function filterParams(f: Filters) {
  const p = new URLSearchParams({ activity: f.activity });
  if (f.difficulty.length) p.set("difficulty", f.difficulty.join(","));
  const [min, max] = f.length.split("-");
  if (min) p.set("minMiles", min);
  if (max) p.set("maxMiles", max);
  if (f.routeType) p.set("routeType", f.routeType);
  if (f.verified) p.set("verified", "true");
  if (f.dogs) p.set("dogFriendly", "true");
  return p;
}

const fmtMiles = displayMiles;
const fmtDuration = displayDuration;
const ROUTE_LABEL: Record<string, string> = ROUTE_TYPE_LABELS;

function distanceKm(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r), y = (b[1] - a[1]) * r;
  return Math.sqrt(x * x + y * y) * 6371;
}

export interface ExplorerStart {
  activity: CatalogActivity;
  trail: string | null;
  center: [number, number] | null;
  zoom: number | null;
  /** Opens the route builder with this start (the trail page's "Build a route from here"). */
  routeFrom?: { point: [number, number]; name: string } | null;
}

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
    myTrails: EMPTY,
  });
  const fetchAbort = useRef<AbortController | null>(null);
  const hovered = useRef<number | string | null>(null);

  const [filters, setFilters] = useState<Filters>({ activity: initial.activity, difficulty: [], length: "", routeType: "", verified: false, dogs: false });
  const filtersRef = useRef(filters);
  // The chosen map style is remembered on this device.
  const [basemap, setBasemapState] = useState<Basemap>(() => {
    try { const saved = localStorage.getItem("hyked:basemap"); return BASEMAPS.some((b) => b.key === saved) ? (saved as Basemap) : "topo"; } catch { return "topo"; }
  });
  const basemapRef = useRef(basemap);
  const setBasemap = (next: Basemap) => { setBasemapState(next); try { localStorage.setItem("hyked:basemap", next); } catch { /* storage unavailable */ } };
  const [layers, setLayers] = useState({
    thruHikes: true,
    dayTrails: true,
    ski: initial.activity === "ski",
    water: true,
    camping: true,
    other: false,
    myTrails: true,
  });
  const [routeOpen, setRouteOpen] = useState(Boolean(initial.routeFrom));
  // The map instance as state, so the route builder renders once the map exists.
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const [viewFeatures, setViewFeatures] = useState<HikeFeature[]>([]);
  // While the route builder waits for a tap, map taps set route points instead of selecting trails.
  const pickingRef = useRef(false);
  const onPickingChange = useCallback((picking: boolean) => { pickingRef.current = picking; }, []);
  const layersRef = useRef(layers);
  const { trails: myTrails } = usePersonalTrails();
  const [is3d, setIs3d] = useState(false);
  const [bearing, setBearing] = useState(0);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<null | "section" | "difficulty" | "length" | "route" | "layers">(null);
  const [points, setPoints] = useState<PointsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  // The map never sits blank: a skeleton covers it until the style and the first trails have loaded.
  const [, setFirstLoad] = useState(true);
  const [verifiedInView, setVerifiedInView] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const geolocateRef = useRef<maplibregl.GeolocateControl | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // URL → last view → (location, below) → time-zone region; the map opens at once, never on the middle of the U.S.
  const [startView] = useState(() => immediateStart({ center: initial.center, zoom: initial.zoom }));
  const [center, setCenter] = useState<[number, number]>(startView.center);
  const [zoom, setZoom] = useState(startView.zoom);
  const [selectedId, setSelectedId] = useState<string | null>(initial.trail);
  // Per-trail results are kept with the id they belong to, so a new selection never shows stale data.
  const [detailFor, setDetailFor] = useState<{ id: string; value: Detail } | null>(null);
  const [elevationFor, setElevationFor] = useState<{ id: string; value: Elevation | "none" } | null>(null);
  const [weatherFor, setWeatherFor] = useState<{ id: string; value: WeatherPeriod | null } | null>(null);
  const [driveFor, setDriveFor] = useState<{ id: string; value: Drive } | null>(null);
  const [driveStateFor, setDriveStateFor] = useState<{ id: string; value: string } | null>(null);
  const detail = detailFor?.id === selectedId ? detailFor.value : null;
  const elevation = elevationFor?.id === selectedId ? elevationFor.value : null;
  const detailRef = useRef<Detail | null>(null);
  const elevationRef = useRef<Elevation | "none" | null>(null);
  useEffect(() => { detailRef.current = detail; elevationRef.current = elevation; }, [detail, elevation]);
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
    if (!map || !client || map.getZoom() < 12 || !skiAreas.current.length) { setLines(EMPTY); return; }
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
      myTrails: "hy-mytrails",
    };
    const source = mapRef.current?.getSource(idMap[key]) as maplibregl.GeoJSONSource | undefined;
    source?.setData(data);
  }, []);

  // Sync layer visibility state with MapLibre layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    layersRef.current = layers;
    applyLayers(map, layers);
  }, [layers, ready]);

  // The visitor's saved trails as a map layer.
  useEffect(() => {
    setSource("myTrails", { type: "FeatureCollection", features: myTrails.filter((t) => t.geometry.length > 1).map((t) => ({ type: "Feature", properties: { id: t.id, name: t.name }, geometry: { type: "LineString", coordinates: t.geometry } })) });
  }, [myTrails, setSource]);


  const showRoute = useCallback((points: Point[]) => {
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

      // Hike features in view (water, camping, trailheads, viewpoints…); the layer toggles decide what shows.
      void fetchFeatures([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], undefined, signal).then((list) => {
        if (signal.aborted) return;
        setViewFeatures(list);
        setSource("pois", { type: "FeatureCollection", features: list.map((f) => ({ type: "Feature", properties: { id: f.id, type: f.type, group: featureGroup(f.type), name: f.name ?? "", label: featureName(f), source: f.source || "Mapped feature" }, geometry: { type: "Point", coordinates: [f.lon, f.lat] } })) });
      });
    } else {
      setSource("lines", EMPTY);
      setSource("pois", EMPTY);
      setViewFeatures([]);
    }
  }, [setSource]);

  // Map setup; the style is swapped in place when the basemap changes.
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    const startCenter = startView.center;
    const startZoom = startView.zoom;
    void explorerStyle(basemapRef.current).then((style) => {
      if (disposed || !containerRef.current) return;
      const map = new maplibregl.Map({ container: containerRef.current, style, center: startCenter, zoom: startZoom, maxPitch: 80, attributionControl: false, hash: false });
      mapRef.current = map;
      // Without a place in the URL or a last view, move to the visitor's location if the browser gives it quickly.
      if (startView.source === "timezone") void locateVisitor(3000).then((at) => { if (at && !disposed && !initial.trail) map.jumpTo({ center: at, zoom: 11 }); });
      map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Trails © <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors (ODbL), NPS, USFS, BLM, USGS, Parks Canada · <a href=\"/about/data\">Data sources</a>" }), "bottom-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "imperial", maxWidth: 90 }), "bottom-left");
      // Blue dot for the visitor's position; our "Show my location" button triggers it.
      const geolocate = new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true, timeout: 12_000 }, trackUserLocation: false, showUserLocation: true, showAccuracyCircle: true, fitBoundsOptions: { maxZoom: 12 } });
      map.addControl(geolocate, "bottom-right");
      geolocate.on("error", () => setLoadError("Location is off for this site. Allow it in your browser to see trails near you."));
      geolocateRef.current = geolocate;
      map.on("style.load", () => { installOverlay(map, sourcesRef.current); installExtras(map, extrasRef.current); applySectionFilter(map, sectionRef.current); applyLayers(map, layersRef.current); });
      map.on("load", () => {
        setReady(true);
        setMapInstance(map);
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
        saveLastView(c.lng, c.lat, map.getZoom());
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

      // While the route builder waits for a tap, the tap belongs to it.
      const select = (id: string) => { if (!pickingRef.current) setSelectedId(id); };
      map.on("click", "hy-pin", (e) => { const id = e.features?.[0]?.properties?.id; if (id) select(String(id)); });
      map.on("click", "hy-lines", (e) => { const id = e.features?.[0]?.properties?.id; if (id) select(String(id)); });
      map.on("click", "hy-thru-hikes", (e) => { const id = e.features?.[0]?.properties?.id; if (id) select(String(id)); });
      for (const layer of ["hy-feat-water", "hy-feat-camping", "hy-feat-other"]) {
        map.on("click", layer, (e) => {
          const f = e.features?.[0];
          if (!f || pickingRef.current || f.geometry.type !== "Point") return;
          new maplibregl.Popup({ closeButton: false, offset: 10, className: "hx-popup" })
            .setLngLat(f.geometry.coordinates as [number, number])
            .setDOMContent(featurePopup({ name: String(f.properties?.label ?? ""), type: String(f.properties?.type ?? ""), source: String(f.properties?.source ?? "OpenStreetMap") }))
            .addTo(map);
        });
      }
      map.on("click", "hy-mytrails", (e) => { const id = e.features?.[0]?.properties?.id; if (id && !pickingRef.current) routerRef.current.push(`/my/trails/${encodeURIComponent(String(id))}`); });
      map.on("click", "hy-ski-pistes", (e) => { const f = e.features?.[0]; if (f) openSkiRef.current(f); });
      const tappedOwn = (e: maplibregl.MapMouseEvent) => pickingRef.current || map.queryRenderedFeatures(e.point, { layers: ["hy-pin", "hy-lines", "hy-thru-hikes", "hy-ski-pistes", "hy-feat-water", "hy-feat-camping", "hy-feat-other", "hy-mytrails", "hy-ski-hit", "hy-ski-pin"].filter((l) => map.getLayer(l)) }).length > 0;
      map.on("click", "hy-ski-hit", (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ["hy-pin", "hy-lines", "hy-thru-hikes"] }).length) return;
        const f = e.features?.[0]; if (f) openSkiRef.current(f);
      });
      map.on("click", "hy-ski-pin", (e) => { const href = e.features?.[0]?.properties?.href; if (href) routerRef.current.push(href); });

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
        "hy-feat-water",
        "hy-feat-camping",
        "hy-feat-other",
        "hy-mytrails",
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

  // Pins for every ski area. Signed-in visitors read the account database's ski areas (with run maps); everyone
  // else gets the site's own OpenSkiMap list — the database table refuses signed-out reads, so it isn't asked.
  useEffect(() => {
    const client = createClient();
    let live = true;
    void (async () => {
      const rows: { slug: string | null; name: string; latitude: number; longitude: number; href: string }[] = [];
      const signedIn = client ? Boolean((await client.auth.getSession()).data.session) : false;
      for (let i = 0; client && signedIn && i < 7; i++) {
        const { data, error } = await client.from("ski_areas").select("slug,name,latitude,longitude").range(i * 1000, i * 1000 + 999);
        if (error || !data?.length) break;
        rows.push(...data.map((r) => ({ ...r, href: `/ski-areas/${r.slug}` })));
        if (data.length < 1000) break;
      }
      if (!rows.length) {
        const builtIn = await skiAreaRows(window.fetch.bind(window)).catch(() => []);
        rows.push(...builtIn.map((r) => ({ slug: null, name: r[1], latitude: r[3], longitude: r[2], href: `/explore/ski?area=${r[0]}` })));
      }
      if (!live) return;
      skiAreas.current = rows.flatMap((r) => (r.slug ? [{ slug: r.slug, lng: r.longitude, lat: r.latitude }] : []));
      const fc: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: rows.map((r) => ({ type: "Feature", properties: { href: r.href, name: r.name }, geometry: { type: "Point", coordinates: [r.longitude, r.latitude] } })) };
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
        if (is3dRef.current) { setThreeD(map, true); trailLine3d(map, true); }
        syncSelectedPin();
      });
    });
    return () => { live = false; };
  }, [basemap, syncSelectedPin]);

  // 3D: satellite imagery by default (the map style comes back when 3D is turned off), terrain, sky, no label
  // clutter, a thicker trail line, and a camera looking up the selected trail with all of it in view.
  const basemapBefore3d = useRef<Basemap | null>(null);
  useEffect(() => {
    is3dRef.current = is3d;
    const map = mapRef.current;
    if (!map || !ready) return;
    setThreeD(map, is3d);
    trailLine3d(map, is3d);
    if (is3d) {
      const lines = detailRef.current?.lines;
      const profile = elevationRef.current && elevationRef.current !== "none" ? elevationRef.current.profile : null;
      if (lines?.length) cameraUpTrail(map, lines as [number, number][][], profile);
      else map.easeTo({ pitch: PITCH_3D, zoom: Math.max(map.getZoom(), 11.5), duration: 900 });
    }
  }, [is3d, ready]);

  /** 3D on switches to satellite imagery; off brings the chosen style back. */
  const toggle3d = () => {
    if (!is3d && basemap !== "satellite" && basemap !== "hybrid") { basemapBefore3d.current = basemap; setBasemap("satellite"); }
    if (is3d && basemapBefore3d.current) { setBasemap(basemapBefore3d.current); basemapBefore3d.current = null; }
    setIs3d(!is3d);
  };

  // A trail picked while in 3D: look up it, with all of it in view.
  useEffect(() => {
    const map = mapRef.current;
    if (map && is3d && detail?.lines.length) cameraUpTrail(map, detail.lines, elevation && elevation !== "none" ? elevation.profile : null);
    // Only a newly loaded trail (or its profile) re-aims the camera; toggling 3D aims it above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, elevation]);

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
    // Best-documented first: real hikes (1 mi or more) before stubs, then nearest, discounted by the list score
    // (40 points halve the distance), so whole, well-sourced trails come before connectors that happen to be closer.
    const list = (points?.trails ?? []).map((t) => ({ t, real: (t[4] ?? 0) >= 1, km: distanceKm(center, [t[2], t[3]]) / (1 + Math.max(0, t[12] ?? t[8] ?? 0) / 40) }));
    list.sort((a, b) => Number(b.real) - Number(a.real) || a.km - b.km);
    const out = list.slice(0, TRAIL_CARD_LIMIT).map((x) => x.t);
    if (selectedId && !out.some((t) => t[0] === selectedId)) {
      const hit = points?.trails.find((t) => t[0] === selectedId);
      if (hit) out.unshift(hit);
      else if (detail?.trail.id === selectedId) {
        const t = detail.trail;
        const code = ({ easy: "e", moderate: "m", hard: "h", expert: "x" } as const)[trailDifficulty(t)];
        out.unshift([t.id, t.name, t.longitude, t.latitude, t.miles, code, t.park ?? t.forest ?? t.region, t.routeType ?? null, t.qualityScore ?? 0, t.gainFt ?? null, t.lossFt ?? null, t.steepestGradePct ?? null]);
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
      const p = filterParams({ ...filtersRef.current, difficulty: [], length: "", routeType: "", verified: false, dogs: false });
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
  const activeFilters = filters.difficulty.length + (filters.length ? 1 : 0) + (filters.routeType ? 1 : 0) + (filters.verified ? 1 : 0) + (filters.dogs ? 1 : 0);
  const selectedCard = cards.find((t) => t[0] === selectedId);
  const gain = elevation && elevation !== "none" ? effortClimbFt(elevation, detail?.trail.routeType) : null;

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
      <div className="hx-map">
        <div ref={containerRef} className="hx-map-canvas" role="region" aria-label="Trail map" />
        {!ready && (
          <div className="hx-loading" role="status">
            <div className="hx-loading-sheen" aria-hidden="true" />
            <p>Loading the map and trails…</p>
          </div>
        )}
      </div>

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
        <button type="button" className="hx-ctl hx-ctl--text" aria-pressed={is3d} aria-label={is3d ? "Show flat map" : "Show 3D terrain"} onClick={toggle3d}>3D</button>
        <button type="button" className="hx-ctl" aria-label="Build a route" title="Build a route" aria-pressed={routeOpen} onClick={() => { setRouteOpen((v) => !v); setSearchOpen(false); setSelectedId(null); }}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2.2" /><circle cx="18" cy="5" r="2.2" /><path d="M8 18.5h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" /></svg>
        </button>
        <div className="hx-pop-anchor">
          <button type="button" className="hx-ctl hx-ctl--text" aria-expanded={open === "layers"} onClick={() => setOpen(open === "layers" ? null : "layers")}>Maps</button>
          {open === "layers" && (
            <div className="hx-pop hx-pop--right hx-layers">
              <div className="hx-layer-grid" role="group" aria-label="Map style">
                {BASEMAPS.map(({ key, label, hint }) => (
                  <button key={key} type="button" className={`hx-layer hx-layer--${key}`} aria-pressed={basemap === key} title={hint} onClick={() => setBasemap(key)}>
                    <span className="hx-layer-swatch" aria-hidden="true" />
                    <span className="hx-layer-name">{label}</span>
                  </button>
                ))}
              </div>
              <p className="hx-pop-note">{BASEMAPS.find((b) => b.key === basemap)?.hint}</p>
              <div className="hx-layer-toggles">
                <label className="hx-check"><input type="checkbox" checked={layers.thruHikes} onChange={(e) => setLayers((l) => ({ ...l, thruHikes: e.target.checked }))} /> Long-distance trails</label>
                <label className="hx-check"><input type="checkbox" checked={layers.dayTrails} onChange={(e) => setLayers((l) => ({ ...l, dayTrails: e.target.checked }))} /> Day trails</label>
                <label className="hx-check"><input type="checkbox" checked={layers.ski} onChange={(e) => setLayers((l) => ({ ...l, ski: e.target.checked }))} /> Ski runs and lifts</label>
                <label className="hx-check"><input type="checkbox" checked={layers.water} onChange={(e) => setLayers((l) => ({ ...l, water: e.target.checked }))} /><span className="hx-dot" style={{ background: "#0284c7" }} /> Water</label>
                <label className="hx-check"><input type="checkbox" checked={layers.camping} onChange={(e) => setLayers((l) => ({ ...l, camping: e.target.checked }))} /><span className="hx-dot" style={{ background: "#d97706" }} /> Campsites and shelters</label>
                <label className="hx-check"><input type="checkbox" checked={layers.other} onChange={(e) => setLayers((l) => ({ ...l, other: e.target.checked }))} /><span className="hx-dot" style={{ background: "#475569" }} /> Trailheads, viewpoints, peaks, toilets</label>
                <label className="hx-check"><input type="checkbox" checked={layers.myTrails} onChange={(e) => setLayers((l) => ({ ...l, myTrails: e.target.checked }))} /><span className="hx-dot" style={{ background: "#8b5cf6" }} /> My trails</label>
              </div>
              {zoomedOut && (layers.water || layers.camping || layers.other) && <p className="hx-pop-note">Zoom in to see water and campsites.</p>}
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

      {routeOpen && (
        <RouteBuilder
          map={mapInstance}
          initialFrom={initial.routeFrom ?? null}
          center={center}
          viewFeatures={viewFeatures}
          onClose={() => setRouteOpen(false)}
          onRoute={showRoute}
          onPickingChange={onPickingChange}
        />
      )}

      <div className="hx-top">
        <div className="hx-chips" role="toolbar" aria-label="Trail filters">
          <div className="hx-pop-anchor">
            <button type="button" className="hx-chip hx-chip--section" aria-expanded={open === "section"} onClick={() => setOpen(open === "section" ? null : "section")}>
              <SectionIcon section={section.key} size={18} />
              {filters.activity === "all" ? "All trails" : filters.activity === section.activity ? section.label : CATALOG_ACTIVITY_LABELS[filters.activity]}
              <Caret />
            </button>
            {open === "section" && (
              <div className="hx-pop hx-pop--wide">
                <button type="button" className="hx-sub hx-sub--all" aria-pressed={filters.activity === "all"} onClick={() => setFilters((f) => ({ ...f, activity: "all" }))}>
                  All trails · every activity
                </button>
                <div className="hx-sections">
                  {TRAIL_SECTIONS.map((s) => (
                    <button key={s.key} type="button" className="hx-section" aria-pressed={filters.activity !== "all" && section.key === s.key} onClick={() => chooseSection(s.key)}>
                      <SectionIcon section={s.key} />
                      <span>{s.label}</span>
                    </button>
                  ))}
                </div>
                {filters.activity !== "all" && SUB_ACTIVITIES[section.key].length > 1 && (
                  <div className="hx-subs">
                    {SUB_ACTIVITIES[section.key].map((a) => (
                      <button key={a} type="button" className="hx-sub" aria-pressed={filters.activity === a} onClick={() => setFilters((f) => ({ ...f, activity: a }))}>
                        {ALL_LABEL[a] ?? CATALOG_ACTIVITY_LABELS[a]}
                      </button>
                    ))}
                  </div>
                )}
                <p className="hx-pop-note">{filters.activity === "all" ? "Hiking, biking, horse, snow and paddle trails together" : section.blurb}. Bike and horse access comes from official agency use records where they exist.</p>
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
          <button type="button" className="hx-chip" aria-pressed={filters.verified} onClick={() => setFilters((f) => ({ ...f, verified: !f.verified }))}>Verified</button>
          <button type="button" className="hx-chip" aria-pressed={filters.dogs} onClick={() => setFilters((f) => ({ ...f, dogs: !f.dogs }))}>Dogs allowed</button>
          {activeFilters > 0 && (
            <button type="button" className="hx-chip hx-chip--clear" onClick={() => setFilters((f) => ({ ...f, difficulty: [], length: "", routeType: "", verified: false, dogs: false }))}>
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

      <div className={`hx-rail-wrap${sheetOpen ? " is-open" : ""}${routeOpen ? " hx-rail-wrap--routing" : ""}`}>
        <button type="button" className="hx-sheet-handle" aria-expanded={sheetOpen} onClick={(e) => { setSheetOpen((v) => !v); e.currentTarget.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
          <span className="hx-sheet-grip" aria-hidden="true" />
          <span>{countLabel}</span>
          <small>{sheetOpen ? "Hide list" : "Show list"}</small>
        </button>
        <div className="hx-results-heading" aria-live="polite">
          <div><h2>{countLabel}</h2>{countDetail && <p>{countDetail}</p>}</div>
          {loading && <span className="hx-spinner" aria-hidden="true" />}
        </div>
        {myTrails.length > 0 && (
          <nav className="hx-mytrails" aria-label="My trails">
            <span>My trails</span>
            {myTrails.slice(0, 8).map((t) => (
              <Link key={t.id} className="hx-mytrail" href={`/my/trails/${encodeURIComponent(t.id)}`}>{t.name}<small>{fmtMiles(t.stats.miles)}</small></Link>
            ))}
          </nav>
        )}
        {cards.length > 0 ? (
          <div className="hx-rail" ref={railRef} role="list" aria-label="Trails in view, best-documented first">
            {cards.map((t) => {
              const [id, name, , , miles, d, place, routeType, , gainFt, lossFt, steepest] = t;
              const active = id === selectedId;
              const level = (({ e: "easy", m: "moderate", h: "hard", x: "expert" } as const)[d as "e"] ?? "moderate") as TrailDifficulty;
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
                  <TrailStats compact trail={{ miles, gainFt: gainFt ?? (active ? gain : null), lossFt, steepestGradePct: steepest, routeType: (routeType as RouteType | null) ?? null, difficulty: level, multiDay: (miles ?? 0) >= 50 }} />
                  {active && (
                    <div className="hx-card-more">
                      {elevation && elevation !== "none" && elevation.profile.length > 2 ? <ElevationChart e={elevation} /> : elevation === null ? <div className="hx-elev hx-elev--loading" aria-label="Loading elevation" /> : null}
                      {drive && (
                        <p className="hx-drive">Drive: <strong>{fmtDuration(drive.durationSeconds / 3600)}</strong> · {formatMeters(drive.distanceMeters)} to {start?.kind === "trail-end" ? "the trail" : start?.name ?? "the trailhead"}</p>
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

type LayerToggles = { thruHikes: boolean; dayTrails: boolean; ski: boolean; water: boolean; camping: boolean; other: boolean; myTrails: boolean };

/** Applies the layer toggles to the map (again after every basemap switch, which re-creates Hyked's layers). */
function applyLayers(map: maplibregl.Map, layers: LayerToggles) {
  setLayerGroupVisibility(map, "thru-hikes", layers.thruHikes);
  setLayerGroupVisibility(map, "day-trails", layers.dayTrails);
  setLayerGroupVisibility(map, "ski", layers.ski);
  setLayerGroupVisibility(map, "water", layers.water);
  setLayerGroupVisibility(map, "camping", layers.camping);
  setLayerGroupVisibility(map, "other", layers.other);
  setLayerGroupVisibility(map, "my-trails", layers.myTrails);
  setFeatureLabelGroups(map, (["water", "camping", "other"] as const).filter((g) => layers[g]));
}

/** Feature popups: name, type and source, as plain text nodes. */
function featurePopup(f: { name: string; type: string; source: string }) {
  const el = document.createElement("div");
  el.className = "hx-feature-pop";
  const strong = document.createElement("strong");
  strong.textContent = f.name;
  const small = document.createElement("small");
  small.textContent = `${FEATURE_LABELS[f.type] ?? f.type} · ${f.source}`;
  el.append(strong, small);
  return el;
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
        <span>{formatElevation(e.minFt)}–{formatElevation(e.maxFt)}</span>
        <span>{formatElevation(e.gainFt)} up · {formatElevation(e.lossFt)} down{e.partial ? " (partial)" : ""}</span>
      </figcaption>
    </figure>
  );
}
