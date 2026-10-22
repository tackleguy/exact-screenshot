"use client";

import { useEffect, useState } from "react";
import { FEATURE_LABELS, groupOf, type FeatureGroup, type TrailFeature } from "@/lib/trail-catalog/features";
import { feet } from "@/lib/display";

type State = { url: string; features: TrailFeature[] } | null;
const GROUP_LABELS: Record<FeatureGroup, string> = { water: "Water", camping: "Camping", other: "Other" };

/** Everything mapped on or near the trail (water, campsites, shelters, viewpoints, peaks…) by mile. Hidden when nothing is mapped. */
export function TrailFeatureList({ trailId, hasLine }: { trailId: string; hasLine: boolean }) {
  const url = hasLine ? `/api/trail-catalog/${encodeURIComponent(trailId)}/features` : null;
  const [state, setState] = useState<State>(null);
  const [filter, setFilter] = useState<FeatureGroup | "all">("all");
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((data: { features?: TrailFeature[] }) => setState({ url, features: data.features ?? [] }))
      .catch(() => { if (!controller.signal.aborted) setState({ url, features: [] }); });
    return () => controller.abort();
  }, [url]);
  const features = state && state.url === url ? state.features : [];
  // Parking lots and bridges are useful on the map but crowd a mile-by-mile list.
  const listed = features.filter((f) => f.type !== "parking" && f.type !== "bridge");
  if (!listed.length) return null;
  const counts = listed.reduce<Record<FeatureGroup, number>>((acc, f) => { acc[groupOf(f.type)]++; return acc; }, { water: 0, camping: 0, other: 0 });
  const shown = filter === "all" ? listed : listed.filter((f) => groupOf(f.type) === filter);
  return (
    <section className="trail-features" aria-label="Along the trail">
      <div className="trail-features-head">
        <h2>Along the trail</h2>
        <div className="trail-features-filter" role="group" aria-label="Show">
          {(["all", "water", "camping", "other"] as const).map((g) => (g === "all" || counts[g] > 0) && (
            <button key={g} type="button" aria-pressed={filter === g} onClick={() => setFilter(g)}>
              {g === "all" ? `All ${listed.length}` : `${GROUP_LABELS[g]} ${counts[g]}`}
            </button>
          ))}
        </div>
      </div>
      <ol className="trail-features-list">
        {shown.slice(0, 200).map((f) => (
          <li key={`${f.id}-${f.mile}`} className={`trail-feature trail-feature-${groupOf(f.type)}`}>
            <span className="trail-feature-mile">mi {f.mile.toFixed(1)}</span>
            <span className="trail-feature-name">
              <strong>{f.name}</strong>
              <small>
                {f.name !== FEATURE_LABELS[f.type] && FEATURE_LABELS[f.type]}
                {f.offTrailFt >= 50 && ` · ${feet(f.offTrailFt)} off trail`}
                {f.extra.intermittent === true && " · seasonal"}
                {typeof f.extra.ele === "number" && ` · ${feet(Math.round(f.extra.ele * 3.28084))}`}
              </small>
            </span>
          </li>
        ))}
      </ol>
      {shown.length > 200 && <p className="trail-features-note">Showing the first 200 of {shown.length.toLocaleString("en-US")}.</p>}
      <p className="trail-features-note">Mapped features © OpenStreetMap contributors (ODbL). Conditions change: confirm water and campsite availability with the land manager.</p>
    </section>
  );
}
