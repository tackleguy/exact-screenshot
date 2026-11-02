"use client";

import { useEffect, useState } from "react";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import type { TrailFeature } from "@/lib/trail-catalog/features";
import type { ElevationProfile } from "@/lib/trip/elevation";
import type { TrailDifficulty } from "@/lib/trail-difficulty";
import { describeTrailParts } from "@/lib/trail-catalog/describe";
import { cachedJson } from "@/lib/trail-catalog/client-cache";

/**
 * The generated description: written at once from the trail's stored facts, then refined with the mapped features
 * ("Along the trail") and the elevation profile's shape when those arrive. Both come from the shared request cache,
 * so the highlights and the elevation chart reuse the same responses.
 */
export function TrailDescription({ trail: t, difficulty, time, hasLine }: { trail: CatalogTrail; difficulty: TrailDifficulty; time: string | null; hasLine: boolean }) {
  const [extra, setExtra] = useState<{ id: string; features?: TrailFeature[]; profile?: [number, number][] }>({ id: t.id });
  useEffect(() => {
    if (!hasLine) return;
    let live = true;
    const base = `/api/trail-catalog/${encodeURIComponent(t.id)}`;
    cachedJson<{ features?: TrailFeature[] }>(`${base}/features`).then((d) => { if (live) setExtra((e) => ({ ...(e.id === t.id ? e : { id: t.id }), features: d.features ?? [] })); }).catch(() => undefined);
    cachedJson<ElevationProfile>(`${base}/elevation`).then((d) => { if (live && d.profile?.length > 5) setExtra((e) => ({ ...(e.id === t.id ? e : { id: t.id }), profile: d.profile })); }).catch(() => undefined);
    return () => { live = false; };
  }, [t.id, hasLine]);
  const mine = extra.id === t.id ? extra : { id: t.id };
  const parts = describeTrailParts(t, { difficulty, time, features: mine.features, profile: mine.profile });
  return (
    <p>
      {parts.map((p, i) => (typeof p === "string" ? <span key={i}>{p}</span> : <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>))}
    </p>
  );
}
