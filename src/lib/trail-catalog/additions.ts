import { metersBetween, type Lines, type Point } from "./quality";

/** A new source line within this distance of an existing catalog line is the same trail. */
export const DUPLICATE_METERS = 25;
/** Share of a new line that must already be in the catalog for it to be a duplicate. */
export const DUPLICATE_SHARE = 0.6;
/** New trails must be at least this long. */
export const MIN_NEW_TRAIL_MILES = 0.3;
/** Mountain terrain: elevation varies at least this much across the trail and 1 km around it. */
export const MOUNTAIN_RELIEF_METERS = 100;
/** …or the trail itself climbs at least this much between its lowest and highest sampled points. */
export const MOUNTAIN_CLIMB_METERS = 60;
/** Distance of the four surrounding terrain samples from the trail's middle. */
export const SURROUND_METERS = 1000;

const RAD = Math.PI / 180;
type XY = [number, number];
const toXY = ([lng, lat]: Point): XY => [lng * 111_320 * Math.cos(lat * RAD), lat * 110_540];
const key = (x: number, y: number) => (x + 2_097_152) * 4_194_304 + (y + 2_097_152);

function segDist(p: XY, a: XY, b: XY) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Spatial hash of existing catalog lines that answers "how much of this new line is already listed, and
 * by which record?". Segments live in typed arrays so ~500k source lines fit in memory.
 */
export class LineIndex {
  private cells = new Map<number, number[]>();
  private readonly cell: number;
  /** `radius`: how close (m) a point must be to an indexed line to count as on it. */
  constructor(private readonly radius = DUPLICATE_METERS) { this.cell = radius * 2; }
  private coords = new Float64Array(1 << 16);
  private owners = new Int32Array(1 << 14);
  private count = 0;
  private ownerIds: string[] = [];

  add(lines: Lines, ownerId = "") {
    const owner = this.ownerIds.push(ownerId) - 1;
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = toXY(line[i - 1]), b = toXY(line[i]);
        const segment = this.count++;
        if (segment * 4 + 4 > this.coords.length) { const next = new Float64Array(this.coords.length * 2); next.set(this.coords); this.coords = next; }
        if (segment + 1 > this.owners.length) { const next = new Int32Array(this.owners.length * 2); next.set(this.owners); this.owners = next; }
        this.coords.set([a[0], a[1], b[0], b[1]], segment * 4);
        this.owners[segment] = owner;
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (this.cell / 2)));
        let last = NaN;
        for (let s = 0; s <= steps; s++) {
          const k = key(Math.floor((a[0] + (b[0] - a[0]) * s / steps) / this.cell), Math.floor((a[1] + (b[1] - a[1]) * s / steps) / this.cell));
          if (k === last) continue;
          last = k;
          const bucket = this.cells.get(k);
          if (bucket) bucket.push(segment); else this.cells.set(k, [segment]);
        }
      }
    }
  }

  /** Owners with a segment within `radius` of p. */
  private near(p: XY, found: Set<number>) {
    const cx = Math.floor(p[0] / this.cell), cy = Math.floor(p[1] / this.cell);
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const segment of this.cells.get(key(x, y)) ?? []) {
        const o = segment * 4, c = this.coords;
        if (segDist(p, [c[o], c[o + 1]], [c[o + 2], c[o + 3]]) <= this.radius) found.add(this.owners[segment]);
      }
    }
  }

  /** Share of `lines` (sampled every ~20 m) on any indexed line, and the indexed record it overlaps most. */
  bestMatch(lines: Lines): { share: number; ownerId: string | null } {
    let total = 0, hit = 0;
    const perOwner = new Map<number, number>();
    const found = new Set<number>();
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = toXY(line[i - 1]), b = toXY(line[i]);
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 20));
        for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
          total++;
          found.clear();
          this.near([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps], found);
          if (found.size) hit++;
          for (const o of found) perOwner.set(o, (perOwner.get(o) ?? 0) + 1);
        }
      }
    }
    let best = -1, bestHits = 0;
    for (const [o, n] of perOwner) if (n > bestHits) { best = o; bestHits = n; }
    return { share: total ? hit / total : 0, ownerId: best >= 0 ? this.ownerIds[best] : null };
  }

  /** Share of `lines` on each indexed record it touches. */
  ownerShares(lines: Lines): Map<string, number> {
    let total = 0;
    const perOwner = new Map<number, number>();
    const found = new Set<number>();
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const a = toXY(line[i - 1]), b = toXY(line[i]);
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 20));
        for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
          total++;
          found.clear();
          this.near([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps], found);
          for (const o of found) perOwner.set(o, (perOwner.get(o) ?? 0) + 1);
        }
      }
    }
    return new Map([...perOwner].map(([o, n]) => [this.ownerIds[o], total ? n / total : 0]));
  }

  coveredShare(lines: Lines) {
    return this.bestMatch(lines).share;
  }
}

/** Evenly spaced points along the lines (by distance), always including both ends. */
export function pointsAlong(lines: Lines, count: number): Point[] {
  const all = lines.flat();
  if (all.length <= count) return all;
  const cumulative: number[] = [0];
  for (let i = 1; i < all.length; i++) cumulative.push(cumulative[i - 1] + metersBetween(all[i - 1], all[i]));
  const total = cumulative[cumulative.length - 1];
  const out: Point[] = [];
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1);
    let i = cumulative.findIndex((c) => c >= target);
    if (i < 0) i = all.length - 1;
    out.push(all[i]);
  }
  return out;
}

/** Four points SURROUND_METERS north, east, south and west of `p`, to measure the terrain around a trail. */
export function surroundingPoints([lng, lat]: Point): Point[] {
  const dLat = SURROUND_METERS / 110_540, dLng = SURROUND_METERS / (111_320 * Math.cos(lat * RAD));
  return [[lng, lat + dLat], [lng + dLng, lat], [lng, lat - dLat], [lng - dLng, lat]];
}

export interface TerrainCheck { mountain: boolean; minMeters: number; maxMeters: number; reliefMeters: number; climbMeters: number }

/** Mountain terrain from sampled elevations: the land around the trail is steep, or the trail climbs. */
export function classifyTerrain(alongMeters: number[], aroundMeters: number[]): TerrainCheck {
  const along = alongMeters.filter(Number.isFinite), around = aroundMeters.filter(Number.isFinite);
  if (!along.length) return { mountain: false, minMeters: NaN, maxMeters: NaN, reliefMeters: 0, climbMeters: 0 };
  const minMeters = Math.min(...along), maxMeters = Math.max(...along);
  const everything = [...along, ...around];
  const reliefMeters = Math.max(...everything) - Math.min(...everything);
  const climbMeters = maxMeters - minMeters;
  return { mountain: reliefMeters >= MOUNTAIN_RELIEF_METERS || climbMeters >= MOUNTAIN_CLIMB_METERS, minMeters, maxMeters, reliefMeters, climbMeters };
}

/** NPS layer values that mean the trail is not a real, open, maintained foot trail. */
export const NPS_WHERE = [
  "TRLNAME IS NOT NULL AND TRLNAME <> ' ' AND TRLNAME <> ''",
  // Temporarily closed trails are real trails; they are kept and shown as closed.
  "TRLSTATUS IN ('Existing','Exisiting','Temporarily Closed')",
  "(ISEXTANT IS NULL OR ISEXTANT <> 'False')",
  "(TRLFEATTYPE IS NULL OR TRLFEATTYPE NOT IN ('Unofficial Trail','Unmaintained Trail','Unmaintained Trail Centerline'))",
  "(TRLTYPE IS NULL OR TRLTYPE NOT IN ('Sidewalk','Water Trail','Snow Trail','Ferry Route'))",
].join(" AND ");

/** USFS land trails with official evidence that hikers may use them (allowed use 1, or a hiker season). */
export const USFS_HIKING_WHERE = "trail_type='TERRA' AND trail_name IS NOT NULL AND (allowed_terra_use LIKE '%1%' OR hiker_pedestrian_managed IS NOT NULL OR hiker_pedestrian_accpt IS NOT NULL)";
/** USFS land trails where the Forest Service lists allowed uses and hiking is not one of them. */
export const USFS_NO_HIKING_WHERE = "trail_type='TERRA' AND allowed_terra_use IS NOT NULL AND allowed_terra_use <> 'N/A' AND allowed_terra_use NOT LIKE '%1%' AND hiker_pedestrian_managed IS NULL AND hiker_pedestrian_accpt IS NULL";
/** BLM routes managed for non-motorized or non-mechanized (foot and horse) public use. Layer 7 has no
 * GlobalID; its allowed-mode codes say who may use each route. */
const BLM_FIELDS = "OBJECTID,ROUTE_PRMRY_NM,ADMIN_ST,PLAN_MODE_TRNSPRT,PLAN_ACCESS_RSTRCT,PLAN_SEASON_RSTRCT_CODE,OBSRVE_SRFCE_TYPE,ROUTE_SPCL_DSGNTN_TYPE";
export const BLM_LAYERS = [
  { layer: 4, where: "ROUTE_PRMRY_NM IS NOT NULL", fields: `${BLM_FIELDS},GlobalID` },
  { layer: 5, where: "ROUTE_PRMRY_NM IS NOT NULL", fields: `${BLM_FIELDS},GlobalID` },
  { layer: 7, where: "ROUTE_PRMRY_NM IS NOT NULL AND PLAN_ALLOW_MODE_TRNSPRT IN ('HIK_ONLY','EQU_HIK_ONLY','BIKE_HIK_ONLY','NON_MOTO_SHARED')", fields: `${BLM_FIELDS},PLAN_ALLOW_MODE_TRNSPRT` },
];
/** Allowed uses from BLM mode codes. */
export function blmUses(a: Record<string, unknown>) {
  switch (a.PLAN_ALLOW_MODE_TRNSPRT) {
    case "HIK_ONLY": return ["Hiking"];
    case "EQU_HIK_ONLY": return ["Hiking", "Horses"];
    case "BIKE_HIK_ONLY": return ["Hiking", "Bikes"];
    case "NON_MOTO_SHARED": return ["Hiking", "Horses", "Bikes"];
  }
  return a.PLAN_MODE_TRNSPRT === "Non-Mechanized" ? ["Hiking", "Horses"] : ["Hiking", "Horses", "Bikes"];
}
