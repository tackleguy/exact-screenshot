import { normalizeTrailName } from "./through-hikes";

type Point = [number, number];
type Lines = Point[][];

export interface SkiRun {
  name: string | null;
  /** OpenSkiMap uses: downhill, nordic, skitour, sled, snow_park, hike, … */
  uses: string[];
  difficulty: string | null;
  areaId: string | null;
  areaName: string | null;
  lines: Lines;
}
export interface SkiAreaPoint { id: string; name: string | null; activities: string[]; point: Point; website: string | null }
export interface SkiRunCache { retrievedAt: string; runs: SkiRun[]; areas: SkiAreaPoint[] }

/** downhill: a ski run; oversnow: a winter-only route (snowmobile, USFS snow trail); nordic: a groomed track on a summer trail. */
export type WinterUse = "downhill" | "oversnow" | "nordic";
export interface SkiMatch { use: WinterUse; share: number; runName: string | null; areaName: string | null; nameMatches: boolean }

/** A sample counts as on a piste within this distance (generalized source lines are offset by ~10–20 m). */
export const PISTE_METERS = 30;
/** Share of a trail's length that must lie on pistes of one kind. */
export const PISTE_SHARE = 0.6;
const SAMPLE_METERS = 25;
const ALIGN_DEGREES = 35;
const ALIGN_COS = Math.cos((ALIGN_DEGREES * Math.PI) / 180);
const MAX_SAMPLES = 400;

const DOWNHILL_USES = new Set(["downhill", "snow_park", "sled", "sleigh", "playground"]);
const NORDIC_USES = new Set(["nordic"]);
/** Names a resort gives to summer foot trails that happen to follow a piste. */
const FOOT_NAME = /\b(hik(e|ing)|nature|interpretive|walk|footpath|summer|wildflower|fitness)\b/;

const RAD = Math.PI / 180;
type XY = [number, number];
const toXY = ([lng, lat]: Point): XY => [lng * 111_320 * Math.cos(lat * RAD), lat * 110_540];
const cellSize = PISTE_METERS * 2;
const key = (cx: number, cy: number) => (cx + 2_097_152) * 4_194_304 + (cy + 2_097_152);

function distanceToSegment(p: XY, a: XY, b: XY) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Spatial hash of piste segments. The projection is per-point, which is accurate at 30 m scales. */
export class PisteIndex {
  private cells = new Map<number, number[]>();
  private segments: { run: number; a: XY; b: XY }[] = [];
  constructor(public runs: SkiRun[]) {
    runs.forEach((run, index) => {
      if (!run.uses.some((u) => DOWNHILL_USES.has(u) || NORDIC_USES.has(u))) return;
      for (const line of run.lines) {
        for (let i = 1; i < line.length; i++) {
          const a = toXY(line[i - 1]), b = toXY(line[i]);
          const segment = this.segments.push({ run: index, a, b }) - 1;
          const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (cellSize / 2)));
          let last = NaN;
          for (let s = 0; s <= steps; s++) {
            const k = key(Math.floor((a[0] + (b[0] - a[0]) * s / steps) / cellSize), Math.floor((a[1] + (b[1] - a[1]) * s / steps) / cellSize));
            if (k === last) continue;
            last = k;
            const bucket = this.cells.get(k);
            if (!bucket) this.cells.set(k, [segment]); else if (bucket[bucket.length - 1] !== segment) bucket.push(segment);
          }
        }
      }
    });
  }

  /**
   * Runs with a segment within PISTE_METERS of p that heads the same way as `direction` (within
   * ALIGN_DEGREES, either way along the line). A summer trail that switchbacks across a slope crosses
   * pistes; a mapped ski run follows one.
   */
  near(p: XY, direction: XY) {
    const found = new Set<number>();
    const cx = Math.floor(p[0] / cellSize), cy = Math.floor(p[1] / cellSize);
    const dl = Math.hypot(direction[0], direction[1]);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const index of this.cells.get(key(x, y)) ?? []) {
        const s = this.segments[index];
        if (found.has(s.run) || distanceToSegment(p, s.a, s.b) > PISTE_METERS) continue;
        const sx = s.b[0] - s.a[0], sy = s.b[1] - s.a[1], sl = Math.hypot(sx, sy);
        if (dl > 0 && sl > 0 && Math.abs(sx * direction[0] + sy * direction[1]) / (sl * dl) < ALIGN_COS) continue;
        found.add(s.run);
      }
    }
    return found;
  }
}

function samples(lines: Lines) {
  let total = 0;
  for (const line of lines) for (let i = 1; i < line.length; i++) total += Math.hypot(...(([a, b]) => [b[0] - a[0], b[1] - a[1]] as [number, number])([toXY(line[i - 1]), toXY(line[i])]));
  const spacing = Math.max(SAMPLE_METERS, total / MAX_SAMPLES);
  const out: { p: XY; direction: XY }[] = [];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = toXY(line[i - 1]), b = toXY(line[i]);
      const direction: XY = [b[0] - a[0], b[1] - a[1]];
      const steps = Math.max(1, Math.ceil(Math.hypot(direction[0], direction[1]) / spacing));
      for (let s = i === 1 ? 0 : 1; s <= steps; s++) out.push({ p: [a[0] + direction[0] * s / steps, a[1] + direction[1] * s / steps], direction });
    }
  }
  return out;
}

/**
 * Decides whether a mapped trail is really a ski piste. Downhill runs are the ones to take out of hiking
 * results; a trail that shares its line with a Nordic track is still walkable in summer, so it only gains
 * the ski activity. A foot-trail name on a downhill run (e.g. "Wildflower Hike") keeps the trail hikeable.
 */
export function matchSkiRun(name: string, lines: Lines, index: PisteIndex): SkiMatch | null {
  const points = samples(lines);
  if (!points.length) return null;
  let downhill = 0, nordic = 0;
  const hits = new Map<number, number>();
  for (const { p, direction } of points) {
    let d = false, n = false;
    for (const run of index.near(p, direction)) {
      hits.set(run, (hits.get(run) ?? 0) + 1);
      const uses = index.runs[run].uses;
      if (uses.some((u) => DOWNHILL_USES.has(u))) d = true;
      if (uses.some((u) => NORDIC_USES.has(u))) n = true;
    }
    if (d) downhill++;
    if (n) nordic++;
  }
  const own = normalizeTrailName(name);
  let best = -1, bestHits = 0, nameMatches = false;
  for (const [run, count] of hits) {
    const runName = index.runs[run].name ? normalizeTrailName(index.runs[run].name!) : "";
    const same = runName !== "" && (runName === own || own.includes(runName) || runName.includes(own));
    if (same && !nameMatches) { nameMatches = true; best = run; bestHits = count; continue; }
    if (!nameMatches && count > bestHits) { best = run; bestHits = count; }
  }
  const run = best >= 0 ? index.runs[best] : null;
  const downhillShare = downhill / points.length, nordicShare = nordic / points.length;
  if (downhillShare >= PISTE_SHARE && !FOOT_NAME.test(own)) {
    return { use: "downhill", share: downhillShare, runName: run?.name ?? null, areaName: run?.areaName ?? null, nameMatches };
  }
  if (nordicShare >= PISTE_SHARE) return { use: "nordic", share: nordicShare, runName: run?.name ?? null, areaName: run?.areaName ?? null, nameMatches };
  return null;
}
