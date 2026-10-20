"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CatalogBounds, CatalogMapPoint, CatalogMapResult, CatalogTrail } from "@/lib/trail-catalog/types";
import { displayMiles, trailPlace } from "@/lib/trail-catalog/types";
import { normalizeLongitude } from "@/lib/trail-catalog/map";
import { CatalogPhotos } from "./CatalogPhotos";

const TILE_URL =
  process.env.NEXT_PUBLIC_CATALOG_TILE_URL ??
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_CATALOG_TILE_ATTRIBUTION ??
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

function viewportBounds(map: L.Map): CatalogBounds {
  const bounds = map.getBounds();
  const fullWorld = bounds.getEast() - bounds.getWest() >= 360;
  return [
    fullWorld ? -180 : normalizeLongitude(bounds.getWest()),
    Math.max(-90, bounds.getSouth()),
    fullWorld ? 180 : normalizeLongitude(bounds.getEast()),
    Math.min(90, bounds.getNorth()),
  ];
}

function catalogFitBounds(map: L.Map, bounds: CatalogBounds, options?: L.FitBoundsOptions) {
  map.fitBounds(
    [
      [bounds[1], bounds[0]],
      [bounds[3], bounds[2]],
    ],
    { padding: [64, 64], maxZoom: 18, animate: false, ...options },
  );
}

export function CatalogExplorerMap({ initialData, query }: { initialData: CatalogMapResult | null; query: string }) {
  const router = useRouter();
  const startingBounds = useMemo<CatalogBounds | null>(() => {
    const params = new URLSearchParams(query);
    return ["q", "country", "region", "bbox"].some(key => params.get(key)?.trim())
      ? initialData?.bounds ?? null : [-141, 24, -52, 72];
  }, [initialData, query]);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const clearGeometryRef = useRef<(() => void) | null>(null);
  const selectionAbort = useRef<AbortController | null>(null);
  const selectedHeading = useRef<HTMLHeadingElement>(null);
  const [data, setData] = useState(initialData);
  const [area, setArea] = useState<CatalogBounds | null>(null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState("");
  const [tileError, setTileError] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [selected, setSelected] = useState<CatalogTrail | null>(null);
  const [geometryStatus, setGeometryStatus] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationStatus, setLocationStatus] = useState("");

  useEffect(() => {
    if (!container.current) return;
    let alive = true;
    let request: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let markers: L.Marker[] = [];
    let sectionLayers: L.Polyline[] = [];
    let map: L.Map;

    function clearSectionGeometry() {
      sectionLayers.forEach(layer => layer.remove());
      sectionLayers = [];
    }
    clearGeometryRef.current = clearSectionGeometry;

    try {
      map = L.map(container.current, {
        center: [48, -100],
        zoom: 2,
        maxZoom: 18,
        zoomControl: false,
        attributionControl: true,
      });
      const tiles = L.tileLayer(TILE_URL, {
        attribution: TILE_ATTRIBUTION,
        maxZoom: 19,
      }).addTo(map);
      tiles.on("tileerror", () => {
        if (alive) setTileError(true);
      });
      L.control.zoom({ position: "topright" }).addTo(map);
    } catch {
      queueMicrotask(() => setMapUnavailable(true));
      return;
    }
    mapRef.current = map;
    map.getContainer().setAttribute(
      "aria-label",
      "Trail map. Use arrow keys to pan and plus or minus to zoom. Trail results are also available below.",
    );
    const fit = (bounds: CatalogBounds) => catalogFitBounds(map, bounds);
    if (startingBounds) fit(startingBounds);

    function selectTrail(trail: CatalogTrail) {
      selectionAbort.current?.abort();
      const controller = new AbortController();
      selectionAbort.current = controller;
      setSelected(trail);
      setGeometryStatus("Loading the trail’s route line…");
      clearSectionGeometry();
      void (async () => {
        try {
          const response = await fetch(`/api/trail-catalog/${encodeURIComponent(trail.id)}`, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
          });
          if (!response.ok) throw new Error("Geometry unavailable");
          const detail = await response.json() as { lines: [number, number][][] };
          if (!alive || controller.signal.aborted) return;
          clearSectionGeometry();
          const routeBounds = L.latLngBounds([]);
          for (const line of detail.lines) {
            if (line.length < 2) continue;
            const latlngs = line.map(([lon, lat]) => L.latLng(lat, lon));
            sectionLayers.push(
              L.polyline(latlngs, { color: "#ffffff", weight: 7, opacity: 1, interactive: false }).addTo(map),
            );
            sectionLayers.push(
              L.polyline(latlngs, { color: "#245b47", weight: 4, opacity: 1, interactive: false }).addTo(map),
            );
            latlngs.forEach(point => routeBounds.extend(point));
          }
          if (routeBounds.isValid()) {
            map.fitBounds(routeBounds, { padding: [64, 64], maxZoom: 16, animate: false });
          }
          setGeometryStatus("Route line shown from the source record.");
        } catch {
          if (alive && !controller.signal.aborted) {
            setGeometryStatus("Route line could not load. Open section details for its source and try again.");
          }
        }
      })();
    }

    function renderMarkers(next: CatalogMapResult) {
      // Return keyboard focus to the map if a focused marker is replaced after panning.
      const markerFocused = markers.some(marker => marker.getElement()?.contains(document.activeElement) ?? false);
      markers.forEach(marker => marker.remove());
      // Merge nearby server groups in screen space so touch targets never overlap.
      // Recalculate after every pan/zoom; counts and original extents are preserved.
      const groups = next.points.map(point => ({
        point,
        screen: map.latLngToContainerPoint([point.latitude, point.longitude]),
      }));
      let merged = true;
      while (merged) {
        merged = false;
        outer: for (let a = 0; a < groups.length; a++) {
          for (let b = a + 1; b < groups.length; b++) {
            const first = groups[a], second = groups[b];
            if (Math.hypot(first.screen.x - second.screen.x, first.screen.y - second.screen.y) >= 78) continue;
            const extent = (point: CatalogMapPoint): CatalogBounds =>
              point.bounds ?? [point.longitude, point.latitude, point.longitude, point.latitude];
            const one = extent(first.point), two = extent(second.point);
            const shift = Math.round((one[0] - two[0]) / 360) * 360;
            const bounds: CatalogBounds = [
              Math.min(one[0], two[0] + shift),
              Math.min(one[1], two[1]),
              Math.max(one[2], two[2] + shift),
              Math.max(one[3], two[3]),
            ];
            const count = first.point.count + second.point.count;
            const screen = L.point(
              (first.screen.x * first.point.count + second.screen.x * second.point.count) / count,
              (first.screen.y * first.point.count + second.screen.y * second.point.count) / count,
            );
            const center = map.containerPointToLatLng(screen);
            groups[a] = {
              point: { id: first.point.id, count, bounds, longitude: center.lng, latitude: center.lat },
              screen,
            };
            groups.splice(b, 1);
            merged = true;
            break outer;
          }
        }
      }
      const size = map.getSize();
      markers = groups
        .filter(({ screen }) => screen.x >= 40 && screen.x <= size.x - 40 && screen.y >= 40 && screen.y <= size.y - 40)
        .map(({ point }) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = point.count > 1 ? "catalog-cluster" : "catalog-trail-pin";
          if (point.count > 1) {
            button.textContent = point.count.toLocaleString("en-US");
            button.setAttribute("aria-label", `Zoom to ${point.count.toLocaleString("en-US")} trail sections`);
            button.addEventListener("click", () => {
              if (!point.bounds) return;
              if (map.getZoom() >= 17.9) {
                const params = new URLSearchParams(query);
                const [west, south, east, north] = point.bounds;
                params.set(
                  "bbox",
                  [
                    normalizeLongitude(west - 0.00001),
                    south - 0.00001,
                    normalizeLongitude(east + 0.00001),
                    north + 0.00001,
                  ].join(","),
                );
                params.set("limit", "24");
                params.delete("page");
                router.push(`/explore/trails?${params}`);
              } else {
                fit(point.bounds);
              }
            });
            if (map.getZoom() >= 17.9) {
              button.setAttribute("aria-label", `List ${point.count.toLocaleString("en-US")} overlapping trail sections`);
            }
          } else if (point.trail) {
            const trail = point.trail;
            button.textContent = "";
            button.title = trail.name;
            button.setAttribute("aria-label", `Show ${trail.name}, ${displayMiles(trail.miles)}`);
            button.addEventListener("click", () => selectTrail(trail));
          }
          const sizePx = point.count > 1 ? 44 : 36;
          const marker = L.marker([point.latitude, point.longitude], {
            icon: L.divIcon({
              className: "hikesync-leaflet-marker",
              html: button,
              iconSize: [sizePx, sizePx],
              iconAnchor: [sizePx / 2, sizePx / 2],
            }),
            keyboard: false,
            riseOnHover: true,
          }).addTo(map);
          // Clusters grow with digit count; let the icon wrap size to the button.
          if (point.count > 1) {
            const el = marker.getElement();
            if (el) {
              el.style.width = "auto";
              el.style.height = "auto";
              const width = el.offsetWidth || sizePx;
              const height = el.offsetHeight || sizePx;
              el.style.marginLeft = `${-width / 2}px`;
              el.style.marginTop = `${-height / 2}px`;
            }
          }
          return marker;
        });
      if (markerFocused) map.getContainer().focus();
    }

    async function loadArea() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const bounds = viewportBounds(map);
      const params = new URLSearchParams(query);
      params.delete("page");
      params.delete("limit");
      params.set("bbox", bounds.map(value => value.toFixed(5)).join(","));
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/trail-catalog/map?${params}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        });
        if (!response.ok) throw new Error("Map search unavailable");
        const next = await response.json() as CatalogMapResult;
        if (!alive || controller.signal.aborted) return;
        setData(next);
        setArea(bounds);
        renderMarkers(next);
      } catch {
        if (alive && !controller.signal.aborted) {
          setError("Couldn’t update this map area. The previous results are still shown.");
        }
      } finally {
        if (alive && !controller.signal.aborted) setLoading(false);
      }
    }
    refreshRef.current = () => void loadArea();
    const move = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void loadArea(), 300);
    };
    if (initialData) renderMarkers(initialData);
    void loadArea();
    map.on("moveend", move);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => {
      alive = false;
      clearTimeout(timer);
      request?.abort();
      selectionAbort.current?.abort();
      observer.disconnect();
      markers.forEach(marker => marker.remove());
      clearSectionGeometry();
      clearGeometryRef.current = null;
      map.remove();
      mapRef.current = null;
      refreshRef.current = null;
    };
  }, [initialData, query, router, startingBounds]);

  useEffect(() => {
    if (selected) selectedHeading.current?.focus();
  }, [selected]);

  function locate() {
    if (!navigator.geolocation) {
      setLocationStatus("Location is unavailable in this browser. Search a place or move the map instead.");
      return;
    }
    setLocating(true);
    setLocationStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      position => {
        setLocating(false);
        setLocationStatus("Map centered near your location. Explore the pins or list this area.");
        mapRef.current?.setView([position.coords.latitude, position.coords.longitude], 11);
      },
      geoError => {
        setLocating(false);
        setLocationStatus(
          geoError.code === 1
            ? "Location permission was declined. You can search a place or move the map instead."
            : "Your location could not be found. Try again or search a place.",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  const listParams = new URLSearchParams(query);
  listParams.delete("page");
  listParams.set("limit", "24");
  if (area) listParams.set("bbox", area.map(value => value.toFixed(5)).join(","));

  return (
    <section className="catalog-explorer-map" aria-label="Explore trail sections on the map">
      <div className="catalog-map-toolbar">
        <p role="status" aria-atomic="true">
          {loading
            ? "Updating map…"
            : data
              ? `${data.total.toLocaleString("en-US")} ${data.total === 1 ? "trail" : "trails"} ${area ? "in this map area" : "matching your search"}`
              : "Map search unavailable"}
        </p>
        <div>
          <button type="button" onClick={locate} disabled={locating || mapUnavailable}>
            {locating ? "Locating…" : "Near me"}
          </button>
          <button
            type="button"
            disabled={mapUnavailable}
            onClick={() => {
              if (startingBounds && mapRef.current) catalogFitBounds(mapRef.current, startingBounds);
            }}
          >
            Reset map
          </button>
          <Link href={`/explore/trails?${listParams}`}>List this area</Link>
        </div>
      </div>
      <p className="catalog-map-help" id="catalog-map-help">
        Zoom in to reveal trails. Select a pin for its route line and details. Pins mark a point on the trail, not a verified trailhead.
      </p>
      <div ref={container} className="catalog-map-canvas catalog-discovery-canvas" aria-describedby="catalog-map-help" />
      {mapUnavailable && (
        <p role="status" className="catalog-map-error">
          Your browser couldn’t start the interactive map. Use the trail list below to explore the same catalog.
        </p>
      )}
      {tileError && (
        <p className="catalog-map-error">
          Some background map tiles could not load. Trail records remain available.{" "}
          <button type="button" onClick={() => window.location.reload()}>Reload map</button>
        </p>
      )}
      {error && (
        <p className="catalog-map-error" role="status">
          {error} <button type="button" onClick={() => refreshRef.current?.()}>Try again</button>
        </p>
      )}
      {locationStatus && <p className="catalog-muted" role="status">{locationStatus}</p>}
      {selected && (
        <article className="catalog-map-selection" aria-labelledby="selected-trail-title">
          <div className="catalog-selection-heading">
            <div>
              <h2 id="selected-trail-title" ref={selectedHeading} tabIndex={-1}>{selected.name}</h2>
              <p>{selected.region} · {displayMiles(selected.miles)} · {trailPlace(selected)}</p>
            </div>
            <button
              type="button"
              aria-label="Close selected trail"
              onClick={() => {
                selectionAbort.current?.abort();
                setSelected(null);
                clearGeometryRef.current?.();
                mapRef.current?.getContainer().focus();
              }}
            >
              Close
            </button>
          </div>
          <p className="catalog-muted" role="status">{geometryStatus}</p>
          <div className="catalog-selection-actions">
            <Link className="catalog-button" href={`/explore/trails/${encodeURIComponent(selected.id)}`}>
              Section details
            </Link>
            <a className="catalog-link" href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">
              Original source
            </a>
          </div>
          <CatalogPhotos key={selected.id} trailId={selected.id} compact />
        </article>
      )}
    </section>
  );
}
