"use client";
import { useEffect, useState } from "react";
import { friendlyError } from "@/lib/errors";
import type { TripPlace, TripRequest } from "@/lib/assistant/types";
export function PlaceSearch({ request, onChange }: { request: TripRequest; onChange: (patch: Partial<TripRequest>) => void }) {
  const [places, setPlaces] = useState<TripPlace[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const region = request.region;
  useEffect(() => {
    if (!region.trim()) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => controller.abort(), 16000);
    const debounce = setTimeout(() => {
      setBusy(true); setError(""); setPlaces([]);
      fetch(`/api/assistant/places?q=${encodeURIComponent(region)}`, { signal: controller.signal })
        .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
        .then(data => { if (active) { setPlaces(data.places); if (!data.places.length) setError("No US or Canadian place found. Add the state or province, or try a nearby town."); } })
        .catch(error => { if (active) setError(controller.signal.aborted ? "Place lookup timed out. Search again." : friendlyError(error, "Place search isn’t working right now. Try again.")); })
        .finally(() => { clearTimeout(timer); if (active) setBusy(false); });
    }, 650);
    return () => { active = false; controller.abort(); clearTimeout(timer); clearTimeout(debounce); };
  }, [region, attempt]);
  return <section className="planner-place-search" aria-label="Confirm nearby location">
    <h3>{request.place ? `Near ${request.place.name}` : `Which “${region}” do you mean?`}</h3>
    <p className="planner-help">Choose the exact place. Only trail points inside your radius will appear.</p>
    <p role="status">{busy ? "Finding towns, parks and landmarks…" : error}</p>
    {!request.place && <ul className="planner-place-options">{places.map(place => <li key={place.id}><button className="planner-button secondary" onClick={() => onChange({ place })}>{place.name}</button></li>)}</ul>}
    {request.place && <div className="planner-actions"><label>Search radius<select value={request.radiusKm ?? 50} onChange={e => onChange({ radiusKm: Number(e.target.value) })}>{[10, 25, 50, 100, 200].map(km => <option key={km} value={km}>{km} km / {Math.round(km * .621371)} mi</option>)}</select></label><button className="planner-link" onClick={() => onChange({ place: null })}>Choose another location</button></div>}
    {!request.place && !busy && <button className="planner-link" onClick={() => setAttempt(n => n + 1)}>Retry place search</button>}
    <p className="planner-help">Place data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>, via <a href="https://photon.komoot.io" target="_blank" rel="noopener noreferrer">Photon</a>. Radius measures straight-line distance to mapped trail points, not driving distance or park boundaries.</p>
  </section>;
}
