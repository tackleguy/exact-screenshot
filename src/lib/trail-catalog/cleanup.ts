/**
 * Trail-data cleanup applied by the data build (scripts/prepare-trail-assets.ts) so every page shows the same
 * cleaned names, route types and order: names without source ids or glued-on review flags, junk segments dropped,
 * near-duplicate trails folded into the longer one, and route type read from the geometry.
 */
import { chainLines, metersBetween } from "@/lib/geo/line";
import type { CatalogTrail } from "./types";

type LngLat = [number, number];

/** Trailing source ids: "Napoleon Canyon (32092)", "Lake Trail (T-1043)". */
const SOURCE_ID = /\s*\((?:[A-Z]{0,4}[- ]?)?\d{3,}[A-Z]?\)\s*$/i;
/** Any "(digits)" in a name: junction numbers of walking networks ("Hude (57) - Hude (84)") and source ids. */
const NUMBER_TAG = /\s*\(\d+\)/g;
/** A phone number pasted into a name ("233 Trailhead: (936) 344-6205"). */
const PHONE = /[\s:]*\(?\b\d{3}\)?[ .-]?\d{3}[ .-]\d{4}\b/g;
/** Review wording a source glued onto the name ("StanislausNeeds review"). */
const REVIEW_SUFFIX = /\s*[-–(]?\s*needs?\s*review\)?\s*$/i;
/** Long-distance trail initials that sources write in mixed case. */
const ACRONYMS: Record<string, string> = { pct: "PCT", cdt: "CDT", jmt: "JMT", azt: "AZT", trt: "TRT", nct: "NCT", fht: "FHT", gdt: "GDT" };
const SMALL_WORDS = /^(of|the|and|to|at|on|in|a|an|de|du|la|le|des|del|von|der|di)$/;

function titleCase(name: string) {
  return name.toLowerCase().replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, (word, offset: number) => (offset > 0 && SMALL_WORDS.test(word) ? word : word[0].toUpperCase() + word.slice(1)));
}

/** A display name for a trail, and whether the source flagged it for review inside the name. */
export function cleanTrailName(raw: string): { name: string; needsReview: boolean } {
  let name = raw.replace(/\s+/g, " ").trim();
  let needsReview = false;
  if (REVIEW_SUFFIX.test(name)) { name = name.replace(REVIEW_SUFFIX, "").trim(); needsReview = true; }
  name = name.replace(SOURCE_ID, "").replace(PHONE, "").trim();
  if (/\(\d+\)/.test(name)) {
    const numbers = name.match(/\d+/g) ?? [];
    const stripped = name.replace(NUMBER_TAG, "").replace(/^[\s:–-]+|[\s:–-]+$/g, "").replace(/\s{2,}/g, " ");
    // "Hude (57) - Hude (84)" becomes "Hude"; a name that was only numbers ("(15) - (38)") becomes "Trail 15–38".
    const sides = stripped.split(/\s+[-–]\s+/);
    name = !/\p{L}/u.test(stripped) ? `Trail ${numbers.join("–")}` : sides.length === 2 && sides[0].toLowerCase() === sides[1].toLowerCase() ? sides[0] : stripped;
  }
  const letters = name.replace(/[^\p{L}]/gu, "");
  // Only all-caps or all-lowercase names are re-cased; "McKenzie Pass" or "Sentier du Mont" are kept as written.
  if (letters.length > 3 && (letters === letters.toUpperCase() || letters === letters.toLowerCase()) && /[A-Za-z]/.test(letters)) name = titleCase(name);
  name = name.replace(/\b[A-Za-z]{3}\b/g, (w) => ACRONYMS[w.toLowerCase()] ?? w);
  return { name: name || raw.trim(), needsReview };
}

/** Names that mark a driveway, road, parking area or sidewalk rather than a trail. */
const JUNK_NAME = /^(driveway|private drive(way)?|road|service road|access road|parking( lot| area)?|parking access|sidewalk)$/i;
export const JUNK_MIN_MILES = 0.15;

/** True for segments that are not hikes: junk names, or under 0.15 mi unless part of a named route or a loop. */
export function isJunkSegment(t: Pick<CatalogTrail, "name" | "miles" | "kind" | "partOfRoute" | "routeType">): boolean {
  if (t.kind === "route") return false;
  if (JUNK_NAME.test(t.name.trim())) return true;
  return t.miles !== null && t.miles < JUNK_MIN_MILES && !t.partOfRoute && t.routeType !== "loop";
}

/** Route type from the line: loop, out & back, point to point, or a trail segment when it can't be told. */
export function routeTypeFromLines(lines: LngLat[][]): "loop" | "out-and-back" | "point-to-point" | "segment" {
  const pieces = chainLines(lines.filter((l) => l.length >= 2));
  if (!pieces.length) return "segment";
  // Pieces only count as one path when each starts where the last ended (within 50 m).
  for (let i = 1; i < pieces.length; i++) {
    const end = pieces[i - 1][pieces[i - 1].length - 1];
    if (metersBetween(end, pieces[i][0]) > 50) return "segment";
  }
  const path = pieces.flat();
  if (path.length < 2) return "segment";
  // A line drawn out and back also ends where it started, so retracing is checked before closing.
  if (retraces(path)) return "out-and-back";
  return metersBetween(path[0], path[path.length - 1]) <= 150 ? "loop" : "point-to-point";
}

/**
 * True when more than 70% of the line's points have another point within 30 m that is travelling the opposite way
 * (the line goes out and comes back over itself).
 */
function retraces(path: LngLat[]): boolean {
  const step = Math.max(1, Math.floor(path.length / 400));
  const pts = path.filter((_, i) => i % step === 0);
  if (pts.length < 6) return false;
  const k = Math.cos((pts[0][1] * Math.PI) / 180) * 111_320, ky = 110_540, cell = 30;
  const xy = pts.map(([lng, lat]) => [lng * k, lat * ky] as const);
  const dir = xy.map((p, i) => { const q = xy[Math.min(xy.length - 1, i + 1)], o = xy[Math.max(0, i - 1)]; return [q[0] - o[0], q[1] - o[1]] as const; });
  const grid = new Map<string, number[]>();
  xy.forEach(([x, y], i) => { const key = `${Math.floor(x / cell)}:${Math.floor(y / cell)}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(i); });
  let hits = 0;
  xy.forEach(([x, y], i) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    outer: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
        if (Math.abs(j - i) < 3) continue;
        if (Math.hypot(xy[j][0] - x, xy[j][1] - y) > cell) continue;
        if (dir[i][0] * dir[j][0] + dir[i][1] * dir[j][1] < 0) { hits++; break outer; }
      }
    }
  });
  return hits / xy.length > 0.7;
}

/** Name key for spotting the same trail twice: lowercase words without "trail", "loop", "path" and the park's own name. */
export function dedupeKey(t: Pick<CatalogTrail, "name" | "park" | "forest">): string {
  const place = new Set(`${t.park ?? ""} ${t.forest ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(national|state|park|forest|recreation|area)$/.test(w)));
  return t.name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !/^(trail|trails|loop|path|the)$/.test(w) && !place.has(w)).join(" ");
}

/** Share of the shorter line's points lying within 30 m of the longer line's points. */
export function overlapShare(shorter: LngLat[][], longer: LngLat[][]): number {
  const pts = shorter.flat(), other = longer.flat();
  if (!pts.length || !other.length) return 0;
  const k = Math.cos((pts[0][1] * Math.PI) / 180) * 111_320, ky = 110_540, cell = 30;
  const grid = new Set(other.map(([lng, lat]) => `${Math.floor((lng * k) / cell)}:${Math.floor((lat * ky) / cell)}`));
  const step = Math.max(1, Math.floor(pts.length / 500));
  let near = 0, n = 0;
  for (let i = 0; i < pts.length; i += step) {
    n++;
    const cx = Math.floor((pts[i][0] * k) / cell), cy = Math.floor((pts[i][1] * ky) / cell);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) hit = grid.has(`${cx + dx}:${cy + dy}`);
    if (hit) near++;
  }
  return near / n;
}

/** Score for "best-documented first": a real name, a real length (1 mi or more), a measured climb, agency-verified. */
export function listScore(t: Pick<CatalogTrail, "name" | "miles" | "gainFt" | "tier" | "qualityScore" | "kind">): number {
  const named = !/^unnamed/i.test(t.name) && t.name.trim().split(/\s+/).length >= 1;
  return (named ? 20 : 0) + ((t.miles ?? 0) >= 1 || t.kind === "route" ? 40 : 0) + (Number.isFinite(t.gainFt) ? 10 : 0) + (t.tier === "verified" ? 20 : 0) + Math.max(0, Math.min(10, (t.qualityScore ?? 0) / 10));
}

/** Real hikes (1 mi or longer, or whole routes) before short stubs, whatever else the order is. */
export const realHike = (t: Pick<CatalogTrail, "miles" | "kind">) => (t.miles ?? 0) >= 1 || t.kind === "route";
