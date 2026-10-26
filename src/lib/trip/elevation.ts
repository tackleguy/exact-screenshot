import { elevations, type LngLat } from "@/lib/geo/tiles";
import { MILE_METERS, Route, round } from "@/lib/geo/line";

export interface ElevationProfile {
  /** [mile, feet] pairs along the trail. */
  profile: [number, number][];
  gainFt: number;
  lossFt: number;
  minFt: number;
  maxFt: number;
  trailMiles: number;
  /** True when some elevation tiles could not be read; totals then cover only part of the trail. */
  partial: boolean;
  attribution: string;
}

/** Ignore wiggles smaller than this when adding up climb (DEM noise would otherwise inflate gain). */
const HYSTERESIS_M = 4;

/** Climb and descent with hysteresis, from evenly spaced elevations. */
export function climb(meters: number[]) {
  let gain = 0, loss = 0, ref = NaN;
  for (const m of meters) {
    if (!Number.isFinite(m)) continue;
    if (!Number.isFinite(ref)) { ref = m; continue; }
    if (m - ref >= HYSTERESIS_M) { gain += m - ref; ref = m; }
    else if (ref - m >= HYSTERESIS_M) { loss += ref - m; ref = m; }
  }
  return { gain, loss };
}

/** Elevation profile from AWS Terrarium tiles (Mapzen/USGS 3DEP and SRTM blend, ~10–30 m resolution in the U.S.). */
export async function elevationProfile(trailLines: LngLat[][], samples = 300): Promise<ElevationProfile | null> {
  const route = new Route(trailLines);
  if (!route.points.length) return null;
  const points = route.sample(25, samples);
  // Sparse samples (long trails) don't need street-level terrain tiles: coarser tiles cover many samples each, so
  // a 2,650-mile trail needs dozens of downloads instead of hundreds.
  const spacing = route.meters / Math.max(1, points.length - 1);
  const zoom = spacing > 5000 ? 9 : spacing > 1500 ? 11 : 13;
  const meters = await elevations(points.map((s) => s.p), zoom);
  const valid = meters.filter(Number.isFinite);
  if (!valid.length) return null;
  const { gain, loss } = climb(meters);
  const ft = (m: number) => Math.round(m * 3.28084);
  return {
    profile: points.flatMap((s, i) => (Number.isFinite(meters[i]) ? [[round(s.alongMeters / MILE_METERS, 2), ft(meters[i])] as [number, number]] : [])),
    gainFt: ft(gain),
    lossFt: ft(loss),
    minFt: ft(Math.min(...valid)),
    maxFt: ft(Math.max(...valid)),
    trailMiles: round(route.meters / MILE_METERS, 2),
    partial: valid.length < meters.length,
    attribution: "Elevation: AWS Terrain Tiles (Mapzen terrarium; USGS 3DEP, SRTM and other public sources). Totals are estimates from sampled ground elevation.",
  };
}
