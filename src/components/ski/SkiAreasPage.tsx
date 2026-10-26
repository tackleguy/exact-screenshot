"use client";

import { formatElevation } from "@/lib/units";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as maplibregl from "@/lib/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { createClient } from "@/lib/supabase/client";
import { RASTER_STYLE, SKI_ATTRIBUTION } from "./SkiAreaMap";
import { skiAreaRows } from "@/web/trail-service";
import { countryName } from "@/lib/trail-catalog/types";

interface SkiAreaRow {
  id: string; slug: string; name: string; country_name: string; region: string; locality: string;
  lifts: number; ski_types: string[]; elevation_max_ft: number | null; counts: Record<string, unknown> | null;
  /** Areas from the built-in OpenSkiMap list open on the ski map; their numbers come from that list. */
  latitude?: number; longitude?: number; runs?: number; href?: string;
}
const PAGE_SIZE = 24;
const runTotal = (a: SkiAreaRow) => a.runs ?? (a.counts ? Number(a.counts.skiRuns ?? 0) + Number(a.counts.nordicRuns ?? 0) : 0);

/**
 * Every operating ski area from the site's own OpenSkiMap list, used when the account database's ski-area table
 * can't be read (signed out, or not loaded yet), so the page always works.
 */
async function builtInAreas(): Promise<SkiAreaRow[]> {
  const rows = await skiAreaRows(window.fetch.bind(window));
  return rows.map((r) => ({
    id: r[0], slug: r[0], name: r[1], country_name: r[4] ? countryName(r[4]) : "", region: r[5], locality: r[6], lifts: r[9],
    ski_types: [r[7].includes("d") && "downhill", r[7].includes("n") && "nordic"].filter(Boolean) as string[],
    elevation_max_ft: r[10] != null ? Math.round(r[10] * 3.28084) : null, counts: null,
    latitude: r[3], longitude: r[2], runs: r[8], href: `/explore/ski?area=${r[0]}`,
  })).sort((a, b) => b.lifts - a.lifts || (b.runs ?? 0) - (a.runs ?? 0));
}
function filterBuiltIn(rows: SkiAreaRow[], f: { query: string; country: string; region: string; type: string }) {
  const q = f.query.trim().toLowerCase();
  return rows.filter((a) => (!q || a.name.toLowerCase().includes(q) || a.locality.toLowerCase().includes(q)) && (!f.country || a.country_name === f.country) && (!f.region || a.region === f.region) && (!f.type || a.ski_types.includes(f.type)));
}

/** The PostgREST filter methods used here (each returns the builder). */
interface FilterBuilder { ilike(column: string, pattern: string): FilterBuilder; eq(column: string, value: string): FilterBuilder; contains(column: string, value: string[]): FilterBuilder; or(filters: string): FilterBuilder }

function applyFilters<B>(query: B, f: { query: string; country: string; region: string; type: string; hiking: boolean; biking: boolean }): B {
  let r = query as unknown as FilterBuilder;
  const t = f.query.trim();
  if (t) r = r.ilike("name", `%${t}%`);
  if (f.country) r = r.eq("country_name", f.country);
  if (f.region) r = r.eq("region", f.region);
  if (f.type) r = r.contains("ski_types", [f.type]);
  if (f.hiking) r = r.or("counts->>hikingOnMountain.gt.0,counts->>hikingNearby.gt.0");
  if (f.biking) r = r.or("counts->>mountainBikingOnMountain.gt.0,counts->>mountainBikingNearby.gt.0");
  return r as unknown as B;
}

export function SkiAreasPage() {
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [type, setType] = useState("");
  const [hiking, setHiking] = useState(false);
  const [biking, setBiking] = useState(false);
  const [page, setPage] = useState(0);
  const [areas, setAreas] = useState<SkiAreaRow[]>([]);
  const [total, setTotal] = useState(0);
  const [places, setPlaces] = useState<{ country_name: string; region: string }[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  // null while checking the database; [] when the database answers; the built-in list otherwise.
  const [builtIn, setBuiltIn] = useState<SkiAreaRow[] | null | undefined>(undefined);
  useEffect(() => {
    const client = createClient();
    void (async () => {
      // The account database's ski areas can only be read signed in; signed out, don't ask (it answers 401).
      const signedIn = client ? Boolean((await client.auth.getSession()).data.session) : false;
      const check = client && signedIn ? await client.from("ski_areas").select("id", { count: "exact", head: true }) : null;
      if (check && !check.error && (check.count ?? 0) > 0) { setBuiltIn(null); return; }
      setBuiltIn(await builtInAreas().catch(() => []));
    })();
  }, []);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  useEffect(() => { navRef.current = navigate; }, [navigate]);
  const filters = useMemo(() => ({ query, country, region, type, hiking, biking }), [query, country, region, type, hiking, biking]);

  useEffect(() => {
    const client = createClient();
    if (!client || builtIn !== null) return;
    void (async () => {
      const all: { country_name: string; region: string }[] = [];
      for (let i = 0; i < 7; i++) {
        const { data } = await client.from("ski_areas").select("country_name,region").range(i * 1000, i * 1000 + 999);
        if (!data?.length) break;
        all.push(...data);
      }
      setPlaces(all);
    })();
  }, [builtIn]);
  const placeRows = builtIn ?? places;
  const countries = useMemo(() => [...new Set(placeRows.map((p) => p.country_name).filter(Boolean))].sort(), [placeRows]);
  const regions = useMemo(() => [...new Set(placeRows.filter((p) => !country || p.country_name === country).map((p) => p.region).filter(Boolean))].sort(), [placeRows, country]);

  const builtInFound = useMemo(() => (builtIn ? filterBuiltIn(builtIn, filters) : null), [builtIn, filters]);
  useEffect(() => {
    const key = JSON.stringify([filters, page]);
    const client = createClient();
    if (!client || builtIn !== null) return;
    let active = true;
    const req = applyFilters(client.from("ski_areas").select("id,slug,name,country_name,region,locality,lifts,ski_types,elevation_max_ft,counts", { count: "exact" }), filters)
      .order("lifts", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    req.then(({ data, count, error: err }) => {
      if (!active) return;
      setAreas((data ?? []) as SkiAreaRow[]); setTotal(count ?? 0); setError(err ? "Ski areas couldn’t load. Try again in a moment." : ""); setLoadedKey(key);
    });
    return () => { active = false; };
  }, [filters, page, builtIn]);

  useEffect(() => {
    if (!mapEl.current) return;
    const map = new maplibregl.Map({ container: mapEl.current, style: RASTER_STYLE, center: [-40, 40], zoom: 1.4, attributionControl: false });
    map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: SKI_ATTRIBUTION }));
    map.on("load", () => {
      map.addSource("areas", { type: "geojson", data: { type: "FeatureCollection", features: [] }, cluster: true, clusterRadius: 40 });
      map.addLayer({ id: "clusters", type: "circle", source: "areas", filter: ["has", "point_count"], paint: { "circle-color": "#2f7fd8", "circle-radius": ["step", ["get", "point_count"], 12, 50, 18, 300, 24], "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } });
      map.addLayer({ id: "cluster-n", type: "symbol", source: "areas", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11 }, paint: { "text-color": "#ffffff" } });
      map.addLayer({ id: "pin", type: "circle", source: "areas", filter: ["!", ["has", "point_count"]], paint: { "circle-color": "#ffffff", "circle-radius": 5, "circle-stroke-width": 2, "circle-stroke-color": "#2f7fd8" } });
      map.on("click", "pin", (e) => { const p = e.features?.[0]?.properties; if (p?.href) navRef.current(p.href); });
      map.on("click", "clusters", (e) => { const f = e.features?.[0]; if (f) map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: map.getZoom() + 2 }); });
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const client = createClient();
    const map = mapRef.current;
    if (!map || builtIn === undefined || (!client && !builtIn)) return;
    let live = true;
    void (async () => {
      const rows: { slug: string; name: string; latitude: number; longitude: number; href?: string }[] = builtIn ? filterBuiltIn(builtIn, filters).map((a) => ({ slug: a.slug, name: a.name, latitude: a.latitude!, longitude: a.longitude!, href: a.href })) : [];
      for (let i = 0; client && !builtIn && i < 7; i++) {
        const { data } = await applyFilters(client.from("ski_areas").select("slug,name,latitude,longitude"), filters).range(i * 1000, i * 1000 + 999);
        if (!data?.length) break;
        rows.push(...(data as typeof rows));
        if (data.length < 1000) break;
      }
      if (!live) return;
      const set = () => (map.getSource("areas") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: rows.map((r) => ({ type: "Feature", properties: { href: r.href ?? `/ski-areas/${r.slug}`, name: r.name }, geometry: { type: "Point", coordinates: [r.longitude, r.latitude] } })) });
      if (map.getSource("areas")) set(); else map.once("load", set);
    })();
    return () => { live = false; };
  }, [filters, builtIn]);

  const shown = builtInFound ? builtInFound.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) : areas;
  const count = builtInFound ? builtInFound.length : total;
  const loading = builtIn === undefined || (!builtInFound && loadedKey !== JSON.stringify([filters, page]));
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const sel = "rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-muted px-3 py-2.5 text-sm text-cream";
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(0); };

  return (
    <section className="fieldbook-page">
      <p className="section-label">Explore · Ski areas</p>
      <h1>Ski areas &amp; winter resorts</h1>
      <p className="text-mist">{builtIn ? `${count.toLocaleString()} ski areas worldwide. Tap one for its runs, lifts and directions.` : `${count.toLocaleString()} ski areas with mapped runs and nearby summer trails.`}</p>
      <div className="mt-4 flex flex-col flex-wrap gap-2 md:flex-row">
        <input type="search" value={query} onChange={(e) => reset(setQuery)(e.target.value)} placeholder="Search ski areas (e.g. Vail, Chamonix)…" className={`flex-1 ${sel} placeholder:text-mist`} />
        <select value={country} onChange={(e) => { setCountry(e.target.value); setRegion(""); setPage(0); }} className={sel}><option value="">All countries</option>{countries.map((c) => <option key={c}>{c}</option>)}</select>
        <select value={region} onChange={(e) => reset(setRegion)(e.target.value)} className={sel}><option value="">All regions</option>{regions.map((r) => <option key={r}>{r}</option>)}</select>
        <select value={type} onChange={(e) => reset(setType)(e.target.value)} className={sel}><option value="">Downhill &amp; Nordic</option><option value="downhill">Downhill</option><option value="nordic">Nordic</option></select>
        {!builtIn && <label className="flex items-center gap-2 text-sm text-mist"><input type="checkbox" checked={hiking} onChange={(e) => reset(setHiking)(e.target.checked)} />Has hiking</label>}
        {!builtIn && <label className="flex items-center gap-2 text-sm text-mist"><input type="checkbox" checked={biking} onChange={(e) => reset(setBiking)(e.target.checked)} />Has mountain biking</label>}
      </div>
      <div ref={mapEl} className="mt-4 h-72 w-full rounded-[var(--radius-lg)]" />
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading ski areas…</p>}
      {!loading && !error && (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((a) => {
              const runs = runTotal(a);
              return (
                <Link key={a.id} href={a.href ?? `/ski-areas/${a.slug}`} className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-elevated p-4 transition-colors hover:border-accent/40">
                  <h2 className="font-display text-base font-semibold text-cream">{a.name}</h2>
                  <p className="mt-1 text-xs text-mist">{[a.locality, a.region, a.country_name].filter(Boolean).join(", ")}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-mist">
                    {a.lifts > 0 && <span>{a.lifts} lifts</span>}
                    {runs > 0 && <span>{runs.toLocaleString()} runs</span>}
                    {a.elevation_max_ft != null && <span>{formatElevation(a.elevation_max_ft)} peak</span>}
                    {a.ski_types.map((t) => <span key={t} className="rounded-full border border-[var(--border)] px-2 py-0.5 capitalize">{t}</span>)}
                  </div>
                </Link>
              );
            })}
          </div>
          {shown.length === 0 && <p>No ski areas match your search.</p>}
          {totalPages > 1 && (
            <div className="mt-6 flex items-center gap-3 text-sm">
              <button type="button" className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Previous</button>
              <span className="text-mist">Page {page + 1} of {totalPages}</span>
              <button type="button" className="btn-ghost" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
