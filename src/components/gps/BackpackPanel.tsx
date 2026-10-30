"use client";

import { useEffect, useMemo, useState } from "react";
import { chainLines, MILE_METERS, Route } from "@/lib/geo/line";
import { FEATURE_LABELS, type TrailFeature } from "@/lib/trail-catalog/features";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import type { TownNearTrail } from "@/lib/trip/towns-core";
import { backpackStops, nextStops, type Stop } from "@/lib/trip/backpack";
import { campsiteLink, permitLinks } from "@/lib/trip/permits";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import { formatDistance } from "@/lib/units";

type Tab = "camp" | "water" | "town" | "permits";
const TABS: [Tab, string][] = [["camp", "Camps"], ["water", "Water"], ["town", "Towns"], ["permits", "Permits"]];
const KIND_LABEL: Record<Stop["kind"], string> = { camp: "Next campsite", water: "Next water", town: "Next town" };

/**
 * Backpacking mode on the recorder: what's ahead on the trail (next campsite, water and town from your position),
 * every campsite, water source and town by mile, and where to get permits and book camping.
 */
export function BackpackPanel({ trailId, trail, lines, position }: { trailId: string; trail: CatalogTrail | null; lines: [number, number][][]; position: [number, number] | null }) {
  const [data, setData] = useState<{ id: string; features: TrailFeature[]; towns: TownNearTrail[]; failed: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("camp");
  useEffect(() => {
    const controller = new AbortController();
    const id = encodeURIComponent(trailId);
    const get = <T,>(url: string, pick: (d: never) => T, empty: T) => fetch(url, { signal: controller.signal }).then((r) => (r.ok ? r.json() : null)).then((d) => (d ? pick(d as never) : empty)).catch(() => empty);
    void Promise.all([
      get(`/api/trail-catalog/${id}/features`, (d: { features?: TrailFeature[] }) => d.features ?? [], [] as TrailFeature[]),
      get(`/api/trail-catalog/${id}/towns?maxMilesOff=20&limit=30`, (d: { towns?: TownNearTrail[] }) => d.towns ?? [], [] as TownNearTrail[]),
    ]).then(([features, towns]) => { if (!controller.signal.aborted) setData({ id: trailId, features, towns, failed: !features.length && !towns.length }); });
    return () => controller.abort();
  }, [trailId]);

  const route = useMemo(() => (lines.length ? new Route(chainLines(lines)) : null), [lines]);
  // Where the hiker is on the trail, in miles (null when off it by more than 500 m, or no fix yet).
  const mile = useMemo(() => {
    if (!route || !position) return null;
    const at = route.locate(position);
    return at.offMeters <= 500 ? at.alongMeters / MILE_METERS : null;
  }, [route, position]);

  const loaded = data?.id === trailId ? data : null;
  const stops = useMemo(() => (loaded ? backpackStops(loaded.features, loaded.towns) : []), [loaded]);
  const next = nextStops(stops, mile);
  const permits = trail ? permitLinks(trail) : [];
  const shown = stops.filter((s) => s.kind === tab);
  const count = (k: Stop["kind"]) => stops.filter((s) => s.kind === k).length;

  return (
    <section className="backpack-panel" aria-labelledby="backpack-heading">
      <h2 id="backpack-heading">Backpacking</h2>
      {mile !== null ? (
        <ul className="backpack-next" aria-label="Coming up">
          {(["water", "camp", "town"] as const).map((k) => (
            <li key={k} className={`backpack-next--${k}`}>
              <small>{KIND_LABEL[k]}</small>
              {next[k] ? <><strong>{formatDistance(next[k]!.milesAhead) ?? "here"}</strong><span>{next[k]!.stop.name}</span></> : <strong>None ahead</strong>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="backpack-help">{position ? "You’re more than 500 m from the trail, so distances ahead aren’t shown." : "Distances ahead appear once GPS places you on the trail."}</p>
      )}

      <div className="backpack-tabs" role="tablist" aria-label="Along the trail">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}{key !== "permits" && loaded ? ` ${count(key)}` : ""}
          </button>
        ))}
      </div>

      {tab === "permits" ? (
        <div role="tabpanel">
          {permits.length ? (
            <ul className="backpack-permits">
              {permits.map((p) => (
                <li key={p.url}>
                  <a href={p.url} target="_blank" rel="noopener noreferrer">{p.label}</a>
                  {p.note && <small>{p.note}</small>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="backpack-help">No permit or booking links are listed for this trail. Check with the land manager{trail?.manager ? ` (${trail.manager})` : ""} before an overnight trip.</p>
          )}
          <p className="backpack-help">Rules, quotas and fire restrictions change. Confirm on the official page before you go.</p>
        </div>
      ) : !loaded ? (
        <p className="backpack-help" role="status">Loading campsites, water and towns along the trail…</p>
      ) : shown.length === 0 ? (
        <p className="backpack-help">{tab === "camp" ? "No campsites or shelters are mapped along this trail. Check dispersed-camping rules with the land manager." : tab === "water" ? "No water sources are mapped along this trail. Carry what you need." : "No towns within 20 miles of this trail."}</p>
      ) : (
        <ol className="backpack-list" role="tabpanel">
          {shown.map((s) => {
            const passed = mile !== null && s.mile < mile - 0.05;
            const link = s.kind === "camp" ? campsiteLink(s.feature.extra) : null;
            return (
              <li key={`${s.kind}-${s.name}-${s.mile}`} className={passed ? "is-passed" : undefined}>
                <span className="backpack-mile">mi {s.mile.toFixed(1)}</span>
                <span className="backpack-name">
                  <strong>{s.name}</strong>
                  <small>
                    {s.kind === "town"
                      ? `${formatDistance(s.milesOffTrail)} off trail`
                      : [FEATURE_LABELS[s.type], s.offTrailFt > 200 ? `${s.offTrailFt.toLocaleString("en-US")} ft off trail` : null, s.kind === "camp" && s.feature.extra.fee === "yes" ? "fee" : null, s.kind === "camp" && typeof s.feature.extra.operator === "string" ? s.feature.extra.operator : null].filter(Boolean).join(" · ")}
                    {mile !== null && !passed ? ` · ${formatDistance(s.mile - mile)} ahead` : passed ? " · passed" : ""}
                  </small>
                </span>
                {s.kind === "town" ? (
                  <a className="backpack-link" href={googleMapsDirectionsUrl(s.town.latitude, s.town.longitude)} target="_blank" rel="noopener noreferrer">Directions</a>
                ) : link ? (
                  <a className="backpack-link" href={link} target="_blank" rel="noopener noreferrer">Book / info</a>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <p className="backpack-attrib">Campsites and water: OpenStreetMap contributors. Towns: GeoNames. Not every source is mapped, and water can be seasonal.</p>
    </section>
  );
}
