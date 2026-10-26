"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { googleMapsDirectionsUrl } from "@/lib/trail-catalog/access";
import { formatDistance } from "@/lib/units";

type Near = CatalogTrail & { distanceKm: number };
const TIMEOUT_MS = 5000;

/** Up to 5 trails near this one, nearest first; gives up after 5 seconds rather than spinning forever. */
export function NearbyTrails({ trailId }: { trailId: string }) {
  const [state, setState] = useState<{ id: string; trails: Near[] } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    fetch(`/api/trail-catalog/${encodeURIComponent(trailId)}/nearby`, { signal: controller.signal })
      .then(async (r) => (r.ok ? ((await r.json()) as { trails?: Near[] }).trails ?? [] : []))
      .catch(() => [] as Near[])
      .then((trails) => setState({ id: trailId, trails }))
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [trailId]);
  const trails = state?.id === trailId ? state.trails : null;
  return (
    <div className="hx-nearby">
      <h4>Nearby trails</h4>
      {trails === null ? <p role="status">Finding nearby trails…</p> : trails.length === 0 ? <p>No nearby trails found.</p> : (
        <ul>
          {trails.slice(0, 5).map((t) => (
            <li key={t.id}>
              <Link href={`/explore/trails?trail=${encodeURIComponent(t.id)}&lat=${t.latitude}&lng=${t.longitude}&z=12`}><strong>{t.name}</strong><small>{formatDistance(t.distanceKm / 1.609344)} away</small></Link>
              <a href={googleMapsDirectionsUrl(t.trailhead?.latitude ?? t.latitude, t.trailhead?.longitude ?? t.longitude)} target="_blank" rel="noopener noreferrer" aria-label={`Directions to ${t.name}`} title="Directions to the mapped access point">↗</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
