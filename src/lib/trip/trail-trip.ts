import { getCatalogTrail } from "@/lib/trail-catalog/server";
import type { CatalogTrail } from "@/lib/trail-catalog/types";
import { chainLines } from "@/lib/geo/line";
import type { LngLat } from "@/lib/geo/tiles";
import { waterAlong, type WaterReport } from "./water";
import { loadTowns, townServices, townsNear, type TownNearTrail, type TownServices } from "./towns";
import { elevationProfile, type ElevationProfile } from "./elevation";

/** Per-trail results are cached for an hour; the underlying tiles are cached separately. */
const TTL = 3_600_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as Promise<T>;
  const value = make();
  value.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 3000) cache.delete(cache.keys().next().value!);
  return value;
}

export interface TrailForTrip {
  trail: CatalogTrail;
  /** Lines ordered end to end; a resort or guide trail without a line has none. */
  lines: LngLat[][];
}

export async function trailForTrip(id: string): Promise<TrailForTrip | null> {
  const detail = await getCatalogTrail(id);
  if (!detail) return null;
  return { trail: detail.trail, lines: chainLines(detail.lines as LngLat[][]) };
}

/** Lines to search around: the trail itself, or its pin when it has no mapped line. */
const searchLines = (t: TrailForTrip): LngLat[][] =>
  t.lines.length ? t.lines : [[[t.trail.longitude, t.trail.latitude], [t.trail.longitude + 0.00001, t.trail.latitude]]];

export const trailWater = (t: TrailForTrip): Promise<WaterReport | null> =>
  t.lines.length
    ? cached(`water:${t.trail.id}`, async () => {
        const report = await waterAlong(t.lines);
        if (report.unreadableTiles) setTimeout(() => cache.delete(`water:${t.trail.id}`), 0);
        return report;
      })
    : Promise.resolve(null);

/** Partial profiles (some tiles failed) are not cached, so the next request tries again. */
export const trailElevation = (t: TrailForTrip): Promise<ElevationProfile | null> =>
  t.lines.length
    ? cached(`elev:${t.trail.id}`, async () => {
        const profile = await elevationProfile(t.lines);
        if (profile?.partial) setTimeout(() => cache.delete(`elev:${t.trail.id}`), 0);
        return profile;
      })
    : Promise.resolve(null);

export interface TownWithServices extends TownNearTrail { services: TownServices | null }

export function trailTowns(t: TrailForTrip, maxMilesOff = 15, limit?: number): Promise<TownWithServices[]> {
  const long = t.trail.kind === "route" || (t.trail.miles ?? 0) > 60;
  const count = limit ?? (long ? Math.min(60, Math.ceil((t.trail.miles ?? 100) / 25)) : 6);
  return cached(`towns:${t.trail.id}:${maxMilesOff}:${count}`, async () => {
    const near = townsNear(await loadTowns(), searchLines(t), maxMilesOff, count);
    // Services are looked up a few at a time to stay polite to the tile server.
    const out: TownWithServices[] = [];
    for (let i = 0; i < near.length; i += 6) {
      const batch = await Promise.all(near.slice(i, i + 6).map(async (town) => ({ ...town, services: await townServices(town).catch(() => null) })));
      out.push(...batch);
    }
    return out;
  });
}
