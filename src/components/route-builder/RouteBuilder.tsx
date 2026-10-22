"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "@/lib/maplibre";
import { buildRoute, RouteError, type BuiltRoute, type LngLat } from "@/lib/routing";
import { FEATURE_LABELS, featureGroup, featureName, type HikeFeature } from "@/lib/routing/features";
import { splitDays } from "@/lib/routing/days";
import { downloadGpx, routeGpx } from "@/lib/routing/gpx";
import { savePersonalTrail, type PersonalTrail } from "@/lib/personal-trails";
import { noteGuestProgress } from "@/components/nav/GuestSaveBanner";
import { TrailElevationProfile } from "@/components/trails/TrailElevationProfile";
import { duration, feet, join, miles as fmtMiles } from "@/lib/display";
import { MILE_METERS, metersBetween } from "@/lib/geo/line";
import "./route-builder.css";

export interface Stop { key: string; point: LngLat; label: string }
type Slot = "start" | "end" | "via";

let keySeq = 0;
const stopKey = () => `s${++keySeq}`;
const mapPointLabel = (p: LngLat) => `Map point ${p[1].toFixed(4)}, ${p[0].toFixed(4)}`;

/** The point `mile` miles along a line. */
function pointAtMile(coords: LngLat[], mile: number): LngLat {
  const target = mile * MILE_METERS;
  let at = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = metersBetween(coords[i - 1], coords[i]);
    if (at + d >= target) {
      const t = d ? (target - at) / d : 0;
      return [coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]), coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1])];
    }
    at += d;
  }
  return coords[coords.length - 1];
}

export interface RouteBuilderProps {
  map: maplibregl.Map | null;
  initialFrom: { point: LngLat; name: string } | null;
  /** Map centre, to rank place search results near the view. */
  center: LngLat;
  /** Hike features loaded for the current view (named ones are searchable as start/end). */
  viewFeatures: HikeFeature[];
  onClose: () => void;
  /** Draws (or, with [], clears) the route line on the map. */
  onRoute: (coords: LngLat[]) => void;
  /** True while the next map tap sets a route point, so the map doesn't also select a trail. */
  onPickingChange: (picking: boolean) => void;
}

export function RouteBuilder({ map, initialFrom, center, viewFeatures, onClose, onRoute, onPickingChange }: RouteBuilderProps) {
  const [start, setStart] = useState<Stop | null>(() => (initialFrom ? { key: stopKey(), point: initialFrom.point, label: initialFrom.name } : null));
  const [end, setEnd] = useState<Stop | null>(null);
  const [via, setVia] = useState<Stop[]>([]);
  const [connectors, setConnectors] = useState(false);
  const [picking, setPicking] = useState<Slot | null>(initialFrom ? "end" : "start");
  const [route, setRoute] = useState<BuiltRoute | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [daily, setDaily] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saved, setSaved] = useState<PersonalTrail | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function run(next: { start: Stop | null; via: Stop[]; end: Stop | null; connectors: boolean }) {
    abortRef.current?.abort();
    setSaved(null);
    if (!next.start || !next.end) { setRoute(null); setError(""); setBusy(false); onRoute([]); return; }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError("");
    buildRoute([next.start.point, ...next.via.map((v) => v.point), next.end.point], { connectors: next.connectors, signal: controller.signal })
      .then((r) => {
        if (controller.signal.aborted) return;
        setRoute(r);
        onRoute(r.coordinates);
        noteGuestProgress();
        const bounds = new maplibregl.LngLatBounds();
        for (const p of r.coordinates) bounds.extend(p);
        const narrow = window.innerWidth < 768;
        map?.fitBounds(bounds, { padding: narrow ? { top: 80, bottom: 300, left: 30, right: 30 } : { top: 90, bottom: 80, left: 440, right: 60 }, maxZoom: 15, duration: 700 });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setRoute(null);
        onRoute([]);
        setError(e instanceof RouteError ? e.message : "The route couldn’t be built. Try again.");
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
  }
  function apply(patch: Partial<{ start: Stop | null; via: Stop[]; end: Stop | null; connectors: boolean }>) {
    const next = { start, via, end, connectors, ...patch };
    if ("start" in patch) setStart(next.start);
    if ("end" in patch) setEnd(next.end);
    if ("via" in patch) setVia(next.via);
    if ("connectors" in patch) setConnectors(next.connectors);
    run(next);
  }
  function setSlot(slot: Slot, stop: Stop) {
    setPicking(slot === "start" && !end ? "end" : null);
    if (slot === "start") apply({ start: stop });
    else if (slot === "end") apply({ end: stop });
    else apply({ via: [...via, stop] });
  }

  // Map handlers see the latest state through these refs, refreshed after each render.
  const applyRef = useRef(apply);
  const setSlotRef = useRef(setSlot);
  const stateRef = useRef({ start, via, end, route });
  useEffect(() => { applyRef.current = apply; setSlotRef.current = setSlot; stateRef.current = { start, via, end, route }; });

  useEffect(() => { onPickingChange(picking !== null); }, [picking, onPickingChange]);
  useEffect(() => () => { abortRef.current?.abort(); onPickingChange(false); onRoute([]); }, [onPickingChange, onRoute]);

  // Tap the map to set the waiting point; a tapped hike feature lends its name.
  useEffect(() => {
    if (!map || !picking) return;
    const canvas = map.getCanvas();
    canvas.style.cursor = "crosshair";
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const layers = ["hy-feat-water", "hy-feat-camping", "hy-feat-other"].filter((l) => map.getLayer(l));
      const hit = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : undefined;
      const point: LngLat = hit?.geometry.type === "Point" ? (hit.geometry.coordinates as LngLat) : [e.lngLat.lng, e.lngLat.lat];
      const label = hit ? String(hit.properties?.label ?? "Map point") : mapPointLabel(point);
      setSlotRef.current(picking, { key: stopKey(), point, label });
    };
    map.on("click", onClick);
    return () => { map.off("click", onClick); canvas.style.cursor = ""; };
  }, [map, picking]);

  // Draggable markers for start, waypoints and end; mid-leg handles drag the line to reroute.
  useEffect(() => {
    if (!map) return;
    const markers: maplibregl.Marker[] = [];
    const ordered = [start, ...via, end].filter((s): s is Stop => Boolean(s));
    ordered.forEach((stop, i) => {
      const el = document.createElement("div");
      const isStart = stop === start, isEnd = stop === end;
      el.className = `rb-marker ${isStart ? "rb-marker--start" : isEnd ? "rb-marker--end" : "rb-marker--via"}`;
      el.textContent = isStart ? "A" : isEnd ? "B" : String(i);
      el.setAttribute("aria-label", `${isStart ? "Start" : isEnd ? "End" : `Waypoint ${i}`}: ${stop.label}. Drag to move.`);
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(stop.point).addTo(map);
      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        const moved: Stop = { key: stop.key, point: [lng, lat], label: mapPointLabel([lng, lat]) };
        const s = stateRef.current;
        if (stop.key === s.start?.key) applyRef.current({ start: moved });
        else if (stop.key === s.end?.key) applyRef.current({ end: moved });
        else applyRef.current({ via: s.via.map((v) => (v.key === stop.key ? moved : v)) });
      });
      markers.push(marker);
    });
    if (route && start && end) {
      const legStarts = [0, ...route.legEndsMile.slice(0, -1)];
      route.legEndsMile.forEach((legEnd, i) => {
        const el = document.createElement("div");
        el.className = "rb-handle";
        el.title = "Drag to route through another trail";
        const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(pointAtMile(route.coordinates, (legStarts[i] + legEnd) / 2)).addTo(map);
        marker.on("dragend", () => {
          const { lng, lat } = marker.getLngLat();
          const s = stateRef.current;
          const nextVia = [...s.via];
          nextVia.splice(i, 0, { key: stopKey(), point: [lng, lat], label: mapPointLabel([lng, lat]) });
          applyRef.current({ via: nextVia });
        });
        markers.push(marker);
      });
    }
    return () => { for (const m of markers) m.remove(); };
  }, [map, start, via, end, route]);

  function reverse() { apply({ start: end, end: start, via: [...via].reverse() }); }
  function clear() { setPicking("start"); apply({ start: null, end: null, via: [] }); }
  function removeLeg(i: number) {
    // Removing leg i drops the stop at its far end (the end point itself only when it's the last leg).
    const ordered = [start, ...via, end];
    if (i + 1 === ordered.length - 1) {
      if (via.length) apply({ end: via[via.length - 1], via: via.slice(0, -1) });
      else apply({ end: null });
    } else apply({ via: via.filter((_, j) => j !== i) });
  }

  const target = Number(daily);
  const days = route && Number.isFinite(target) && target > 0 ? splitDays(route.miles, route.features, target) : null;
  const water = route?.features.filter((f) => featureGroup(f.type) === "water").length ?? 0;
  const camps = route?.features.filter((f) => featureGroup(f.type) === "camping").length ?? 0;

  return (
    <section className="rb-panel" aria-label="Route builder">
      <header className="rb-head">
        <h2>Build a route</h2>
        <button type="button" className="rb-x" aria-label="Close route builder" onClick={onClose}>×</button>
      </header>
      <p className="rb-help">Set a start and an end: search, use your location, or tap the map. The route follows mapped trails only.</p>
      <ol className="rb-stops">
        <li><PlaceSearch slot="start" label="Start" stop={start} picking={picking === "start"} center={center} viewFeatures={viewFeatures} onPick={(s) => setSlot("start", s)} onTapMap={() => setPicking(picking === "start" ? null : "start")} /></li>
        {via.map((v, i) => (
          <li key={v.key} className="rb-via">
            <span className="rb-via-dot" aria-hidden="true">{i + 1}</span>
            <span className="rb-via-label">{v.label}</span>
            <button type="button" className="rb-link" onClick={() => apply({ via: via.filter((x) => x.key !== v.key) })} aria-label={`Remove waypoint ${i + 1}`}>Remove</button>
          </li>
        ))}
        <li><PlaceSearch slot="end" label="End" stop={end} picking={picking === "end"} center={center} viewFeatures={viewFeatures} onPick={(s) => setSlot("end", s)} onTapMap={() => setPicking(picking === "end" ? null : "end")} /></li>
      </ol>
      <div className="rb-row">
        <button type="button" className="hx-btn" aria-pressed={picking === "via"} disabled={!start || !end} onClick={() => setPicking(picking === "via" ? null : "via")}>{picking === "via" ? "Tap the map…" : "+ Waypoint"}</button>
        <button type="button" className="hx-btn" disabled={!start || !end} onClick={reverse}>Reverse</button>
        <button type="button" className="hx-btn" disabled={!start && !end} onClick={clear}>Clear</button>
      </div>
      <label className="hx-check rb-check"><input type="checkbox" checked={connectors} onChange={(e) => apply({ connectors: e.target.checked })} /> Allow road connectors <small>(walk roads between trail networks, routed on OpenStreetMap roads)</small></label>
      {picking && <p className="rb-picking" role="status">Tap the map to set the {picking === "via" ? "waypoint" : picking}.</p>}
      {busy && <p className="rb-status" role="status"><span className="hx-spinner" aria-hidden="true" /> Finding the best trails…</p>}
      {error && <p className="rb-error" role="alert">{error}</p>}

      {route && !busy && (
        <div className="rb-result">
          <dl className="rb-stats">
            <div><dt>Distance</dt><dd>{fmtMiles(route.miles)}</dd></div>
            {feet(route.elevation?.gainFt) && <div><dt>Gain</dt><dd>{feet(route.elevation!.gainFt)}</dd></div>}
            {feet(route.elevation?.lossFt) && <div><dt>Loss</dt><dd>{feet(route.elevation!.lossFt)}</dd></div>}
            {duration(route.hours) && <div><dt>Est. time</dt><dd title="Naismith's rule: 3 mph plus 1 hour per 2,000 ft of climb">{duration(route.hours)}</dd></div>}
          </dl>
          {route.elevation && route.elevation.profile.length > 2 && (
            <figure className="rb-elev">
              <TrailElevationProfile samples={route.elevation.profile.map(([mi, ft]) => ({ distance_m: mi * MILE_METERS, elevation_ft: ft }))} height={96} />
              <figcaption>{route.elevation.minFt.toLocaleString("en-US")}–{route.elevation.maxFt.toLocaleString("en-US")} ft{route.elevation.partial ? " · partial elevation data" : ""}</figcaption>
            </figure>
          )}
          {route.usesConnectors && <p className="rb-warn">Part of this route follows roads between trails (marked in the list). Watch for traffic and check access.</p>}
          {route.snapped.some((s) => s.offTrailMeters > 100) && <p className="rb-warn">{route.snapped.filter((s) => s.offTrailMeters > 100).length === 1 ? "One point is" : "Some points are"} more than 100 m from the nearest trail; the route starts and ends on the trail.</p>}

          <h3>Trails, in order</h3>
          <ol className="rb-trails">
            {route.trails.map((t, i) => (
              <li key={`${t.id}-${i}`} className={t.connector ? "is-connector" : undefined}>
                <span className="rb-mile">mi {t.fromMile.toFixed(1)}</span>
                {t.id ? <Link href={`/explore/trails/${encodeURIComponent(t.id)}`}>{t.name}</Link> : <span>{t.name}</span>}
                <small>{fmtMiles(Math.round((t.toMile - t.fromMile) * 100) / 100)}</small>
              </li>
            ))}
          </ol>
          {route.legEndsMile.length > 1 && (
            <div className="rb-legs">
              {route.legEndsMile.map((m, i) => (
                <button key={i} type="button" className="rb-link" onClick={() => removeLeg(i)}>Remove leg {i + 1} (to mi {m.toFixed(1)})</button>
              ))}
            </div>
          )}

          <h3>Along the way <small>{join([water ? `${water} water` : null, camps ? `${camps} camping` : null]) ?? ""}</small></h3>
          {route.features.length ? (
            <ul className="rb-features">
              {route.features.map((f) => (
                <li key={f.id} className={`rb-feature rb-feature--${featureGroup(f.type)}`}>
                  <span className="rb-mile">mi {f.mile.toFixed(1)}</span>
                  <span className="rb-feature-name">{f.name}<small>{FEATURE_LABELS[f.type] ?? f.type}{f.offRouteFt > 60 ? ` · ${f.offRouteFt.toLocaleString("en-US")} ft off route` : ""}</small></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rb-help">No mapped water, campsites or other features along this route.</p>
          )}

          <h3>Split into days</h3>
          <label className="rb-daily">Miles per day <input type="number" inputMode="decimal" min={1} max={40} step={0.5} value={daily} placeholder="e.g. 10" onChange={(e) => setDaily(e.target.value)} /></label>
          {days && (
            <ol className="rb-days">
              {days.map((d) => (
                <li key={d.day}>
                  <strong>Day {d.day}</strong> · mi {d.fromMile.toFixed(1)}–{d.toMile.toFixed(1)} ({fmtMiles(d.miles)})
                  <small>{d.stop ? `Night: ${d.stop.name} (${FEATURE_LABELS[d.stop.type] ?? d.stop.type})` : d.toMile < route.miles ? "No mapped campsite near this mile — check camping rules" : "Finish"}</small>
                </li>
              ))}
            </ol>
          )}

          <div className="rb-row rb-actions">
            <button type="button" className="hx-btn hx-btn--primary" onClick={() => setSaveOpen(true)}>Save as my trail</button>
            <button type="button" className="hx-btn" onClick={() => downloadGpx(routeName(start, end), routeGpx(routeName(start, end), route.coordinates, route.features))}>Download GPX</button>
          </div>
          {saveOpen && !saved && (
            <SaveForm
              defaultName={routeName(start, end)}
              onCancel={() => setSaveOpen(false)}
              onSave={async ({ name, notes, photo }) => {
                const trail = await savePersonalTrail({
                  name, notes, photo,
                  geometry: route.coordinates,
                  stats: { miles: route.miles, gainFt: route.elevation?.gainFt ?? null, lossFt: route.elevation?.lossFt ?? null, minFt: route.elevation?.minFt ?? null, maxFt: route.elevation?.maxFt ?? null, hours: route.hours },
                  trails: route.trails.map(({ id, name: n, fromMile, toMile }) => ({ id, name: n, fromMile, toMile })),
                  features: route.features,
                  days,
                  waypoints: [start, ...via, end].filter((s): s is Stop => Boolean(s)).map((s) => s.point),
                });
                setSaved(trail);
                setSaveOpen(false);
                noteGuestProgress();
              }}
            />
          )}
          {saved && (
            <div className="rb-saved" role="status">
              <p><strong>Saved “{saved.name}”</strong> to My trails.</p>
              <div className="rb-row">
                <Link className="hx-btn hx-btn--primary" href={`/plan?personalTrail=${encodeURIComponent(saved.id)}`}>Plan a trip</Link>
                <Link className="hx-btn" href={`/my/trails/${encodeURIComponent(saved.id)}`}>Open trail page</Link>
              </div>
            </div>
          )}
        </div>
      )}
      <p className="rb-attrib">Routes are computed in your browser over OpenStreetMap (© contributors, ODbL) and official agency trail data. Road connectors: OSRM foot routing (FOSSGIS), © OpenStreetMap contributors. Elevation: AWS Terrain Tiles. Always check conditions, closures and access.</p>
    </section>
  );
}

function routeName(start: Stop | null, end: Stop | null) {
  const short = (s: Stop | null) => (s && !s.label.startsWith("Map point") ? s.label : null);
  const a = short(start), b = short(end);
  return a && b ? `${a} to ${b}` : a ? `From ${a}` : b ? `To ${b}` : "My route";
}

function SaveForm({ defaultName, onSave, onCancel }: { defaultName: string; onSave: (v: { name: string; notes: string; photo: File | null }) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(defaultName);
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [state, setState] = useState<{ busy: boolean; error: string }>({ busy: false, error: "" });
  return (
    <form
      className="rb-save"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) { setState({ busy: false, error: "Give your trail a name." }); return; }
        setState({ busy: true, error: "" });
        onSave({ name: name.trim().slice(0, 120), notes: notes.trim().slice(0, 4000), photo }).catch((err: unknown) => setState({ busy: false, error: err instanceof Error ? err.message : "Saving failed. Try again." }));
      }}
    >
      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></label>
      <label>Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="Permits, parking, where you camped…" /></label>
      <label>Photo<input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
      {state.error && <p className="rb-error" role="alert">{state.error}</p>}
      <p className="rb-help">Private to your account unless you share it.</p>
      <div className="rb-row">
        <button type="submit" className="hx-btn hx-btn--primary" disabled={state.busy}>{state.busy ? "Saving…" : "Save trail"}</button>
        <button type="button" className="hx-btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

interface Option { key: string; label: string; detail: string; point: LngLat }

function PlaceSearch({ slot, label, stop, picking, center, viewFeatures, onPick, onTapMap }: { slot: Slot; label: string; stop: Stop | null; picking: boolean; center: LngLat; viewFeatures: HikeFeature[]; onPick: (s: Stop) => void; onTapMap: () => void }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ q: string; options: Option[] } | null>(null);
  const [locError, setLocError] = useState("");
  const q = query.trim();
  const local: Option[] = q.length >= 2
    ? viewFeatures.filter((f) => f.name && f.name.toLowerCase().includes(q.toLowerCase())).slice(0, 4).map((f) => ({ key: `f:${f.id}`, label: featureName(f), detail: FEATURE_LABELS[f.type] ?? f.type, point: [f.lon, f.lat] }))
    : [];
  const options = found?.q === q ? [...local, ...found.options] : local;

  useEffect(() => {
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const near = `&lat=${center[1].toFixed(3)}&lng=${center[0].toFixed(3)}`;
      void Promise.all([
        fetch(`/api/trail-catalog/places?q=${encodeURIComponent(q)}${near}`, { signal: controller.signal }).then((r) => (r.ok ? r.json() : { places: [] })).catch(() => ({ places: [] })),
        q.length >= 3 ? fetch(`/api/trail-catalog?q=${encodeURIComponent(q)}&limit=5`, { signal: controller.signal }).then((r) => (r.ok ? r.json() : { trails: [] })).catch(() => ({ trails: [] })) : { trails: [] },
      ]).then(([places, trails]: [{ places?: { name: string; region: string; lat: number; lng: number }[] }, { trails?: { id: string; name: string; latitude: number; longitude: number; region?: string; park?: string; forest?: string; trailhead?: { latitude: number; longitude: number; name?: string | null } }[] }]) => {
        if (controller.signal.aborted) return;
        const out: Option[] = [
          ...(trails.trails ?? []).filter((t) => Math.abs(t.latitude) > 0.1).map((t) => ({ key: `t:${t.id}`, label: t.name, detail: `Trail${t.park ?? t.forest ?? t.region ? ` · ${t.park ?? t.forest ?? t.region}` : ""}`, point: (t.trailhead ? [t.trailhead.longitude, t.trailhead.latitude] : [t.longitude, t.latitude]) as LngLat })),
          ...(places.places ?? []).map((p) => ({ key: `p:${p.name}:${p.lat}`, label: p.name, detail: `Town · ${p.region}`, point: [p.lng, p.lat] as LngLat })),
        ];
        setFound({ q, options: out });
      });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [q, center]);

  function locate() {
    setLocError("");
    if (!("geolocation" in navigator)) { setLocError("Your browser can’t share its location."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => onPick({ key: stopKey(), point: [pos.coords.longitude, pos.coords.latitude], label: "My location" }),
      () => setLocError("Location is off for this site."),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  }

  return (
    <div className={`rb-place rb-place--${slot}`}>
      <span className="rb-place-dot" aria-hidden="true">{slot === "start" ? "A" : "B"}</span>
      <div className="rb-place-main">
        <label className="sr-only" htmlFor={`rb-${slot}`}>{label}</label>
        <input
          id={`rb-${slot}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={stop ? stop.label : `${label}: trailhead, town, lake, campsite…`}
          className={stop ? "has-stop" : undefined}
          autoComplete="off"
        />
        {q.length >= 2 && (
          <ul className="hx-results rb-options" role="listbox" aria-label={`${label} suggestions`}>
            {options.length === 0 && found?.q === q && <li className="hx-results-empty">No matches. Tap the map instead.</li>}
            {options.map((o) => (
              <li key={o.key}>
                <button type="button" onClick={() => { setQuery(""); onPick({ key: stopKey(), point: o.point, label: o.label }); }}>
                  <strong>{o.label}</strong>
                  <span>{o.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="rb-place-actions">
          <button type="button" className="rb-link" aria-pressed={picking} onClick={onTapMap}>{picking ? "Tap the map…" : "Tap map"}</button>
          <button type="button" className="rb-link" onClick={locate}>My location</button>
        </div>
        {locError && <p className="rb-error">{locError}</p>}
      </div>
    </div>
  );
}
