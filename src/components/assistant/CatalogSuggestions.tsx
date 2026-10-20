"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { displayMiles, sourceName, trailPlace, countryName, type CatalogTrail } from "@/lib/trail-catalog/types";
import { distanceKm } from "@/lib/trail-catalog/search";
import { expandRegion } from "@/lib/assistant/regions";
import type { RouteCandidate, TripRequest } from "@/lib/assistant/types";

export function CatalogSuggestions({ request, onSelect }: { request: TripRequest; onSelect: (route: RouteCandidate) => void }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(request.distanceMiles ? "length" : "near");
  const [retry, setRetry] = useState(0);
  const [choosing, setChoosing] = useState<CatalogTrail | null>(null);
  const near = request.locationMode === "near";
  const place = request.place;
  const params = new URLSearchParams({ limit: "8", page: String(page) });
  if (near && place) { params.set("lat", String(place.latitude)); params.set("lng", String(place.longitude)); params.set("radiusKm", String(request.radiusKm ?? 50)); }
  else params.set("q", expandRegion(request.region));
  params.set("kind", "segment");
  if ((!near || sort === "length") && request.distanceMiles) params.set("targetMiles", String(request.distanceMiles));
  const key = params.toString();
  const [result, setResult] = useState<{ key: string; trails: CatalogTrail[]; total: number; page: number; pages: number; error: boolean } | null>(null);
  const enabled = Boolean(request.region.trim() && (!near || place));
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 15000);
    fetch(`/api/trail-catalog?${key}`, { signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("Catalog unavailable"); return response.json(); })
      .then(data => { if (active) setResult({ key, ...data, error: false }); })
      .catch(() => { if (active) setResult({ key, trails: [], total: 0, page: 1, pages: 1, error: true }); })
      .finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [enabled, key, retry]);
  if (!enabled) return null;
  const current = result?.key === key ? result : null;
  return <section className="planner-catalog" aria-label="Select a mapped trail">
    <div className="planner-section-heading"><h3>{near ? "Trails near your place" : `Trails in ${request.region}`}</h3>{near && <label>Order by<select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="near">Nearest first</option><option value="length">Closest to trip mileage</option></select></label>}</div>
    <p className="planner-help">Select a mapped trail to start your plan. Distances are for the mapped trail; check the map and official source to plan a complete itinerary and camping permissions.</p>
    <p role="status" className="planner-help">{!current ? "Finding mapped trails…" : current.error ? "Trails could not be loaded. Retry below." : `${current.total.toLocaleString()} trails${near ? ` within ${request.radiusKm ?? 50} km of ${place!.name}` : " found"}.`}</p>
    {current?.error && <button className="planner-button secondary" onClick={() => { setResult(null); setRetry(n => n + 1); }}>Retry trails</button>}
    {current && !current.error && current.total === 0 && <p className="planner-empty">No mapped trails in this search. {near ? "Choose a larger radius or another location above. The radius has not been widened automatically." : "Try a state or province, or choose Near a place for a town or landmark."}</p>}
    <ul className="planner-sources">{current?.trails.map(trail => <li key={trail.id}>
      <h4><Link href={`/explore/trails/${trail.id}`} target="_blank" rel="noopener noreferrer" prefetch={false}>{trail.name}</Link></h4>
      <p>{trail.region ?? countryName(trail.country)} · {displayMiles(trail.miles)} · {trailPlace(trail)}{trail.distanceBasis === "geometry" ? " · Measured from the map" : ""}</p>
      {near && place && <p>{distanceKm(place.latitude, place.longitude, trail.latitude, trail.longitude).toFixed(1)} km from your chosen place</p>}
      <div className="planner-actions"><Link href={`/explore/trails/${trail.id}`} target="_blank" rel="noopener noreferrer" prefetch={false}>Map & trail details</Link><button className="planner-button secondary" onClick={() => setChoosing(trail)}>Select {trail.name}</button></div>
      {choosing?.id === trail.id && <form className="planner-trail-confirm" onSubmit={e => {
        e.preventDefault(); const distance = Number(new FormData(e.currentTarget).get("distance"));
        if (!Number.isFinite(distance) || distance < .1 || distance > 10000) return;
        onSelect({ id: trail.id, name: trail.name, region: [trail.region, countryName(trail.country)].filter(Boolean).join(", "), distanceMiles: distance, elevationFt: null, difficulty: trail.difficulty || "Not rated", sourceUrl: trail.officialUrl || trail.sourceUrl, sourceLabel: sourceName(trail.source), catalogHref: `/explore/trails/${trail.id}`, kind: "segment", note: `Based on a mapped trail section (${displayMiles(trail.miles)}). Full itinerary distance entered by you; route connections, campsites and overnight permissions need verification.` });
      }}><p>Use this trail as the starting point for your trip. Enter the distance of the full route you intend to walk, including any return journey.</p><label>Planned full route distance (mi)<input key={trail.id} name="distance" type="number" required min="0.1" max="10000" step="0.1" defaultValue={trail.miles && trail.miles >= .1 ? trail.miles.toFixed(1) : ""} /></label><div className="planner-actions"><button className="planner-button">Use trail & build packing list</button><button type="button" className="planner-link" onClick={() => setChoosing(null)}>Cancel</button></div></form>}
    </li>)}</ul>
    {current && current.pages > 1 && <nav className="planner-actions" aria-label="Trail result pages"><button className="planner-button secondary" disabled={current.page <= 1} onClick={() => { setChoosing(null); setPage(current.page - 1); }}>Previous trails</button><span>Page {current.page} of {current.pages}</span><button className="planner-button secondary" disabled={current.page >= current.pages} onClick={() => { setChoosing(null); setPage(current.page + 1); }}>More trails</button></nav>}
  </section>;
}
