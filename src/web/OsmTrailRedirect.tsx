import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import Link from "./compat/link";
import { loadOsmTrail } from "@/lib/osm-trail";
import type { CatalogTrail } from "@/lib/trail-catalog/types";

/**
 * Old /trail/osm/:id links (from tapping base-map paths) now open the catalog trail they belong to: named
 * OpenStreetMap ways are catalog trails ("Mapped · OpenStreetMap"), with the same full page as every other trail.
 */
export function OsmTrailRedirect({ id }: { id: string }) {
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const saved = loadOsmTrail(id);
    const search = new URLSearchParams(window.location.search);
    const point = saved?.lines[0]?.[0] ?? [Number(search.get("lng")), Number(search.get("lat"))];
    const way = id.match(/(\d+)/)?.[1];
    const controller = new AbortController();
    void (async () => {
      // The joined trail is listed under its smallest way id; try the way itself first.
      if (way) {
        for (const candidate of [`osm-w${way}`, `osm-w${Math.floor(Number(way) / 10)}`]) {
          const r = await fetch(`/api/trail-catalog/${candidate}`, { signal: controller.signal }).catch(() => null);
          if (r?.ok) { const d = (await r.json()) as { trail: CatalogTrail }; setTarget(d.trail.id); return; }
        }
      }
      if (!saved?.name || !point.every(Number.isFinite)) { setTarget(null); return; }
      const p = new URLSearchParams({ q: saved.name, lat: String(point[1]), lng: String(point[0]), radiusKm: "5", limit: "1", activity: "all" });
      const r = await fetch(`/api/trail-catalog?${p}`, { signal: controller.signal }).catch(() => null);
      const d = r?.ok ? ((await r.json()) as { trails: CatalogTrail[] }) : null;
      setTarget(d?.trails[0]?.id ?? null);
    })();
    return () => controller.abort();
  }, [id]);
  if (target) return <Navigate to={`/explore/trails/${encodeURIComponent(target)}`} replace />;
  return (
    <section className="fieldbook-page" role="status">
      <h1>{target === null ? "This path isn’t a listed trail" : "Finding this trail…"}</h1>
      {target === null && <p>It may be an unnamed path or a piece of a longer trail. <Link className="btn-ghost" href="/explore/trails">Open the trail map</Link></p>}
    </section>
  );
}
