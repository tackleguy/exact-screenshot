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

/** Gaps up to this long are mapping slop between pieces of one path (a missing junction, a road crossing). */
export const SMALL_GAP_M = 300;
/** This many separate pieces (after joining small gaps) make a network of paths rather than one trail. */
const NETWORK_PIECES = 6;

/**
 * Route type from the line: loop, out & back or point to point when the pieces form one path (gaps up to 300 m
 * count as joined); "segment" ("In sections") when a few pieces are separated by bigger gaps; "network" ("Trail
 * network") for a park's path system of many pieces.
 */
export function routeTypeFromLines(lines: LngLat[][]): "loop" | "out-and-back" | "point-to-point" | "segment" | "network" {
  const usable = lines.filter((l) => l.length >= 2);
  // Chaining is quadratic in the number of pieces; a relation mapped as hundreds of ways is a network, not one path.
  if (usable.length > 150) return "network";
  const pieces = chainLines(usable);
  if (!pieces.length) return "segment";
  let separate = 1;
  for (let i = 1; i < pieces.length; i++) {
    const end = pieces[i - 1][pieces[i - 1].length - 1];
    if (metersBetween(end, pieces[i][0]) > SMALL_GAP_M) separate++;
  }
  if (separate >= NETWORK_PIECES) return "network";
  if (separate > 1) return "segment";
  const path = pieces.length === 1 ? pieces[0] : pieces.flat();
  if (path.length < 2) return "segment";
  // A line drawn out and back also ends where it started, so retracing is checked before closing.
  if (retraces(path)) return "out-and-back";
  return metersBetween(path[0], path[path.length - 1]) <= 150 ? "loop" : "point-to-point";
}

/** Collision-free safe-integer key for 30 m grid cells anywhere on Earth (|gx|, |gy| < 700,000). */
const gridCellKey = (gx: number, gy: number) => (gx + 1_000_000) * 2_000_000 + (gy + 1_000_000);

/**
 * True when more than 70% of the line's points have another point within 30 m that is travelling the opposite way
 * (the line goes out and comes back over itself).
 */
function retraces(path: LngLat[]): boolean {
  const step = Math.max(1, Math.floor(path.length / 400));
  const n = Math.ceil(path.length / step);
  if (n < 6) return false;
  const k = Math.cos((path[0][1] * Math.PI) / 180) * 111_320, ky = 110_540, cell = 30, cell2 = cell * cell;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0, src = 0; i < n; i++, src += step) {
    xs[i] = path[src][0] * k;
    ys[i] = path[src][1] * ky;
  }
  const dxs = new Float64Array(n), dys = new Float64Array(n);
  const grid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const nxt = i + 1 < n ? i + 1 : n - 1;
    const prv = i > 0 ? i - 1 : 0;
    dxs[i] = xs[nxt] - xs[prv];
    dys[i] = ys[nxt] - ys[prv];
    const key = gridCellKey(Math.floor(xs[i] / cell), Math.floor(ys[i] / cell));
    let bucket = grid.get(key);
    if (!bucket) { bucket = []; grid.set(key, bucket); }
    bucket.push(i);
  }
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i], dirX = dxs[i], dirY = dys[i];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    outer: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.get(gridCellKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (let b = 0; b < bucket.length; b++) {
        const j = bucket[b];
        if (j - i < 3 && i - j < 3) continue;
        const ox = xs[j] - x, oy = ys[j] - y;
        if (ox * ox + oy * oy > cell2) continue;
        if (dirX * dxs[j] + dirY * dys[j] < 0) { hits++; break outer; }
      }
    }
  }
  return hits / n > 0.7;
}

/** Name key for spotting the same trail twice: lowercase words without "trail", "loop", "path" and the park's own name. */
export function dedupeKey(t: Pick<CatalogTrail, "name" | "park" | "forest">): string {
  const place = new Set(`${t.park ?? ""} ${t.forest ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(national|state|park|forest|recreation|area)$/.test(w)));
  return t.name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !/^(trail|trails|loop|path|the)$/.test(w) && !place.has(w)).join(" ");
}

/** Share of the shorter line's points lying within 30 m of the longer line's points. */
export function overlapShare(shorter: LngLat[][], longer: LngLat[][]): number {
  let ptsLen = 0, firstLat = 0, hasFirst = false;
  for (let i = 0; i < shorter.length; i++) {
    const line = shorter[i];
    if (!hasFirst && line.length > 0) { firstLat = line[0][1]; hasFirst = true; }
    ptsLen += line.length;
  }
  if (!ptsLen) return 0;
  const k = Math.cos((firstLat * Math.PI) / 180) * 111_320, ky = 110_540, cell = 30;
  const grid = new Set<number>();
  for (let i = 0; i < longer.length; i++) {
    const line = longer[i];
    for (let j = 0; j < line.length; j++) {
      grid.add(gridCellKey(Math.floor((line[j][0] * k) / cell), Math.floor((line[j][1] * ky) / cell)));
    }
  }
  if (!grid.size) return 0;
  const step = Math.max(1, Math.floor(ptsLen / 500));
  let near = 0, n = 0, nextIdx = 0, seen = 0;
  for (let i = 0; i < shorter.length; i++) {
    const line = shorter[i];
    while (nextIdx - seen < line.length) {
      const p = line[nextIdx - seen];
      n++;
      const cx = Math.floor((p[0] * k) / cell), cy = Math.floor((p[1] * ky) / cell);
      let hit = false;
      for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) hit = grid.has(gridCellKey(cx + dx, cy + dy));
      if (hit) near++;
      nextIdx += step;
    }
    seen += line.length;
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
