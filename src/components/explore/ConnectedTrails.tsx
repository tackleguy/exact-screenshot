"use client";
import { useMemo, useState } from "react";
import { connectedGpx, connectedRoute, type RouteTrail } from "@/lib/trail-catalog/connected-route";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import type { Point } from "@/lib/trail-catalog/quality";

export function ConnectedTrails({ selected, onRoute }: { selected: RouteTrail | null; onRoute: (points: Point[]) => void }) {
  const [trails, setTrails] = useState<RouteTrail[]>([]);
  const [start, setStart] = useState(""); const [finish, setFinish] = useState("");
  const [error, setError] = useState(""); const [route, setRoute] = useState<ReturnType<typeof connectedRoute> | null>(null);
  const [saved, setSaved] = useState(false);
  const ends = useMemo(() => trails.flatMap(t => t.lines.flatMap((line, i) => line.length < 2 ? [] : [
    { key: `${t.id}:${i}:a`, label: `${t.name} · ${i + 1}A`, point: line[0] },
    { key: `${t.id}:${i}:b`, label: `${t.name} · ${i + 1}B`, point: line[line.length - 1] },
  ])), [trails]);
  function reset() { setRoute(null); setError(""); setSaved(false); onRoute([]); }
  function build() {
    reset(); const a = ends.find(e => e.key === start), b = ends.find(e => e.key === finish);
    if (!a || !b) { setError("Choose a start and finish."); return; }
    try { const next = connectedRoute(trails, a.point, b.point); setRoute(next); onRoute(next.coordinates); }
    catch (e) { setError(e instanceof Error ? e.message : "Route unavailable."); }
  }
  function download() {
    if (!route) return; const url = URL.createObjectURL(new Blob([connectedGpx(route.coordinates)], { type: "application/gpx+xml" }));
    const a = document.createElement("a"); a.href = url; a.download = "connected-trails.gpx"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function loadSaved() {
    try {
      const value = JSON.parse(localStorage.getItem("hyked-connected-route") ?? "null");
      if (!value || !Array.isArray(value.trails) || !value.route?.coordinates?.length) { setError("No route saved on this device yet."); return; }
      setTrails(value.trails); setStart(value.start); setFinish(value.finish); setRoute(value.route); onRoute(value.route.coordinates); setError("");
    } catch { setError("The saved route couldn’t be opened."); }
  }
  return <details className="hx-connect"><summary>Connect trails <span>⇄</span></summary><div className="hx-connect-body">
    <button className="hx-btn" type="button" onClick={loadSaved}>Open saved route</button>
    <button type="button" className="hx-btn" disabled={!selected?.lines.length || trails.some(t => t.id === selected?.id)} onClick={() => { if (!selected) return; reset(); setTrails(t => [...t, selected]); }}>＋ Add selected trail</button>
    <ol>{trails.map(t => <li key={t.id}><span>{t.name}</span><button className="hx-btn" type="button" aria-label={`Remove ${t.name}`} title={`Remove ${t.name}`} onClick={() => { reset(); setTrails(all => all.filter(x => x.id !== t.id)); }}>×</button></li>)}</ol>
    {trails.length > 0 && <><label>Start<select value={start} onChange={e => { reset(); setStart(e.target.value); }}><option value="">Choose trail endpoint</option>{ends.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}</select></label><label>Finish<select value={finish} onChange={e => { reset(); setFinish(e.target.value); }}><option value="">Choose trail endpoint</option>{ends.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}</select></label><button className="hx-btn hx-btn--primary" type="button" onClick={build}>Find point-to-point route</button></>}
    {error && <p role="alert">{error}</p>}
    {route && <><p role="status">{(route.meters / 1609.344).toFixed(2)} mi · mapped point-to-point route</p><div className="hx-actions"><button className="hx-btn" type="button" onClick={download}>↓ GPX</button><a className="hx-btn" href={googleMapsDirectionsUrl(route.coordinates[0][1], route.coordinates[0][0])} target="_blank" rel="noopener noreferrer">Drive to start ↗</a><button className="hx-btn" type="button" onClick={() => { try { localStorage.setItem("hyked-connected-route", JSON.stringify({ trails, start, finish, route })); setSaved(true); } catch { setError("This browser couldn’t save the route."); } }}>Save route</button></div>{saved && <p role="status">Saved on this device.</p>}<p className="hx-route-note">Mapped connections only. Check signs, access and current conditions before hiking.</p></>}
  </div></details>;
}