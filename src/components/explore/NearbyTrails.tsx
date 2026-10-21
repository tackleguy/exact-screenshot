"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
export function NearbyTrails({ trailId }: { trailId: string }) {
  const [data, setData] = useState<{ id: string; trails: (CatalogTrail & { distanceKm: number })[] } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setError(false);
    fetch(`/api/trail-catalog/${encodeURIComponent(trailId)}/nearby`, { signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error("Nearby trails unavailable"); return r.json(); })
      .then(result => { if (!controller.signal.aborted) setData({ id: trailId, trails: result.trails ?? [] }); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [trailId]);
  return <div className="hx-nearby"><h4>Nearby trails</h4>{error ? <p>Nearby trails couldn’t load.</p> : data?.id !== trailId ? <p role="status">Finding nearby trails…</p> : data.trails.length === 0 ? <p>No other mapped trails within 25 km.</p> : <ul>{data.trails.slice(0, 3).map(t => <li key={t.id}><Link href={`/map?trail=${encodeURIComponent(t.id)}&lat=${t.latitude}&lng=${t.longitude}&z=12`}><strong>{t.name}</strong><small>{t.distanceKm.toFixed(1)} km away</small></Link><a href={googleMapsDirectionsUrl(t.trailhead?.latitude ?? t.latitude, t.trailhead?.longitude ?? t.longitude)} target="_blank" rel="noopener noreferrer" aria-label={`Directions to ${t.name}`} title="Directions to the mapped access point">↗</a></li>)}</ul>}</div>;
}