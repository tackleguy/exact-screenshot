"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { bridgeTrailGaps, trailGaps, type BridgedLine } from "@/lib/routing/bridge";
import { CatalogMapView } from "./CatalogMapView";
import type { MapPin } from "./CatalogMapViewGl";
import {
  appleMapsDirectionsUrl,
  googleMapsDirectionsUrl,
  trailEnds,
  type AccessPoint,
} from "@/lib/trail-catalog/access";
import { formatDistance, MILE_METERS } from "@/lib/trail-catalog/quality";
import { geolocationErrorMessage, isGeolocationSupported } from "@/lib/geolocation";

type Lines = [number, number][][];
interface Route { distanceMeters: number; durationSeconds: number; line: [number, number][]; steps: { instruction: string; distanceMeters: number }[]; attribution: string }
interface Origin { latitude: number; longitude: number; label: string }

const KIND_LABEL: Record<AccessPoint["kind"], string> = { trailhead: "Trailhead", parking: "Parking", "trail-end": "Trail end" };

function describe(point: AccessPoint) {
  const kind = KIND_LABEL[point.kind];
  const name = point.name ? `${point.name} (${kind.toLowerCase()})` : kind;
  return point.kind === "trail-end" ? name : `${name}, ${formatDistance(point.toTrailMeters / MILE_METERS).primary} from the trail`;
}

function duration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** The trail map, then `children` (the elevation profile), then directions folded away until opened. */
export function TrailMapAndDirections({ name, trailId, lines, trailhead, landManager, children, gapsExplained = false }: { name: string; trailId?: string; miles?: number | null; /** The page already warns about gaps in the line (don't say it twice). */ gapsExplained?: boolean; lines: Lines; trailhead?: AccessPoint; landManager?: { name: string | null; url: string | null }; children?: ReactNode }) {
  const [startIndex, setStartIndex] = useState(0);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<{ id: string; name: string; latitude: number; longitude: number }[]>([]);
  // Gaps in the mapped line, joined along real mapped paths where there are some (src/lib/routing/bridge.ts).
  const gapCount = useMemo(() => trailGaps(lines).length, [lines]);
  const [bridged, setBridged] = useState<{ lines: Lines; result: BridgedLine } | null>(null);
  useEffect(() => {
    if (!gapCount) return;
    const controller = new AbortController();
    bridgeTrailGaps(lines, { signal: controller.signal }).then((result) => { if (!controller.signal.aborted) setBridged({ lines, result }); }).catch(() => undefined);
    return () => controller.abort();
  }, [lines, gapCount]);
  const joined = bridged?.lines === lines ? bridged.result : null;

  // Start options: the mapped OSM trailhead (found at catalog build time), then the trail's two ends.
  const options = useMemo<AccessPoint[]>(() => {
    const ends = trailEnds(lines);
    const out: AccessPoint[] = trailhead && trailhead.kind !== "trail-end" ? [trailhead] : [];
    if (ends) {
      ends.forEach(([longitude, latitude], i) => out.push({ kind: "trail-end", name: i === 0 ? "One end" : "Other end", latitude, longitude, toTrailMeters: 0 }));
    }
    return out;
  }, [trailhead, lines]);
  const start = options[startIndex] ?? null;

  const pins = useMemo<MapPin[]>(() => {
    const out: MapPin[] = options
      .filter((p, i) => i !== startIndex && p.kind !== "trail-end")
      .map((p) => ({ latitude: p.latitude, longitude: p.longitude, label: describe(p), kind: "option" }));
    if (start) out.push({ latitude: start.latitude, longitude: start.longitude, label: `Start: ${describe(start)}`, kind: "start" });
    if (origin) out.push({ latitude: origin.latitude, longitude: origin.longitude, label: origin.label, kind: "origin" });
    return out;
  }, [options, startIndex, start, origin]);

  async function routeFrom(from: Origin) {
    if (!start) return;
    setOrigin(from);
    setRoute(null);
    setBusy(true);
    setStatus("Finding a driving route…");
    try {
      const response = await fetch(`/api/directions?${new URLSearchParams({ from: `${from.latitude},${from.longitude}`, to: `${start.latitude},${start.longitude}` })}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Directions are unavailable.");
      setRoute(data as Route);
      setStatus("");
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function fromMyLocation() {
    if (!isGeolocationSupported()) { setStatus("This browser can’t share your location. Search for a starting place instead."); return; }
    setBusy(true);
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (position) => void routeFrom({ latitude: position.coords.latitude, longitude: position.coords.longitude, label: "Your location" }),
      (error) => { setBusy(false); setStatus(geolocationErrorMessage(error)); },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    );
  }

  async function searchPlaces(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setStatus("Searching…");
    try {
      const response = await fetch(`/api/assistant/places?${new URLSearchParams({ q: query.trim() })}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Place search is unavailable.");
      setPlaces(data.places ?? []);
      setStatus(data.places?.length ? "" : "No U.S. or Canadian place matched. Try a town or address.");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  return (
    <>
      <CatalogMapView lines={lines} links={joined?.links} route={route?.line} pins={pins} name={name} trailId={trailId} />
      {joined && (joined.links.length > 0 || (joined.sections > 1 && !gapsExplained)) && (
        <p className="trail-gaps-note">
          {joined.links.length > 0 && <>{joined.links.length === 1 ? "One gap in the mapped line is" : `${joined.links.length} gaps in the mapped line are`} joined along connecting paths (dashed). </>}
          {joined.sections > 1 && !gapsExplained && <>The trail is mapped in {joined.sections} sections; the map data doesn’t connect {joined.sections === 2 ? "them" : "all of them"}, so check the route on the ground.</>}
        </p>
      )}
      {children}
      <details className="trail-more catalog-directions">
        <summary><span>Getting there</span><small>Trailhead, parking and driving directions</small></summary>
        {start && (
          <div className="catalog-directions-grid">
            <div>
              <h3>Where to go</h3>
              <label className="catalog-muted" htmlFor="trail-start">Start point</label>{" "}
              <select id="trail-start" value={startIndex} onChange={(e) => { setStartIndex(Number(e.target.value)); setRoute(null); }}>
                {options.map((p, i) => <option key={`${p.kind}-${p.latitude}-${p.longitude}`} value={i}>{describe(p)}</option>)}
              </select>
              <p className="catalog-muted">
                {start.latitude.toFixed(5)}, {start.longitude.toFixed(5)}
                {start.osmUrl && <> · <a href={start.osmUrl} target="_blank" rel="noopener noreferrer">Map record</a></>}
                {start.officialUrl && <> · <a href={start.officialUrl} target="_blank" rel="noopener noreferrer">Forest Service page</a></>}
              </p>
              {start.water && <p className="catalog-muted">Water at the trailhead (Forest Service): {start.water}</p>}
              {start.closestTowns && <p className="catalog-muted">Closest towns (Forest Service): {start.closestTowns}</p>}
              {trailhead ? (
                <p>Start at <strong>{describe(trailhead)}</strong>.</p>
              ) : (
                <p>
                  No mapped trailhead — check the land manager’s page for access and parking
                  {landManager?.url ? <>: <a href={landManager.url} target="_blank" rel="noopener noreferrer">{landManager.name ?? "land manager"}</a></> : "."}
                </p>
              )}
              <div className="catalog-directions-actions">
                <a className="catalog-button" href={googleMapsDirectionsUrl(start.latitude, start.longitude)} target="_blank" rel="noopener noreferrer">
                  Open in Google Maps
                </a>
                <a className="catalog-button secondary" href={appleMapsDirectionsUrl(start.latitude, start.longitude, start.name ?? name)} target="_blank" rel="noopener noreferrer">
                  Apple Maps
                </a>
              </div>
            </div>
            <div>
              <h3>Directions</h3>
              <div className="catalog-directions-actions">
                <button type="button" className="catalog-button secondary" onClick={fromMyLocation} disabled={busy}>
                  From my location
                </button>
              </div>
              <form onSubmit={searchPlaces} className="catalog-directions-actions">
                <label htmlFor="directions-from" className="sr-only">Starting place</label>
                <input id="directions-from" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Or start from a town or address" maxLength={150} />
                <button type="submit" className="catalog-button secondary" disabled={busy}>Search</button>
              </form>
              {places.length > 0 && (
                <ul className="catalog-directions-actions">
                  {places.map((place) => (
                    <li key={place.id}>
                      <button type="button" className="catalog-link" onClick={() => { setPlaces([]); void routeFrom({ latitude: place.latitude, longitude: place.longitude, label: place.name }); }}>
                        {place.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {status && <p className="catalog-muted" role="status">{status}</p>}
              {route && origin && (
                <>
                  <p>
                    <strong>{formatDistance(route.distanceMeters / MILE_METERS).primary} · about {duration(route.durationSeconds)}</strong> driving from {origin.label}.
                  </p>
                  <ol className="catalog-directions-steps">
                    {route.steps.map((step, i) => (
                      <li key={i}>
                        {step.instruction}
                        {step.distanceMeters > 0 && <span>{formatDistance(step.distanceMeters / MILE_METERS).primary}</span>}
                      </li>
                    ))}
                  </ol>
                  <p className="catalog-muted">
                    {route.attribution}. Roads to trailheads can be seasonal, gated or unpaved; check with the land manager.{" "}
                    <a href={`https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", origin: `${origin.latitude},${origin.longitude}`, destination: `${start.latitude},${start.longitude}` })}`} target="_blank" rel="noopener noreferrer">
                      Continue in Google Maps
                    </a>
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </details>
    </>
  );
}
