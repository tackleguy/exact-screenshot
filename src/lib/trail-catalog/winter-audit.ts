import type { CatalogTrail } from "./types";
import { PisteIndex, matchSkiRun, type SkiRunCache } from "./ski-runs";
import { LineIndex, DUPLICATE_SHARE } from "./additions";
import { normalizeTrailName } from "./through-hikes";

type Lines = [number, number][][];

/** USFS snow trails where no summer use is allowed: SNOW trail type with no hiker season. */
export const USFS_SNOW_WHERE = "trail_type='SNOW' AND hiker_pedestrian_managed IS NULL AND hiker_pedestrian_accpt IS NULL";

/** Lift lines, tubing hills and race courses: never hiking trails, whatever share of a piste they cover. */
const LIFT_OR_COURSE = /\b(chair ?lift|chairlift|chair \d+|ski ?lift|lift line|t ?bar|poma|rope tow|gondola line|tubing( hill)?|slalom|terrain park|half ?pipe|mogul|race course)\b/;
/** Winter-only names the shared winter filter does not catch (USFS "… SNOW" codes, snomo). */
const WINTER_NAME = /\b(snomo|sno mo|snowcat|groomed)\b|\bsnow$/;
const PLACE = /\bsnow\s+(canyon|creek|lake|peak|mountain|river|pass|basin|valley|lakes|bowl trail)\b/;

export interface WinterVerdict { use: "downhill" | "oversnow"; reason: string }

/**
 * Second pass after the main piste match: catches ski infrastructure on pistes, USFS winter-only
 * routes, and winter names. Summer trails that only cross ski runs are left alone.
 */
export function winterVerdict(
  row: Pick<CatalogTrail, "name" | "winterUse" | "sources">,
  lines: Lines,
  pistes: PisteIndex,
  downhillOnly: PisteIndex,
  usfsSnow: LineIndex | null,
): WinterVerdict | null {
  if (row.winterUse === "downhill") return null;
  const name = normalizeTrailName(row.name);
  if (WINTER_NAME.test(name) && !PLACE.test(name)) return { use: "oversnow", reason: "winter-only name" };
  const touchesDownhill = downhillShare(lines, downhillOnly);
  if (/^(chair ?lift|chairlift|ski ?lift|rope tow|t ?bar|poma|tubing hill)$/.test(name)) return { use: "downhill", reason: "lift line or course on a downhill piste" };
  if (touchesDownhill >= 0.3 && LIFT_OR_COURSE.test(name)) return { use: "downhill", reason: "lift line or course on a downhill piste" };
  if (usfsSnow) {
    const hasUsfsHiking = row.sources?.some((s) => s.type === "USFS_OFFICIAL");
    if (!hasUsfsHiking && usfsSnow.coveredShare(lines) >= DUPLICATE_SHARE) return { use: "oversnow", reason: "official USFS snow-only trail" };
  }
  const match = matchSkiRun(row.name, lines, pistes);
  if (match?.use === "downhill") return { use: "downhill", reason: "follows a downhill piste" };
  return null;
}

/** Share of a trail's vertices within 30 m of a downhill piste, in any direction. */
function downhillShare(lines: Lines, downhillOnly: PisteIndex) {
  let n = 0, hit = 0;
  for (const line of lines) for (const p of line) {
    n++;
    const xy: [number, number] = [p[0] * 111_320 * Math.cos((p[1] * Math.PI) / 180), p[1] * 110_540];
    if (downhillOnly.near(xy, [0, 0]).size) hit++;
  }
  return n ? hit / n : 0;
}

export function pisteIndexes(ski: SkiRunCache) {
  return {
    pistes: new PisteIndex(ski.runs),
    downhillOnly: new PisteIndex(ski.runs.filter((r) => r.uses.some((u) => ["downhill", "snow_park", "sled"].includes(u)))),
  };
}
