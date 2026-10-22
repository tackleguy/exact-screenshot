/**
 * OpenStreetMap → catalog rows, shared by the U.S./Canada build (build.ts) and the worldwide build (world.ts):
 * reading extract-osm.py region files, the verification rules R1–R10, joining same-name ways, and turning route
 * relations and joined named ways into catalog rows.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import type { CatalogTrail, OsmRouteInfo } from "../../src/lib/trail-catalog/types";
import { isSidewalkName, measureLines, metersBetween, routeTypeOf, MILE_METERS } from "../../src/lib/trail-catalog/quality";
import { geometryCell } from "../../src/lib/trail-catalog/cells";
import { normalizeTrailName } from "../../src/lib/trail-catalog/through-hikes";
import { simplifyLine } from "../../src/lib/geo/simplify";
import { chainLines } from "../../src/lib/geo/line";

export type Pt = [number, number];
export type Lines = Pt[][];
export interface Tags { [k: string]: string }
export type Place = { country: string; region: string };
export type PlaceOf = (p: Pt) => Place | null;

export const JOIN_METERS = 25;
export const SIMPLIFY = 0.00003; // ~3 m
export const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------- verification rules
export const RULES = {
  R1_no_name: "Unnamed, or a generic/placeholder name (path, trail, unnamed, a bare number) without an official ID",
  R2_too_short: "Under 0.3 mi, unless an official-layer trail or a named loop inside a park",
  R3_sidewalk: "Sidewalk, crosswalk, driveway, parking aisle, golf-cart path, steps only, or a street-name sidepath",
  R4_indoor: "Indoor, building passage, airport or campus service path",
  R5_road: "A road mapped as a trail (motor vehicles allowed on a track with a road name)",
  R6_private_closed: "Private or no access, disused/abandoned/under construction, or closed/decommissioned in the official layer",
  R7_duplicate: "Duplicate of another record (same name within 2 km with overlapping line); the record with more sources is kept",
  R8_degenerate: "Degenerate geometry: fewer than 3 points, self-intersecting zig-zags, or a scribble (length far exceeds its extent)",
  R9_climbing: "Climbing approach or descent path not part of a named route relation",
  R10_outside: "Outside every country/region outline (open water), or outside its claimed state/province",
} as const;
export type Rule = keyof typeof RULES;
export type Reject = (rule: Rule, source: string) => void;

const GENERIC = /^(path|paths|trail|trails|track|footpath|foot path|footway|walkway|walk way|walking path|walking trail|unnamed|unnamed trail|unnamed path|no name|noname|none|unknown|bike path|bikeway|bike trail|cycleway|cycle path|sidewalk|connector|connector trail|spur|spur trail|access|access trail|access path|fire road|service road|road|loop|loop trail|nature trail|hiking trail|multi use path|multi use trail|shared use path|greenway|bridle path|bridleway|horse trail|mtb trail|singletrack|\d+[a-z]?|[a-z]|[a-z]\d+|trail \d+|path \d+|t\d+)$/;
const CLIMB = /\b(climbers?|climbing)\s+(trail|path|access|approach)\b|\b(approach|descent)\b/;
const ROAD_NAME = /\b(road|rd|street|st|avenue|ave|drive|dr|lane|ln|boulevard|blvd|highway|hwy|parkway|pkwy|court|ct|place|pl)\.?$/i;
const INDOOR_NAME = /\b(concourse|terminal|hallway|corridor|skyway|skybridge|skywalk|tunnel|mall|atrium|lobby|parking (lot|garage|deck)|campus walk|quad)\b/i;
export const OPEN = new Set(["yes", "designated", "permissive", "official"]);

/** Rule check for named OSM candidates; returns the first rule that rejects it, or null. */
export function osmRule(name: string, tags: Tags[], miles: number, geometry: { points: number; crossings: number; extentM: number; meters: number }): Rule | null {
  const n = normalizeTrailName(name);
  if (!n || GENERIC.test(n)) return "R1_no_name";
  const all = (k: string) => tags.map((t) => t[k]).filter(Boolean);
  const share = (pred: (t: Tags) => boolean) => tags.filter(pred).length / tags.length;
  if (share((t) => ["sidewalk", "crossing", "traffic_island", "access_aisle"].includes(t.footway ?? "") || ["driveway", "parking_aisle", "drive-through", "alley"].includes(t.service ?? "") || ["cartpath", "path"].includes(t.golf ?? "") ) >= 0.5) return "R3_sidewalk";
  if (isSidewalkName(name, miles, tags[0].operator ?? null)) return "R3_sidewalk";
  if (share((t) => t.indoor === "yes" || t.indoor === "corridor" || t.location === "indoor" || t.tunnel === "building_passage" || t.level !== undefined && t.level !== "0") >= 0.5 || INDOOR_NAME.test(name)) return "R4_indoor";
  if (share((t) => t.highway === "track" && OPEN.has(t.motor_vehicle ?? t.motorcar ?? "") && !OPEN.has(t.foot ?? "") && !OPEN.has(t.bicycle ?? "")) >= 0.5) return "R5_road";
  if (share((t) => t.highway === "track") >= 0.5 && ROAD_NAME.test(name) && !all("foot").some((v) => v === "designated")) return "R5_road";
  const closed = (t: Tags) => {
    const access = t.access ?? "";
    const someoneAllowed = OPEN.has(t.foot ?? "") || OPEN.has(t.bicycle ?? "") || OPEN.has(t.horse ?? "") || t["piste:type"] !== undefined;
    return (["private", "no", "customers", "military"].includes(access) && !someoneAllowed) || (t.foot === "no" && t.bicycle === "no" && !OPEN.has(t.horse ?? "") && t["piste:type"] === undefined) || ["yes"].includes(t.disused ?? "") || ["yes"].includes(t.abandoned ?? "") || t.construction !== undefined || t["highway:disused"] !== undefined;
  };
  if (share(closed) >= 0.5) return "R6_private_closed";
  if (geometry.points < 3 || geometry.extentM < 20 || (geometry.crossings >= 3 && geometry.crossings / Math.max(0.1, geometry.meters / 1000) > 4) || (geometry.meters < 1500 && geometry.meters / Math.max(1, geometry.extentM) > 8)) return "R8_degenerate";
  if (CLIMB.test(n) || tags.some((t) => t.climbing !== undefined)) return "R9_climbing";
  return null;
}

/** Self-crossings within each line (zig-zag drawing errors) — O(n²) on short simplified lines. */
export function selfCrossings(lines: Lines) {
  let crossings = 0;
  for (const line of lines) {
    const n = Math.min(line.length, 400);
    for (let i = 1; i < n; i++) for (let j = i + 2; j < n; j++) {
      const [a, b, c, d] = [line[i - 1], line[i], line[j - 1], line[j]];
      const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
      if (o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0) crossings++;
    }
  }
  return crossings;
}

// ---------------------------------------------------------------- polygons
export function inside(p: Pt, ring: number[][]) {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [xj, yj] = ring[j];
    if ((y > p[1]) !== (yj > p[1]) && p[0] < ((xj - x) * (p[1] - y)) / (yj - y) + x) r = !r;
  }
  return r;
}
export function distanceToRing(p: Pt, ring: number[][]) {
  const k = Math.cos((p[1] * Math.PI) / 180);
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const ax = ring[i - 1][0] * k, ay = ring[i - 1][1], bx = ring[i][0] * k, by = ring[i][1], px = p[0] * k, py = p[1];
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

export type RegionShape = { name: string; country: string; rings: number[][][]; bounds: number[] };
/** Region containing the point; within ~10 km (0.1°) of a generalized coastline or border counts. */
export function placeIn(regions: RegionShape[], p: Pt): Place | null {
  for (const b of regions) {
    if (p[0] < b.bounds[0] || p[1] < b.bounds[1] || p[0] > b.bounds[2] || p[1] > b.bounds[3]) continue;
    if (inside(p, b.rings[0]) && !b.rings.slice(1).some((r) => inside(p, r))) return { country: b.country, region: b.name };
  }
  let best: RegionShape | null = null, bestD = 0.1;
  for (const b of regions) {
    if (p[0] < b.bounds[0] - bestD || p[0] > b.bounds[2] + bestD || p[1] < b.bounds[1] - bestD || p[1] > b.bounds[3] + bestD) continue;
    const d = distanceToRing(p, b.rings[0]);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best ? { country: best.country, region: best.name } : null;
}
export const boundsOf = (pts: number[][]) => pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
const minOf = (ids: number[]) => ids.reduce((a, b) => (b < a ? b : a));

// ---------------------------------------------------------------- names
const STOP = /\b(the|trail|trails|path|loop|route|tr|trl)\b/g;
export const nameKey = (s: string) => normalizeTrailName(s).replace(STOP, " ").replace(/\s+/g, " ").trim();
export function sameName(a: string, b: string) {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tx = new Set(x.split(" ")), ty = new Set(y.split(" "));
  return [...tx].filter((t) => ty.has(t)).length / Math.max(tx.size, ty.size) >= 0.75;
}

// ---------------------------------------------------------------- region files
export interface OsmRegion { relations: Record<string, { tags: Tags; members: [string, number, string][] }>; ways: Record<string, Pt[]>; trails: Record<string, Tags> }
/**
 * A region file from extract-osm.py: JSON lines each holding part of `relations`, `trails` or `ways` (or, in older
 * files, one object). Read as a stream, line by line, so the file is never held whole in memory; lines of parts
 * not asked for are skipped without parsing.
 */
export async function readOsmRegion(file: string, keys: (keyof OsmRegion)[] = ["relations", "ways", "trails"]): Promise<OsmRegion> {
  const out: OsmRegion = { relations: {}, ways: {}, trails: {} };
  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const key = line.slice(2, line.indexOf('"', 2)) as keyof OsmRegion;
    // An older single-object file is one "relations" line that holds every part (an unescaped "ways": key can't
    // occur inside a JSON string); it is parsed whole.
    const whole = key === "relations" && line.includes('"ways":{');
    if (!keys.includes(key) && !whole) continue;
    const part = JSON.parse(line) as Partial<OsmRegion>;
    for (const k of keys) if (part[k]) Object.assign(out[k], part[k]);
  }
  return out;
}

// ---------------------------------------------------------------- named OSM ways → candidates
export interface Candidate { id: string; name: string; tags: Tags[]; wayIds: number[]; lines: Lines }
const wayName = (t: Tags) => t.name ?? t.official_name ?? t["piste:name"] ?? t.ref ?? "";

/** Joins same-name ways whose ends touch (within 25 m) any vertex of each other, per region. */
export function joinNamedWays(trails: Record<string, Tags>, ways: Record<string, Pt[]>, used: Set<number>): Candidate[] {
  const groups = new Map<string, number[]>();
  for (const [id, tags] of Object.entries(trails)) {
    const wid = Number(id);
    if (used.has(wid) || !ways[id]) continue;
    // Pistes join only with pistes, so a ski run never merges with the summer path of the same name.
    const k = normalizeTrailName(wayName(tags)) + (tags["piste:type"] && !tags.highway ? "|piste" : "");
    if (!k || k === "|piste") continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(wid);
  }
  const out: Candidate[] = [];
  const cell = (p: Pt) => `${Math.floor((p[0] * 111_320 * Math.cos((p[1] * Math.PI) / 180)) / JOIN_METERS)}:${Math.floor((p[1] * 110_540) / JOIN_METERS)}`;
  for (const ids of groups.values()) {
    const parent = ids.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    if (ids.length > 1) {
      const grid = new Map<string, number[]>();
      ids.forEach((id, i) => { for (const p of ways[id]) { const c = cell(p); (grid.get(c) ?? grid.set(c, []).get(c)!).push(i); } });
      ids.forEach((id, i) => {
        const line = ways[id];
        for (const end of [line[0], line[line.length - 1]]) {
          const [cx, cy] = cell(end).split(":").map(Number);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            for (const j of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
              if (j === i) continue;
              if (ways[ids[j]].some((q) => metersBetween(end, q) <= JOIN_METERS)) parent[find(i)] = find(j);
            }
          }
        }
      });
    }
    const comps = new Map<number, number[]>();
    ids.forEach((id, i) => { const r = find(i); (comps.get(r) ?? comps.set(r, []).get(r)!).push(id); });
    for (const members of comps.values()) {
      for (const m of members) used.add(m);
      const tags = members.map((m) => trails[m]);
      out.push({ id: `osm-w${minOf(members)}`, name: wayName(tags[0]), tags, wayIds: members, lines: chainLines(members.map((m) => ways[m])) as Lines });
    }
  }
  return out;
}

export const majority = (values: (string | undefined)[]) => {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};
export const SAC_ORDER = ["hiking", "mountain_hiking", "demanding_mountain_hiking", "alpine_hiking", "demanding_alpine_hiking", "difficult_alpine_hiking"];

/** Allowed uses from OSM access tags (the same labels the official records use). */
export function osmUses(tags: Tags[]) {
  const any = (pred: (t: Tags) => boolean) => tags.some(pred);
  const uses: string[] = [];
  const piste = majority(tags.map((t) => t["piste:type"]));
  if (piste && tags.every((t) => !t.highway)) return pisteUses(piste);
  if (any((t) => t.highway !== "cycleway" && t.foot !== "no" && t.foot !== "private") || any((t) => OPEN.has(t.foot ?? ""))) uses.push("Hiking");
  if (any((t) => OPEN.has(t.bicycle ?? "") || t.highway === "cycleway" || t["mtb:scale"] !== undefined || t["mtb:scale:imba"] !== undefined)) uses.push("Bikes");
  if (any((t) => OPEN.has(t.horse ?? "") || t.highway === "bridleway")) uses.push("Horses");
  if (piste) uses.push(...pisteUses(piste));
  return [...new Set(uses)];
}

/** Uses of a piste:type (OpenStreetMap winter sports). */
export function pisteUses(piste: string): string[] {
  switch (piste) {
    case "nordic": return ["Cross-country skiing"];
    case "downhill": return ["Downhill skiing"];
    case "skitour": return ["Ski touring"];
    case "sled": case "sleigh": return ["Sledding"];
    case "hike": return ["Snowshoeing"];
    case "snow_park": return ["Snow park"];
    case "fatbike": return ["Fat biking"];
    default: return ["Winter route"];
  }
}

/** Winter use of a piste for the catalog: downhill runs and sled runs are winter-only; nordic tracks may be summer trails. */
export function winterUseOfPiste(piste: string | undefined, hasHighway: boolean): CatalogTrail["winterUse"] | undefined {
  if (!piste) return undefined;
  if (piste === "downhill" || piste === "snow_park" || piste === "sled" || piste === "sleigh") return hasHighway ? "nordic" : "downhill";
  return hasHighway ? "nordic" : "oversnow";
}

/** Uses implied by a route relation's route tag. */
export function routeUses(route: string, tags: Tags): string[] {
  switch (route) {
    case "hiking": case "foot": case "walking": return ["Hiking"];
    case "running": case "fitness_trail": return ["Hiking", "Running"];
    case "bicycle": return ["Bikes"];
    case "mtb": return ["Bikes", "Mountain biking"];
    case "horse": return ["Horses"];
    case "ski": return ["Cross-country skiing"];
    case "piste": return pisteUses(tags["piste:type"] ?? "");
    case "canoe": return ["Paddling"];
    case "inline_skates": return ["Inline skating"];
    default: return [];
  }
}

// ---------------------------------------------------------------- relations → rows
const SKIP_ROLES = /^(alternative|excursion|approach|connection|link|platform|stop|guidepost|start|end|information|parking|shelter)/;
const ROUTE_LABEL: Record<string, string> = { hiking: "Trail", foot: "Footpath", walking: "Walking Route", running: "Running Route", fitness_trail: "Fitness Trail", bicycle: "Bike Route", mtb: "MTB Route", horse: "Horse Trail", ski: "Ski Route", piste: "Piste", canoe: "Paddling Route", inline_skates: "Skating Route" };

export interface RelationInput {
  relTags: Map<number, Tags>;
  relMembers: Map<number, [string, number, string][]>;
  memberWays: Map<number, Pt[]>;
  placeOf: PlaceOf;
  reject: Reject;
  /** Relations to leave out entirely (e.g. ones another country's build already made). */
  skip?: (id: number) => boolean;
  /** Relations measured (their lines kept in relationLinesById) but not made into rows, e.g. through-hikes a
   * curated guide shows with the relation's line. */
  linesOnly?: (id: number, name: string, tags: Tags) => boolean;
  /** Only relations whose pin passes this test become rows here (the others belong to another country's build). */
  owns?: (place: Place) => boolean;
  /** Douglas–Peucker tolerance in degrees. */
  simplify?: number;
  retrievedAt: string;
}

export function relationRows(input: RelationInput): { rows: CatalogTrail[]; lines: Map<string, Lines>; relationLinesById: Map<number, Lines> } {
  const { relTags, relMembers, memberWays, placeOf, reject } = input;
  const resolved = new Map<number, Lines>();
  const relLinesOf = (id: number, stack = new Set<number>()): Lines => {
    if (resolved.has(id)) return resolved.get(id)!;
    if (stack.has(id)) return [];
    stack.add(id);
    const out: Lines = [];
    for (const [t, ref, role] of relMembers.get(id) ?? []) {
      if (SKIP_ROLES.test(role)) continue;
      if (t === "w" && memberWays.has(ref)) out.push(memberWays.get(ref)!);
      else if (t === "r") for (const l of relLinesOf(ref, stack)) out.push(l);
    }
    resolved.set(id, out);
    return out;
  };
  const rows: CatalogTrail[] = [];
  const lines = new Map<string, Lines>();
  const relationLinesById = new Map<number, Lines>();
  for (const [rid, t] of relTags) {
    if (input.skip?.(rid)) continue;
    const raw = relLinesOf(rid);
    if (!raw.length) continue;
    const name = (t.name ?? t["name:en"] ?? (t.ref ? `${ROUTE_LABEL[t.route] ?? "Route"} ${t.ref}` : "")).trim();
    const relLines = chainLines(raw).map((l) => simplifyLine(l, input.simplify ?? SIMPLIFY).map(([x, y]) => [round(x, 5), round(y, 5)] as Pt)).filter((l) => l.length > 1);
    relationLinesById.set(rid, relLines);
    if (!name) { reject("R1_no_name", "osm-relation"); continue; }
    if (input.linesOnly?.(rid, name, t)) continue;
    const measure = measureLines(relLines);
    const miles = measure.meters / MILE_METERS;
    if (!measure.valid || relLines.flat().length < 3) { reject("R8_degenerate", "osm-relation"); continue; }
    if (["private", "no"].includes(t.access ?? "") || t.state === "proposed" || t["disused:route"] !== undefined) { reject("R6_private_closed", "osm-relation"); continue; }
    const longest = relLines.reduce((a, b) => (b.length > a.length ? b : a));
    const pin = longest[0];
    const place = placeOf(pin) ?? placeOf(longest[Math.floor(longest.length / 2)]);
    if (!place) { reject("R10_outside", "osm-relation"); continue; }
    if (input.owns && !input.owns(place)) continue;
    if (miles < 0.1) { reject("R2_too_short", "osm-relation"); continue; }
    const distance = Number.parseFloat(t.distance ?? "");
    const reported = Number.isFinite(distance) ? (/mi/i.test(t.distance) ? distance : distance / 1.609344) : null;
    const info: OsmRouteInfo = { relation: rid, route: t.route, network: t.network, ref: t.ref, symbol: t["osmc:symbol"], description: t.description, distance: t.distance, sacScale: t.sac_scale, website: t.website, ...(t["piste:type"] ? { pisteType: t["piste:type"] } : {}) };
    const winterUse = t.route === "piste" ? winterUseOfPiste(t["piste:type"], false) : undefined;
    const uses = routeUses(t.route, t);
    const row: CatalogTrail = {
      id: `osm-r${rid}`, name, country: place.country, region: place.region, kind: "segment",
      miles: round(miles), distanceBasis: "geometry", latitude: pin[1], longitude: pin[0],
      difficulty: null, dogs: t.dog === "yes" ? true : t.dog === "no" ? false : null,
      source: "osm", sourceId: String(rid), sourceUrl: `https://www.openstreetmap.org/relation/${rid}`,
      officialUrl: /^https:\/\//.test(t.website ?? "") ? t.website : null, sourceDate: input.retrievedAt,
      manager: t.operator ?? null, surface: t.surface ?? null, season: null, geometryShard: geometryCell(pin[0], pin[1]),
      quality: "ok", flags: [], routeType: routeTypeOf(measure) ?? undefined, tier: "verified",
      sourceType: "OPENSTREETMAP", confidence: "VERIFIED", osm: info,
      ...(uses.length ? { uses } : {}), ...(winterUse ? { winterUse } : {}),
      altNames: [...new Set([t.alt_name, t.official_name, t.short_name, t.loc_name, t["name:en"]].flatMap((v) => (v ?? "").split(";")).map((v) => v.trim()).filter((v) => v && v !== name))],
      factSources: { name: "OpenStreetMap relation name", miles: "Measured along the OpenStreetMap relation's member ways", line: "OpenStreetMap relation (ODbL)" },
      ...(reported && miles > 0 && Math.abs(reported - miles) / miles > 0.1 ? { reportedMiles: round(reported) } : {}),
    };
    if (!row.altNames!.length) delete row.altNames;
    rows.push(row);
    lines.set(row.id, relLines);
  }
  return { rows, lines, relationLinesById };
}

// ---------------------------------------------------------------- named ways → rows
export interface NamedInput {
  candidates: Candidate[];
  placeOf: PlaceOf;
  reject: Reject;
  owns?: (place: Place) => boolean;
  simplify?: number;
  retrievedAt: string;
}

export function namedRows(input: NamedInput): { rows: CatalogTrail[]; lines: Map<string, Lines> } {
  const rows: CatalogTrail[] = [];
  const lines = new Map<string, Lines>();
  for (const c of input.candidates) {
    const ls = c.lines.map((l) => simplifyLine(l, input.simplify ?? SIMPLIFY).map(([x, y]) => [round(x, 5), round(y, 5)] as Pt)).filter((l) => l.length > 1);
    const measure = measureLines(ls);
    const miles = measure.meters / MILE_METERS;
    const [w, s, e, n] = measure.bounds ?? [0, 0, 0, 0];
    const extentM = metersBetween([w, s], [e, n]);
    // Points are counted before simplification: a long straight path simplifies to two points and is not degenerate.
    const rule = osmRule(c.name, c.tags, miles, { points: c.lines.reduce((n, l) => n + l.length, 0), crossings: measure.meters < 20_000 ? selfCrossings(ls) : 0, extentM, meters: measure.meters });
    if (rule) { input.reject(rule, "osm-way"); continue; }
    const longest = ls.reduce((a, b) => (b.length > a.length ? b : a), ls[0] ?? []);
    if (!longest?.length) { input.reject("R8_degenerate", "osm-way"); continue; }
    const pin = longest[0];
    const place = input.placeOf(pin);
    if (!place) { input.reject("R10_outside", "osm-way"); continue; }
    if (input.owns && !input.owns(place)) continue;
    const highway = majority(c.tags.map((t) => t.highway)) ?? (c.tags.some((t) => t["piste:type"]) ? "piste" : "path");
    const piste = majority(c.tags.map((t) => t["piste:type"]));
    const winterUse = winterUseOfPiste(piste, highway !== "piste");
    const sac = c.tags.map((t) => t.sac_scale).filter(Boolean).sort((a, b) => SAC_ORDER.indexOf(b!) - SAC_ORDER.indexOf(a!))[0];
    const mtb = majority(c.tags.map((t) => t["mtb:scale"] ?? t["mtb:scale:imba"]));
    const row: CatalogTrail = {
      id: c.id, name: c.name.trim(), country: place.country, region: place.region, kind: "segment",
      miles: round(miles), distanceBasis: "geometry", latitude: pin[1], longitude: pin[0], difficulty: null, dogs: null,
      source: "osm", sourceId: String(c.wayIds[0]), sourceUrl: `https://www.openstreetmap.org/way/${minOf(c.wayIds)}`,
      officialUrl: c.tags.find((t) => /^https:\/\//.test(t.website ?? ""))?.website ?? null, sourceDate: input.retrievedAt,
      manager: majority(c.tags.map((t) => t.operator)) ?? null, surface: majority(c.tags.map((t) => t.surface)) ?? null, season: null,
      geometryShard: geometryCell(pin[0], pin[1]), sectionCount: c.wayIds.length, quality: miles < 0.3 ? "short" : "ok", flags: [], routeType: routeTypeOf(measure) ?? undefined,
      tier: "mapped", sourceType: "OPENSTREETMAP", confidence: "VERIFIED", uses: osmUses(c.tags),
      ...(winterUse ? { winterUse } : {}),
      osmWay: { ids: c.wayIds.slice(0, 50), highway, ...(sac ? { sacScale: sac } : {}), ...(mtb ? { mtbScale: mtb } : {}), ...(piste ? { pisteType: piste } : {}) },
      altNames: [...new Set(c.tags.flatMap((t) => [t.alt_name, t.official_name]).filter((v): v is string => Boolean(v) && v !== c.name))],
      factSources: { name: "OpenStreetMap way name", miles: `Measured along ${c.wayIds.length} joined OpenStreetMap way${c.wayIds.length > 1 ? "s" : ""}`, line: "OpenStreetMap ways (ODbL)" },
    };
    if (!row.altNames!.length) delete row.altNames;
    rows.push(row);
    lines.set(row.id, ls);
  }
  return { rows, lines };
}
