"use client";
import { cachedJson } from "@/lib/trail-catalog/client-cache";

import { useEffect, useState } from "react";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import type { FeatureType, TrailFeature } from "@/lib/trail-catalog/features";
import { trailHighlights } from "@/lib/trail-catalog/describe";

/** Highlight chips (Waterfall, Lake, Views, Dog friendly…) from the trail's name, facts and mapped features. */
export function TrailHighlights({ trail: t, hasLine }: { trail: CatalogTrail; hasLine: boolean }) {
  const [features, setFeatures] = useState<{ id: string; types: FeatureType[] } | null>(null);
  useEffect(() => {
    if (!hasLine) return;
    let live = true;
    cachedJson<{ features?: TrailFeature[] }>(`/api/trail-catalog/${encodeURIComponent(t.id)}/features`)
      .then((d) => { if (live) setFeatures({ id: t.id, types: (d.features ?? []).map((f) => f.type) }); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [t.id, hasLine]);
  const chips = trailHighlights(t, features?.id === t.id ? features.types : []);
  if (!chips.length) return null;
  return (
    <ul className="trail-highlights" aria-label="Highlights">
      {chips.map((c) => <li key={c}>{c}</li>)}
    </ul>
  );
}
