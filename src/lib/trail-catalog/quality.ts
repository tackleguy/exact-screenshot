import defaults from "../../../config/trail-quality.json";
import type { CatalogTrail } from "./types";
import { normalizeTrailName } from "./through-hikes";

export type Point = [number, number];
export type Lines = Point[][];

export type QualityRules = Omit<typeof defaults, "$comment">;
export const QUALITY_RULES = Object.fromEntries(Object.entries(defaults).filter(([key]) => key !== "$comment")) as QualityRules;

/**
 * - ok: passed every automated check.
 * - short: under the short-trail threshold but otherwise clean; published as a short trail.
 * - review: published with a warning; something about geometry or distance needs a person to check.
 * - fragment: a piece of a longer trail, an unnamed stub or a connector; kept and linkable,
 *   but left out of default search and map results so it is not presented as a full hike.
 */
export type QualityStatus = "ok" | "short" | "review" | "fragment";
export type RouteType = "loop" | "point-to-point" | "network";

export const QUALITY_FLAGS = {
  "placeholder-name": "Source name is a placeholder; shown as Unnamed trail",
  unnamed: "No trail name in the source",
  connector: "Name marks a connector, spur, access path or road",
  "network-name": "Agency-wide name shared by many separate pieces",
  "fragment-of-longer-trail": "A longer trail with the same name is nearby; this is likely a disconnected piece of it",
  short: "Shorter than the short-trail threshold",
  "incomplete-geometry": "The source reports a much longer trail than the mapped line",
  "distance-mismatch": "Source-reported distance disagrees with the mapped line",
  disconnected: "Mapped line has gaps between pieces",
  "gps-jump": "Contains a straight jump longer than the jump threshold",
  "straight-line": "Drawn as straight lines only, not a traced path",
  "implausible-length": "Longer than any plausible single trail",
  "invalid-geometry": "Missing or invalid coordinates",
  closed: "Source name marks the trail closed, abandoned or decommissioned",
  sidewalk: "Sidewalk, road sidepath or on-street bike lane rather than a trail",
  motorized: "ATV, OHV, motorcycle or 4x4 route",
  "no-hiking": "The managing agency lists allowed uses and hiking is not one of them",
  "missing-region": "State or province could not be determined",
} as const;
export type QualityFlag = keyof typeof QUALITY_FLAGS;

const EARTH_METERS = 6_371_008.8;
const RAD = Math.PI / 180;
export const MILE_METERS = 1609.344;

export function metersBetween(a: Point, b: Point) {
  const h = Math.sin((b[1] - a[1]) * RAD / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin((b[0] - a[0]) * RAD / 2) ** 2;
  return EARTH_METERS * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function validPoint(p: unknown): p is Point {
  return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}

export interface GeometryMeasure {
  valid: boolean;
  meters: number;
  pieces: number;
  bounds: [number, number, number, number] | null;
  start: Point | null;
  end: Point | null;
  /** Longest single step between consecutive points. */
  maxStepMeters: number;
  /** Groups of pieces that touch (an end within `gapMeters` of another piece). 1 means continuous. */
  components: number;
  straightOnly: boolean;
}

/** Measures lines along their full path (never endpoint to endpoint). */
export function measureLines(lines: Lines | null | undefined, gapMeters = QUALITY_RULES.gapMeters): GeometryMeasure {
  const empty: GeometryMeasure = { valid: false, meters: 0, pieces: 0, bounds: null, start: null, end: null, maxStepMeters: 0, components: 0, straightOnly: false };
  if (!Array.isArray(lines) || lines.length === 0) return empty;
  if (lines.some((line) => !Array.isArray(line) || line.length < 2 || !line.every(validPoint))) return { ...empty, pieces: lines.length };
  let meters = 0, maxStep = 0, west = 180, south = 90, east = -180, north = -90;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const [x, y] = line[i];
      west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y);
      if (i > 0) {
        const step = metersBetween(line[i - 1], line[i]);
        meters += step;
        maxStep = Math.max(maxStep, step);
      }
    }
  }
  let components = 1;
  if (lines.length > 1 && lines.length <= 400) {
    // Pieces touch when either one's end is near the other (end-to-segment, so T-junctions count).
    const parent = lines.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const ends = (line: Point[]): Lines => [[line[0]], [line[line.length - 1]]];
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        if (find(i) === find(j)) continue;
        if (lineDistanceMeters(ends(lines[i]), [lines[j]]) <= gapMeters || lineDistanceMeters(ends(lines[j]), [lines[i]]) <= gapMeters) parent[find(i)] = find(j);
      }
    }
    components = new Set(lines.map((_, i) => find(i))).size;
  }
  const first = lines[0], last = lines[lines.length - 1];
  return {
    valid: true,
    meters,
    pieces: lines.length,
    bounds: [west, south, east, north],
    start: first[0],
    end: last[last.length - 1],
    maxStepMeters: maxStep,
    components,
    straightOnly: lines.every((line) => line.length === 2),
  };
}

export function routeTypeOf(measure: GeometryMeasure, rules: QualityRules = QUALITY_RULES): RouteType | null {
  if (!measure.valid) return null;
  if (measure.pieces > 1) return "network";
  const closes = measure.start && measure.end && metersBetween(measure.start, measure.end) <= rules.loopCloseMeters;
  return closes && measure.meters / MILE_METERS >= rules.loopMinMiles ? "loop" : "point-to-point";
}

const PLACEHOLDER_NAMES = new Set([
  "", "unnamed", "unnamed trail", "unnamed path", "unknown", "unknown trail", "no name", "noname", "none", "n a", "na", "null",
  "trail", "trails", "path", "temp", "tbd", "test", "unnamed street", "unnamed road", "x",
]);
const CONNECTOR = /\b(connector|connecting|spur|access|social trail|service road|sidewalk|walkway|entrance road|access road|driveway|parking|crosswalk|crossing|bypass|cutoff|cut off|link)\b/;
const NETWORK_NAME = /\b(county|city|town|township|village|borough|forest|park district|parks|university|campus)\b.*\btrails?\b|\b(trails|pathways|paths|trail system|trail network|greenways)$/;

export function isPlaceholderName(name: string) {
  const normalized = normalizeTrailName(name);
  return PLACEHOLDER_NAMES.has(normalized) || !/[a-z]/.test(normalized);
}
/** Sidewalks, road sidepaths and on-street bike lanes: pavement along a street, not a trail. */
const SIDEWALK = /\b(sidewalks?|side ?paths?|sidepaths?|cycle ?tracks?|cycletracks?|sharrows?|bike ?lanes?|signed bike routes?|crosswalks?)\b/;
/** Named after a city street ("1st Avenue", "Main Street", "B St."), which is a sidewalk in the source. */
const STREET_NAME = /^(?:(?:n|s|e|w|north|south|east|west)\s+)?(?:\d+(?:st|nd|rd|th)|[a-z]|[a-z]+(?:\s+[a-z]+)?)\s+(?:st|street|ave|avenue|blvd|boulevard)$/;
const NUMBERED_STREET = /^(?:(?:n|s|e|w|north|south|east|west)\s+)?(?:\d+(?:st|nd|rd|th)|[a-z])\s+(?:st|street|ave|avenue|blvd|boulevard)$/;
/** Agencies whose street-style names are trail nicknames (mountain-bike "Boulevards", canyon "Wall Street"). */
const WILDLAND_MANAGER = /\b(forest service|bureau of land management|game commission|fish and wildlife|wildlife resources)\b/i;
/** Generic paved-path labels; short pieces with these names are urban paths, not destinations. */
const GENERIC_PATH = /^(sidewalk or pathway|walking path|paved path|pathway|walkway|pedestrian path|multi ?use path|shared use path|concrete path|asphalt path)$/;
/** Named promenades and waterfront walks are destinations even when paved (e.g. Miami Riverwalk). */
const WALK_DESTINATION = /\b(river ?walk|boardwalk|promenade|esplanade|greenway|seawall|sea wall|harbor ?walk|bay ?walk|beach ?walk|lake ?walk|board walk|waterfront|rail ?trail|towpath|canal|botanical|arboretum|nature|park trail|trail)\b/;

/**
 * Sidewalks, road sidepaths and on-street lanes. Explicit words ("sidepath", "cycle track") always count.
 * A plain street name counts unless it is a named walk, a nickname ("The Boulevard", "Bill's Boulevard"),
 * or comes from a wildland agency; numbered and lettered streets ("5th St.", "B St.") always count.
 */
export function isSidewalkName(name: string, miles: number | null = null, manager: string | null = null) {
  const n = normalizeTrailName(name);
  if (SIDEWALK.test(n)) return true;
  if (WALK_DESTINATION.test(n)) return false;
  if (NUMBERED_STREET.test(n)) return true;
  if (STREET_NAME.test(n)) return !n.startsWith("the ") && !/'s\b|’s\b/i.test(name) && !WILDLAND_MANAGER.test(manager ?? "");
  return GENERIC_PATH.test(n) && (miles === null || miles < 0.5);
}

/** ATV, OHV, motorcycle and 4x4 routes: motorized routes, not hiking trails. */
const MOTORIZED = /\b(atvs?|utvs?|ohvs?|orvs?|ohrvs?|motorcycles?|motorbikes?|dirt ?bikes?|4x4|4wd|four wheel drive|jeep|off ?road|off ?highway|motorized|mc trail)\b/;
const NOT_MOTORIZED = /\b(no|non)\s?(ohv|atv|motorized)\b|\bnonmotorized\b/;
export function isMotorizedName(name: string) {
  const n = normalizeTrailName(name);
  return MOTORIZED.test(n) && !NOT_MOTORIZED.test(n);
}

const CLOSED = /\b(closed|abandoned|decommissioned|obliterated|retired|historic route|former)\b/;
export const isClosedName = (name: string) => CLOSED.test(normalizeTrailName(name));
export const isConnectorName = (name: string) => CONNECTOR.test(normalizeTrailName(name));
export const isNetworkStyleName = (name: string) => NETWORK_NAME.test(normalizeTrailName(name));

export interface QualityContext {
  /** Longer same-name trail nearby, if any (see findFragmentParents). */
  parentId?: string | null;
  /** Number of separate trails sharing this name in the same region. */
  sameNameInRegion?: number;
  /** Whole-trail length reported by the source (e.g. Ontario TRAIL_LENGTH_KM), in miles. */
  reportedMiles?: number | null;
  /** Source-reported miles for the individual sections, when the source gives them. */
  sectionReportedMiles?: number | null;
  /** Gaps are expected for through-hike corridors. */
  allowGaps?: boolean;
}

export interface QualityResult {
  status: QualityStatus;
  flags: QualityFlag[];
  routeType: RouteType | null;
  measure: GeometryMeasure;
  mappedMiles: number;
}

export function assessTrail(
  trail: Pick<CatalogTrail, "name" | "miles" | "region" | "kind"> & Partial<Pick<CatalogTrail, "manager">>,
  lines: Lines | null | undefined,
  context: QualityContext = {},
  rules: QualityRules = QUALITY_RULES,
): QualityResult {
  const flags: QualityFlag[] = [];
  const measure = measureLines(lines, rules.gapMeters);
  const mappedMiles = measure.meters / MILE_METERS;
  const miles = trail.miles;
  const isRoute = trail.kind === "route";
  if (!measure.valid) flags.push("invalid-geometry");

  const placeholder = isPlaceholderName(trail.name);
  const unnamed = /^unnamed trail$/i.test(trail.name.trim());
  if (unnamed) flags.push("unnamed");
  else if (placeholder) flags.push("placeholder-name");
  if (!placeholder && isConnectorName(trail.name)) flags.push("connector");
  if (!placeholder && (context.sameNameInRegion ?? 1) >= rules.networkNameMinPieces && isNetworkStyleName(trail.name)) flags.push("network-name");
  if (context.parentId) flags.push("fragment-of-longer-trail");
  if (isClosedName(trail.name)) flags.push("closed");
  if (isSidewalkName(trail.name, miles, trail.manager ?? null)) flags.push("sidewalk");
  if (isMotorizedName(trail.name)) flags.push("motorized");

  const length = miles ?? mappedMiles;
  const short = length < rules.shortTrailMiles;
  if (short && !isRoute) flags.push("short");
  if (length > rules.maxPlausibleMiles && !isRoute) flags.push("implausible-length");

  if (context.reportedMiles != null && context.reportedMiles > 0 && mappedMiles > 0 && mappedMiles < context.reportedMiles * rules.sourceShortfallRatio) {
    flags.push("incomplete-geometry");
  }
  if (context.sectionReportedMiles != null && context.sectionReportedMiles > 0 && mappedMiles > 0) {
    const ratio = context.sectionReportedMiles / mappedMiles;
    if (ratio < rules.distanceToleranceLow || ratio > rules.distanceToleranceHigh) flags.push("distance-mismatch");
  }
  if (measure.valid && !isRoute && !context.allowGaps && measure.components > 1) flags.push("disconnected");
  if (measure.maxStepMeters > rules.maxJumpMiles * MILE_METERS) flags.push("gps-jump");
  if (measure.straightOnly && mappedMiles >= rules.straightLineMinMiles) flags.push("straight-line");
  if (!trail.region && !isRoute) flags.push("missing-region");

  let status: QualityStatus = "ok";
  const stub = unnamed || placeholder || flags.includes("connector") || flags.includes("network-name");
  if (!measure.valid || flags.includes("fragment-of-longer-trail") || (short && stub)) status = "fragment";
  else if (flags.some((f) => f === "closed" || f === "incomplete-geometry" || f === "distance-mismatch" || f === "gps-jump" || f === "straight-line" || f === "implausible-length" || f === "disconnected")) status = "review";
  else if (short && !isRoute) status = "short";

  return { status, flags, routeType: measure.valid ? routeTypeOf(measure, rules) : null, measure, mappedMiles };
}

type XY = [number, number];
const toXY = (p: Point, lat0: number): XY => [p[0] * 111_320 * Math.cos(lat0 * RAD), p[1] * 110_540];
function segmentDistance(p: XY, a: XY, b: XY) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Smallest distance from any vertex of `a` to any segment of `b`, in meters (local projection). */
export function lineDistanceMeters(a: Lines, b: Lines) {
  const lat0 = a[0]?.[0]?.[1] ?? 0;
  // Projection is local; distances beyond a few km are approximate, which is enough for gap and fragment tests.
  const pa = a.map((line) => line.map((p) => toXY(p, lat0)));
  const pb = b.map((line) => line.map((p) => toXY(p, lat0)));
  let best = Infinity;
  for (const line of pa) {
    for (const p of line) {
      for (const other of pb) {
        if (other.length === 1) best = Math.min(best, Math.hypot(p[0] - other[0][0], p[1] - other[0][1]));
        for (let i = 1; i < other.length; i++) best = Math.min(best, segmentDistance(p, other[i - 1], other[i]));
      }
    }
  }
  return best;
}

export interface FragmentCandidate { id: string; key: string | null; miles: number; lines: Lines; bounds: [number, number, number, number] | null }

/**
 * For trails that share a merge key, points each one at the longest same-name trail that is at least
 * `fragmentParentRatio` times longer and within `fragmentSearchMeters`. That parent is evidence the
 * trail is a disconnected piece. The pieces are not joined: a gap in the source is not filled in.
 */
export function findFragmentParents(candidates: FragmentCandidate[], rules: QualityRules = QUALITY_RULES) {
  const parents = new Map<string, string>();
  const groups = new Map<string, FragmentCandidate[]>();
  for (const c of candidates) {
    if (!c.key || !c.bounds) continue;
    const group = groups.get(c.key);
    if (group) group.push(c); else groups.set(c.key, [c]);
  }
  const pad = rules.fragmentSearchMeters / 111_000;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => b.miles - a.miles || a.id.localeCompare(b.id));
    for (let i = 1; i < group.length; i++) {
      const piece = group[i];
      const [w, s, e, n] = piece.bounds!;
      const padLng = pad / Math.max(0.2, Math.cos(((s + n) / 2) * RAD));
      for (let j = 0; j < i; j++) {
        const parent = group[j];
        if (parent.miles < piece.miles * rules.fragmentParentRatio) break;
        const [pw, ps, pe, pn] = parent.bounds!;
        if (pw > e + padLng || pe < w - padLng || ps > n + pad || pn < s - pad) continue;
        if (lineDistanceMeters(piece.lines, parent.lines) <= rules.fragmentSearchMeters) { parents.set(piece.id, parent.id); break; }
      }
    }
  }
  return parents;
}

/** Distance labels that never hide a short trail behind "<0.1". */
export function formatDistance(miles: number | null) {
  if (miles === null || !Number.isFinite(miles)) return { primary: "Distance unknown", secondary: null as string | null };
  const meters = miles * MILE_METERS;
  const km = meters / 1000;
  if (miles < 0.1) return { primary: `${Math.round(meters / 5) * 5} m`, secondary: `${miles.toFixed(2)} mi` };
  return { primary: `${miles < 10 ? miles.toFixed(1) : Math.round(miles).toLocaleString("en-US")} mi`, secondary: km < 1 ? `${Math.round(meters / 10) * 10} m` : `${km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString("en-US")} km` };
}

/**
 * From the geometry alone: a line whose ends meet is a loop; a single line is walked out and back unless a
 * shuttle is arranged (so it is labeled both ways); several pieces form a network.
 */
export const ROUTE_TYPE_LABELS: Record<RouteType, string> = {
  loop: "Loop",
  "point-to-point": "Out and back / point to point",
  network: "Trail network",
};

export const QUALITY_STATUS_LABELS: Record<QualityStatus, string> = {
  ok: "Passed automated checks",
  short: "Short trail",
  review: "Needs review",
  fragment: "Partial or unnamed segment",
};
