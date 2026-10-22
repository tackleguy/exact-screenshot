"use client";

import { useEffect, useMemo, useState } from "react";
import { TrailElevationProfile } from "./TrailElevationProfile";
import { usePlannerMemory } from "@/components/assistant/usePlannerMemory";
import type { WaterReport } from "@/lib/trip/water";
import type { ElevationProfile } from "@/lib/trip/elevation";
import type { TownDayPlan } from "@/lib/trip/town-days";
import type { TownWithServices } from "@/lib/trip/trail-trip";
import { SERVICE_LABELS, type ServiceKey } from "@/lib/trip/services";
import { feet, isNum, join } from "@/lib/display";

type Load<T> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: T };
const WATER = { tap: "Tap", spring: "Spring", river: "River", stream: "Stream", lake: "Lake" } as const;
const RELIABILITY = { potable: "Drinking water", treat: "Treat or filter", seasonal: "Seasonal" } as const;

function useJson<T>(url: string | null): Load<T> {
  const [state, setState] = useState<Load<T>>({ state: "loading" });
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error ?? "Couldn’t load this."); setState({ state: "ready", data }); })
      .catch((e: Error) => { if (e.name !== "AbortError") setState({ state: "error", message: e.message }); });
    return () => controller.abort();
  }, [url]);
  return url ? state : { state: "error", message: "Not available for this trail." };
}

const services = (t: TownWithServices) => (t.services ? (Object.keys(SERVICE_LABELS) as ServiceKey[]).filter((k) => (t.services!.counts[k] ?? 0) > 0) : []);

/** Elevation, water, towns, town days and downloads for a catalog trail, all from the public API. */
export function TripTools({ trailId, hasLine, miles }: { trailId: string; hasLine: boolean; miles: number | null }) {
  const base = `/api/trail-catalog/${encodeURIComponent(trailId)}`;
  const elevation = useJson<ElevationProfile>(hasLine ? `${base}/elevation` : null);
  const water = useJson<WaterReport>(hasLine ? `${base}/water` : null);
  const towns = useJson<{ towns: TownWithServices[]; attribution: string }>(`${base}/towns`);
  const { memory } = usePlannerMemory(null);
  const [days, setDays] = useState(() => Math.max(1, Math.round((miles ?? 8) / 12)));
  const [startDate, setStartDate] = useState("");
  const [maxCarryDays, setMaxCarryDays] = useState(5);
  const [plan, setPlan] = useState<Load<TownDayPlan & { trailMiles: number }> | null>(null);
  const [packetBusy, setPacketBusy] = useState(false);

  const query = useMemo(() => new URLSearchParams({ days: String(days), maxCarryDays: String(maxCarryDays), ...(startDate ? { startDate } : {}) }).toString(), [days, maxCarryDays, startDate]);

  async function planTownDays(e: React.FormEvent) {
    e.preventDefault();
    setPlan({ state: "loading" });
    const r = await fetch(`${base}/town-days?${query}`).catch(() => null);
    const data = await r?.json().catch(() => null);
    setPlan(r?.ok ? { state: "ready", data } : { state: "error", message: data?.error ?? "Couldn’t plan town days." });
  }

  /** Packet with the gear saved in this browser's planner. */
  async function packetWithGear() {
    setPacketBusy(true);
    const pack = memory.gear.map((g) => ({ name: g.name, quantity: g.qty, weightOz: g.weightOz, category: g.category, consumable: g.type === "Consumable" }));
    const r = await fetch("/api/trips/packet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trailId, format: "html", days, maxCarryDays, ...(startDate ? { startDate } : {}), pack }) }).catch(() => null);
    setPacketBusy(false);
    if (!r?.ok) return;
    const url = URL.createObjectURL(new Blob([await r.text()], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <section className="catalog-trip-tools" aria-labelledby="trip-tools-heading">
      <h2 id="trip-tools-heading">Trip tools</h2>

      {hasLine && (
        <div className="catalog-trip-block">
          <h3>Elevation</h3>
          {elevation.state === "loading" && <p className="catalog-muted" role="status">Measuring elevation…</p>}
          {elevation.state === "error" && <p className="catalog-muted">{elevation.message}</p>}
          {elevation.state === "ready" && (
            <>
              <p>{join([feet(elevation.data.gainFt) && `+${feet(elevation.data.gainFt)} climb`, feet(elevation.data.lossFt) && `−${feet(elevation.data.lossFt)} descent`, feet(elevation.data.minFt) && feet(elevation.data.maxFt) && `${elevation.data.minFt.toLocaleString("en-US")}–${feet(elevation.data.maxFt)}`])} <small className="catalog-muted">(in the direction the trail is mapped)</small></p>
              <TrailElevationProfile samples={elevation.data.profile.map(([mi, ft]) => ({ distance_m: mi * 1609.344, elevation_ft: ft }))} />
              <p className="catalog-muted">{elevation.data.partial ? "Part of the elevation data couldn’t be loaded, so these totals cover only part of the trail. Reload to try again." : "Estimated from sampled ground elevation along the mapped line."}</p>
            </>
          )}
        </div>
      )}

      {hasLine && (
        <div className="catalog-trip-block">
          <h3>Water on the trail</h3>
          {water.state === "loading" && <p className="catalog-muted" role="status">Finding water sources…</p>}
          {water.state === "error" && <p className="catalog-muted">{water.message}</p>}
          {water.state === "ready" && (
            <>
              <p>{water.data.sources.length} source{water.data.sources.length === 1 ? "" : "s"} mapped · longest stretch without dependable water <strong>{water.data.longestDryMiles} mi</strong></p>
              {water.data.sources.length > 0 && (
                <ol className="catalog-trip-list">
                  {water.data.sources.slice(0, 40).map((s, i) => (
                    <li key={i}>{isNum(s.mile) && <span className="catalog-trip-mile">Mi {s.mile}</span>} {WATER[s.kind]}{s.crossing ? " crossing" : ""}{s.name ? ` · ${s.name}` : ""} <small>{RELIABILITY[s.reliability]}{s.offTrailMeters ? ` · ${s.offTrailMeters} m off trail` : ""}</small></li>
                  ))}
                </ol>
              )}
              {water.data.notes.map((n) => <p key={n} className="catalog-muted">{n}</p>)}
            </>
          )}
        </div>
      )}

      <div className="catalog-trip-block">
        <h3>Towns nearby</h3>
        {towns.state === "loading" && <p className="catalog-muted" role="status">Looking for towns…</p>}
        {towns.state === "error" && <p className="catalog-muted">{towns.message}</p>}
        {towns.state === "ready" && (towns.data.towns.length ? (
          <ul className="catalog-trip-list">
            {towns.data.towns.map((t) => (
              <li key={t.id}><strong>{join([t.name, t.state], ", ")}</strong> <small>{join([isNum(t.milesOffTrail) && `${t.milesOffTrail} mi off trail`, hasLine && isNum(t.trailMile) && `near mile ${t.trailMile}`], " ")}</small><br /><small>{services(t).map((k) => SERVICE_LABELS[k]).join(" · ") || "No services mapped"}</small></li>
            ))}
          </ul>
        ) : <p className="catalog-muted">No towns within 15 miles.</p>)}
        {towns.state === "ready" && <p className="catalog-muted">{towns.data.attribution}</p>}
      </div>

      {hasLine && (miles ?? 0) >= 20 && (
        <div className="catalog-trip-block">
          <h3>Town days</h3>
          <p className="catalog-muted">Plan resupply stops: which town on which day, and what to buy and do there.</p>
          <form onSubmit={planTownDays} className="catalog-trip-form">
            <label>Hiking days<input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))} /></label>
            <label>Most days of food to carry<input type="number" min={1} max={14} value={maxCarryDays} onChange={(e) => setMaxCarryDays(Math.max(1, Number(e.target.value) || 1))} /></label>
            <label>Start date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
            <button className="catalog-button" type="submit">Plan town days</button>
          </form>
          {plan?.state === "loading" && <p className="catalog-muted" role="status">Planning…</p>}
          {plan?.state === "error" && <p role="alert" className="catalog-muted">{plan.message}</p>}
          {plan?.state === "ready" && (
            <div>
              <p>{plan.data.notes[0]} Start with {plan.data.startFoodDays} day{plan.data.startFoodDays === 1 ? "" : "s"} ({plan.data.startFoodLb} lb) of food.</p>
              {plan.data.stops.map((s) => (
                <div key={`${s.town.id}-${s.arriveDay}`} className="catalog-trip-stop">
                  <h4>Day {s.arriveDay}{s.date ? ` · ${s.date}` : ""} — {s.town.name}, {s.town.state} <small>(mile {s.trailMile}, {s.town.milesOffTrail} mi off trail)</small></h4>
                  <ul>{s.checklist.map((c) => <li key={c}>{c}</li>)}</ul>
                  {s.warnings.map((w) => <p key={w} className="catalog-trip-warn">{w}</p>)}
                </div>
              ))}
              {plan.data.gaps.map((g) => <p key={g.fromMile} className="catalog-trip-warn">Miles {g.fromMile}–{g.toMile}: no town within reach. Mail a box or carry extra food.</p>)}
              {plan.data.notes.slice(1).map((n) => <p key={n} className="catalog-muted">{n}</p>)}
            </div>
          )}
        </div>
      )}

      <div className="catalog-trip-block">
        <h3>Downloads</h3>
        <div className="catalog-directions-actions">
          {hasLine && <a className="catalog-button secondary" href={`${base}/download?format=gpx&${query}`} download>GPX with water & towns</a>}
          {hasLine && <a className="catalog-button secondary" href={`${base}/download?format=csv`} download>Water list (CSV)</a>}
          <a className="catalog-button secondary" href={`${base}/download?format=html&${query}`} target="_blank" rel="noopener noreferrer">Printable trip packet</a>
          <button type="button" className="catalog-button" onClick={packetWithGear} disabled={packetBusy}>{packetBusy ? "Preparing…" : `Packet with my gear (${memory.gear.length})`}</button>
        </div>
        <p className="catalog-muted">The packet includes the trail, town days, water, towns and your pack list from the planner. Print it or save it as a PDF.</p>
      </div>
    </section>
  );
}
