"use client";

import { useEffect, useState } from "react";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import type { FeatureType, TrailFeature } from "@/lib/trail-catalog/features";
import { trailHighlights } from "@/lib/trail-catalog/describe";

/** Highlight chips (Waterfall, Lake, Views, Dog friendly…) from the trail's name, facts and mapped features. */
export function TrailHighlights({ trail: t, hasLine }: { trail: CatalogTrail; hasLine: boolean }) {
  const [features, setFeatures] = useState<{ id: string; types: FeatureType[] } | null>(null);
  useEffect(() => {
    if (!hasLine) return;
    const controller = new AbortController();
    fetch(`/api/trail-catalog/${encodeURIComponent(t.id)}/features`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((d: { features?: TrailFeature[] }) => setFeatures({ id: t.id, types: (d.features ?? []).map((f) => f.type) }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [t.id, hasLine]);
  const chips = trailHighlights(t, features?.id === t.id ? features.types : []);
  if (!chips.length) return null;
  return (
    <ul className="trail-highlights" aria-label="Highlights">
      {chips.map((c) => <li key={c}>{c}</li>)}
    </ul>
  );
}
