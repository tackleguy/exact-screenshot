"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "@/lib/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { explorerStyle } from "@/components/explore/explorer-map";
import { SKI_ATTRIBUTION } from "@/components/ski/SkiAreaMap";
import { buildFromTiles, featureKey, lengthKm, loadOsmTrail, osmDifficulty, osmSections, sampleElevation, saveOsmTrail, trailGpx, type OsmTrail } from "@/lib/osm-trail";
import { TRAIL_SECTIONS } from "@/lib/trail-catalog/activity";

const USE: Record<string, string> = { foot: "On foot", bicycle: "Bicycle", horse: "Horse" };

export function OsmTrailPage({ id }: { id: string }) {
  const [trail, setTrail] = useState<OsmTrail | null>(() => loadOsmTrail(id));
  const [missing, setMissing] = useState(false);
  const [profile, setProfile] = useState<[number, number][] | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const search = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const lng = Number(search.get("lng")), lat = Number(search.get("lat"));

  useEffect(() => {
    if (!el.current) return;
    let map: maplibregl.Map | null = null;
    let live = true;
    const start = trail?.lines[0]?.[0] ?? (Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null);
    if (!start) { setMissing(true); return; }
    void explorerStyle("topo").then((style) => {
      if (!live || !el.current) return;
      map = new maplibregl.Map({ container: el.current, style, center: start as [number, number], zoom: 15, attributionControl: false });
      map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: SKI_ATTRIBUTION }));
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
      const draw = (t: OsmTrail) => {
        const m = map!;
        const data: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: t.lines } }] };
        if (m.getSource("t")) (m.getSource("t") as maplibregl.GeoJSONSource).setData(data);
        else { m.addSource("t", { type: "geojson", data }); m.addLayer({ id: "t", type: "line", source: "t", layout: { "line-cap": "round" }, paint: { "line-color": "#ffc21a", "line-width": 5 } }); }
        const pts = t.lines.flat();
        if (pts.length) { const b = new maplibregl.LngLatBounds(pts[0], pts[0]); pts.forEach((p) => b.extend(p)); m.fitBounds(b, { padding: 40, maxZoom: 16, duration: 0 }); }
      };
      map.on("load", () => {
        if (trail) { draw(trail); return; }
        // Opened directly: rebuild the trail from the map tiles around the saved spot.
        map!.once("idle", () => {
          const f = map!.querySourceFeatures("trails", { sourceLayer: "trail" }).find((x) => featureKey(x) === id);
          if (!f) { setMissing(true); return; }
          const t = buildFromTiles(map!, f);
          saveOsmTrail(t); setTrail(t); draw(t);
        });
      });
    });
    return () => { live = false; map?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { if (trail) void sampleElevation(trail.lines).then(setProfile); }, [trail]);

  const tags = trail?.tags ?? {};
  const km = trail ? lengthKm(trail.lines) : 0;
  const diff = osmDifficulty(tags);
  const sections = osmSections(tags);
  const startPt = trail?.lines[0]?.[0];
  const name = trail?.name || "Unnamed path";
  const gain = useMemo(() => profile?.reduce((g, p, i) => (i && p[1] > profile[i - 1][1] ? g + p[1] - profile[i - 1][1] : g), 0) ?? null, [profile]);

  const download = () => {
    if (!trail) return;
    const url = URL.createObjectURL(new Blob([trailGpx(name, trail.lines)], { type: "application/gpx+xml" }));
    const a = document.createElement("a"); a.href = url; a.download = `${name.replace(/[^\w-]+/g, "-")}.gpx`; a.click(); URL.revokeObjectURL(url);
  };

  const row = (label: string, value: unknown) => value == null || value === "" ? null : <div className="flex justify-between gap-3 border-b border-[var(--border)] py-1.5 text-sm"><span className="text-mist">{label}</span><span className="text-cream capitalize">{String(value).replace(/_/g, " ")}</span></div>;
  const prof = profile && profile.length > 1 ? (() => {
    const xs = profile.map((p) => p[0]), ys = profile.map((p) => p[1]);
    const maxX = Math.max(...xs) || 1, minY = Math.min(...ys), maxY = Math.max(...ys), span = maxY - minY || 1;
    return profile.map(([x, y]) => `${(x / maxX) * 300},${80 - ((y - minY) / span) * 75}`).join(" ");
  })() : null;

  return (
    <section className="fieldbook-page">
      <Link className="btn-ghost" href="/explore/trails">← Back to map</Link>
      <p className="section-label mt-4">OpenStreetMap trail</p>
      <h1>{name}</h1>
      {missing && !trail && <p role="alert">This trail couldn’t be rebuilt here. Open it again by tapping its line on the map.</p>}
      <div ref={el} className="mt-4 h-80 w-full rounded-[var(--radius-lg)]" />
      {trail && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {startPt && <a className="btn-primary text-xs" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${startPt[1]},${startPt[0]}`}>Google Maps directions</a>}
            {startPt && <a className="btn-ghost text-xs" target="_blank" rel="noreferrer" href={`https://maps.apple.com/?daddr=${startPt[1]},${startPt[0]}`}>Apple Maps</a>}
            <button type="button" className="btn-ghost text-xs" onClick={download}>Download GPX</button>
          </div>
          <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-elevated p-4">
            {row("Length", km ? `${(km * 0.621371).toFixed(2)} mi (${km.toFixed(2)} km)` : null)}
            {row("Sections", sections.map((s) => TRAIL_SECTIONS.find((x) => x.key === s)?.label ?? s).join(", "))}
            {row("Difficulty", diff)}
            {row("Surface", tags.surface)}
            {row("Path type", tags.highway)}
            {Object.entries(USE).map(([k, l]) => row(l, tags[k]))}
            {row("Operator", tags.operator)}
            {gain != null && row("Elevation gain (approx.)", `${Math.round(gain * 3.281).toLocaleString()} ft`)}
          </div>
          {prof && (
            <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-surface-elevated p-4">
              <p className="text-xs text-mist">Elevation profile</p>
              <svg viewBox="0 0 300 82" className="mt-2 h-24 w-full" preserveAspectRatio="none"><polyline points={prof} fill="none" stroke="currentColor" strokeWidth="2" className="text-accent" /></svg>
            </div>
          )}
        </>
      )}
      <p className="mt-4 text-xs text-mist">© OpenStreetMap contributors</p>
    </section>
  );
}
