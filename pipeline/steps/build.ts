/**
 * Catalog build: whole, verified trails from three sources, in priority order.
 *
 *   1. OpenStreetMap route relations (hiking, foot, bicycle, mtb, horse, ski)       → tier "verified"
 *   2. Official agency records (the official snapshot: USGS NTD, NPS, USFS, BLM,
 *      Parks Canada, Ontario)                                                       → tier "verified"
 *   3. Named OpenStreetMap ways (path, footway, track, bridleway, cycleway), joined
 *      with same-name ways that connect within 25 m                                 → tier "mapped"
 *
 * Every candidate passes the verification filter (rules R1–R10, see DECISIONS.md); each rejection is counted.
 * Sources are matched by name plus geometry (≥50% of a line within 100 m) and merged into one record whose
 * `sources` names every contributor. Output is a new snapshot under data/trail-catalog (the previous one is kept).
 *
 * Inputs: .cache/osm-pbf/<region>.json.gz (extract-osm.py), data/sources/wiki-trails.json.gz (wiki.ts),
 * data/trail-catalog/official-base.json → the official snapshot directory.
 */
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import type { CatalogManifest, CatalogTrail, OsmRouteInfo, WikiInfo } from "../../src/lib/trail-catalog/types";
import type { SourceRef } from "../../src/lib/trail-catalog/agencies";
import { sourceTypeFor } from "../../src/lib/trail-catalog/agencies";
import { LineIndex } from "../../src/lib/trail-catalog/additions";
import { MILE_METERS, isSidewalkName, measureLines, metersBetween, routeTypeOf } from "../../src/lib/trail-catalog/quality";
import { geometryCell } from "../../src/lib/trail-catalog/cells";
import { THROUGH_HIKE_PATTERNS, normalizeTrailName } from "../../src/lib/trail-catalog/through-hikes";
import { qualityScore, SCORE_DOC } from "../../src/lib/trail-catalog/score";
import { DIFFICULTY_FORMULA } from "../../src/lib/trail-difficulty";
import { DETAILED_THRU_HIKES } from "../../src/lib/trail-catalog/through-hikes-data";
import { PEAK_DEFINITIONS } from "../../src/lib/trail-catalog/peaks";
import { sliceRoute } from "../../src/lib/trail-catalog/curated-geometry";
import { simplifyLine } from "../../src/lib/geo/simplify";
import { chainLines } from "../../src/lib/geo/line";

type Pt = [number, number];
type Lines = Pt[][];
const root = process.cwd();
const catalogRoot = path.join(root, "data/trail-catalog");
const OSM_DIR = path.join(root, ".cache/osm-pbf");
const MATCH_METERS = 100;
const MATCH_SHARE = 0.5;
const JOIN_METERS = 25;
const MIN_MILES = 0.3;
const DUPLICATE_KM = 2;
const WIKI_KM = 20;
const SIMPLIFY = 0.00003; // ~3 m
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const aliasShard = (id: string) => (parseInt(sha(id).slice(0, 2), 16) % 64).toString().padStart(2, "0");
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const km = (a: Pt, b: Pt) => metersBetween(a, b) / 1000;

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
  R10_outside: "Outside the United States and Canada, in open water, or outside its claimed state/province",
} as const;
type Rule = keyof typeof RULES;
const rejected: Record<Rule, Record<string, number>> = Object.fromEntries(Object.keys(RULES).map((r) => [r, {}])) as Record<Rule, Record<string, number>>;
const reject = (rule: Rule, source: string) => { rejected[rule][source] = (rejected[rule][source] ?? 0) + 1; };

const GENERIC = /^(path|paths|trail|trails|track|footpath|foot path|footway|walkway|walk way|walking path|walking trail|unnamed|unnamed trail|unnamed path|no name|noname|none|unknown|bike path|bikeway|bike trail|cycleway|cycle path|sidewalk|connector|connector trail|spur|spur trail|access|access trail|access path|fire road|service road|road|loop|loop trail|nature trail|hiking trail|multi use path|multi use trail|shared use path|greenway|bridle path|bridleway|horse trail|mtb trail|singletrack|\d+[a-z]?|[a-z]|[a-z]\d+|trail \d+|path \d+|t\d+)$/;
const CLIMB = /\b(climbers?|climbing)\s+(trail|path|access|approach)\b|\b(approach|descent)\b/;
const ROAD_NAME = /\b(road|rd|street|st|avenue|ave|drive|dr|lane|ln|boulevard|blvd|highway|hwy|parkway|pkwy|court|ct|place|pl)\.?$/i;
const INDOOR_NAME = /\b(concourse|terminal|hallway|corridor|skyway|skybridge|skywalk|tunnel|mall|atrium|lobby|parking (lot|garage|deck)|campus walk|quad)\b/i;
const OPEN = new Set(["yes", "designated", "permissive", "official"]);

interface Tags { [k: string]: string }

/** Rule check for named OSM candidates; returns the first rule that rejects it, or null. */
function osmRule(name: string, tags: Tags[], miles: number, geometry: { points: number; crossings: number; extentM: number; meters: number }): Rule | null {
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
    const someoneAllowed = OPEN.has(t.foot ?? "") || OPEN.has(t.bicycle ?? "") || OPEN.has(t.horse ?? "");
    return (["private", "no", "customers", "military"].includes(access) && !someoneAllowed) || (t.foot === "no" && t.bicycle === "no" && !OPEN.has(t.horse ?? "")) || ["yes"].includes(t.disused ?? "") || ["yes"].includes(t.abandoned ?? "") || t.construction !== undefined || t["highway:disused"] !== undefined;
  };
  if (share(closed) >= 0.5) return "R6_private_closed";
  if (geometry.points < 3 || geometry.extentM < 20 || (geometry.crossings >= 3 && geometry.crossings / Math.max(0.1, geometry.meters / 1000) > 4) || (geometry.meters < 1500 && geometry.meters / Math.max(1, geometry.extentM) > 8)) return "R8_degenerate";
  if (CLIMB.test(n) || tags.some((t) => t.climbing !== undefined)) return "R9_climbing";
  return null;
}

/** Self-crossings within each line (zig-zag drawing errors) — O(n²) on short simplified lines. */
function selfCrossings(lines: Lines) {
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

// ---------------------------------------------------------------- regions and parks
type Region = { name: string; country: "US" | "CA"; rings: number[][][]; bounds: number[] };
const regions: Region[] = [];
function inside(p: Pt, ring: number[][]) {
  let r = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [xj, yj] = ring[j];
    if ((y > p[1]) !== (yj > p[1]) && p[0] < ((xj - x) * (p[1] - y)) / (yj - y) + x) r = !r;
  }
  return r;
}
function distanceToRing(p: Pt, ring: number[][]) {
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
/** State/province containing the point; within ~10 km of a generalized coastline or border counts. */
function placeOf(p: Pt): { country: "US" | "CA"; region: string } | null {
  for (const b of regions) {
    if (p[0] < b.bounds[0] || p[1] < b.bounds[1] || p[0] > b.bounds[2] || p[1] > b.bounds[3]) continue;
    if (inside(p, b.rings[0]) && !b.rings.slice(1).some((r) => inside(p, r))) return { country: b.country, region: b.name };
  }
  let best: Region | null = null, bestD = 0.1;
  for (const b of regions) {
    if (p[0] < b.bounds[0] - bestD || p[0] > b.bounds[2] + bestD || p[1] < b.bounds[1] - bestD || p[1] > b.bounds[3] + bestD) continue;
    const d = distanceToRing(p, b.rings[0]);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best ? { country: best.country, region: best.name } : null;
}

async function npsParks(): Promise<{ name: string; rings: number[][][]; bounds: number[] }[]> {
  const file = path.join(root, ".cache/nps-parks.json.gz");
  let features: { attributes: { UNIT_NAME: string }; geometry?: { rings: number[][][] } }[];
  try { features = JSON.parse(gunzipSync(await readFile(file)).toString()); } catch {
    features = [];
    const base = "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query";
    for (let offset = 0; ; offset += 25) {
      const q = new URLSearchParams({ where: "1=1", outFields: "UNIT_NAME", returnGeometry: "true", outSR: "4326", geometryPrecision: "5", maxAllowableOffset: "0.001", orderByFields: "OBJECTID", resultOffset: String(offset), resultRecordCount: "25", f: "json" });
      const r = await fetch(`${base}?${q}`, { headers: { "User-Agent": "Hyked/1.0 (https://github.com/tackleguy/health)" }, signal: AbortSignal.timeout(120_000) });
      const data = (await r.json()) as { features?: typeof features; exceededTransferLimit?: boolean };
      features.push(...(data.features ?? []));
      if (!(data.features ?? []).length || !data.exceededTransferLimit) break;
    }
    await writeFile(file, gzipSync(JSON.stringify(features)));
  }
  return features.filter((f) => f.geometry?.rings?.length).map((f) => {
    const pts = f.geometry!.rings.flat();
    return { name: f.attributes.UNIT_NAME, rings: f.geometry!.rings, bounds: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] };
  });
}

// ---------------------------------------------------------------- names
const STOP = /\b(the|trail|trails|path|loop|route|tr|trl)\b/g;
const nameKey = (s: string) => normalizeTrailName(s).replace(STOP, " ").replace(/\s+/g, " ").trim();
function sameName(a: string, b: string) {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tx = new Set(x.split(" ")), ty = new Set(y.split(" "));
  return [...tx].filter((t) => ty.has(t)).length / Math.max(tx.size, ty.size) >= 0.75;
}

// ---------------------------------------------------------------- named OSM ways → candidates
interface Candidate { id: string; name: string; tags: Tags[]; wayIds: number[]; lines: Lines }

/** Joins same-name ways whose ends touch (within 25 m) any vertex of each other, per region. */
function joinNamedWays(trails: Record<string, Tags>, ways: Record<string, Pt[]>, used: Set<number>): Candidate[] {
  const groups = new Map<string, number[]>();
  for (const [id, tags] of Object.entries(trails)) {
    const wid = Number(id);
    if (used.has(wid) || !ways[id]) continue;
    const name = tags.name ?? tags.official_name ?? tags.ref ?? "";
    const k = normalizeTrailName(name);
    if (!k) continue;
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
      out.push({ id: `osm-w${Math.min(...members)}`, name: tags[0].name ?? tags[0].official_name ?? tags[0].ref, tags, wayIds: members, lines: chainLines(members.map((m) => ways[m])) as Lines });
    }
  }
  return out;
}

const majority = (values: (string | undefined)[]) => {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};
const SAC_ORDER = ["hiking", "mountain_hiking", "demanding_mountain_hiking", "alpine_hiking", "demanding_alpine_hiking", "difficult_alpine_hiking"];

/** Allowed uses from OSM access tags (the same labels the official records use). */
function osmUses(tags: Tags[]) {
  const any = (pred: (t: Tags) => boolean) => tags.some(pred);
  const uses: string[] = [];
  if (any((t) => t.highway !== "cycleway" && t.foot !== "no" && t.foot !== "private") || any((t) => OPEN.has(t.foot ?? ""))) uses.push("Hiking");
  if (any((t) => OPEN.has(t.bicycle ?? "") || t.highway === "cycleway" || t["mtb:scale"] !== undefined || t["mtb:scale:imba"] !== undefined)) uses.push("Bikes");
  if (any((t) => OPEN.has(t.horse ?? "") || t.highway === "bridleway")) uses.push("Horses");
  return uses;
}

// ---------------------------------------------------------------- main
interface WikiTrail { qid: string; label: string; aliases: string[]; coord: Pt | null; osmRelation: number | null; wikipedia: { title: string; url: string; extract: string } | null; image: WikiInfo["image"] | null }

async function main() {
  const started = Date.now();
  const log = (s: string) => console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${s}`);
  const base = JSON.parse(await readFile(path.join(catalogRoot, "official-base.json"), "utf8")) as { directory: string };
  const officialDir = path.join(catalogRoot, base.directory);
  const manifest = JSON.parse(await readFile(path.join(officialDir, "manifest.json"), "utf8")) as CatalogManifest;
  const official = (JSON.parse(gunzipSync(await readFile(path.join(officialDir, "index.json.gz"))).toString()) as CatalogTrail[])
    // A previous build's own records never feed the next build.
    .filter((r) => r.source !== "osm").map((r) => { const { mergedInto: _m, qualityScore: _q, wiki: _w, tier: _t, ...rest } = r; return rest as CatalogTrail; });
  const geo = JSON.parse(await readFile(path.join(catalogRoot, "regions.geojson"), "utf8")) as { features: { properties: { name: string; admin: string }; geometry: { type: string; coordinates: number[][][] | number[][][][] } }[] };
  for (const f of geo.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates as number[][][]] : (f.geometry.coordinates as number[][][][]);
    for (const rings of polys) {
      const pts = rings[0];
      regions.push({ name: f.properties.name, country: f.properties.admin === "Canada" ? "CA" : "US", rings, bounds: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] });
    }
  }
  const cells = new Map<string, Record<string, Lines>>();
  for (const file of await readdir(officialDir)) {
    const m = file.match(/^geometry-(.+)\.json\.gz$/);
    if (m) cells.set(m[1], JSON.parse(gunzipSync(await readFile(path.join(officialDir, file))).toString()));
  }
  const officialLines = (r: CatalogTrail) => cells.get(r.geometryShard)?.[r.id];
  log(`Official snapshot ${base.directory}: ${official.length.toLocaleString("en-US")} records.`);

  // ---- read OSM regions: relations (+ member ways) and named trail ways ----
  const relTags = new Map<number, Tags>();
  const relMembers = new Map<number, [string, number, string][]>();
  const memberWays = new Map<number, Pt[]>();
  const candidates: Candidate[] = [];
  const usedWays = new Set<number>();
  const regionFiles = (await readdir(OSM_DIR)).filter((f) => f.endsWith(".json.gz")).sort();
  for (const file of regionFiles) {
    const data = JSON.parse(gunzipSync(await readFile(path.join(OSM_DIR, file))).toString()) as { relations: Record<string, { tags: Tags; members: [string, number, string][] }>; ways: Record<string, Pt[]>; trails: Record<string, Tags> };
    for (const [id, r] of Object.entries(data.relations)) if (!relTags.has(Number(id))) { relTags.set(Number(id), r.tags); relMembers.set(Number(id), r.members); }
    const needed = new Set<number>();
    for (const r of Object.values(data.relations)) for (const [t, ref] of r.members) if (t === "w") needed.add(ref);
    for (const id of needed) if (!memberWays.has(id) && data.ways[id]) memberWays.set(id, data.ways[id]);
    candidates.push(...joinNamedWays(data.trails ?? {}, data.ways, usedWays));
  }
  log(`OSM: ${relTags.size.toLocaleString("en-US")} route relations, ${usedWays.size.toLocaleString("en-US")} named trail ways joined into ${candidates.length.toLocaleString("en-US")} candidates, from ${regionFiles.length} regions.`);

  // ---- assemble relations ----
  const SKIP_ROLES = /^(alternative|excursion|approach|connection|link|platform|stop|guidepost|start|end|information|parking|shelter)/;
  const resolved = new Map<number, Lines>();
  const relLinesOf = (id: number, stack = new Set<number>()): Lines => {
    if (resolved.has(id)) return resolved.get(id)!;
    if (stack.has(id)) return [];
    stack.add(id);
    const out: Lines = [];
    for (const [t, ref, role] of relMembers.get(id) ?? []) {
      if (SKIP_ROLES.test(role)) continue;
      if (t === "w" && memberWays.has(ref)) out.push(memberWays.get(ref)!);
      else if (t === "r") out.push(...relLinesOf(ref, stack));
    }
    resolved.set(id, out);
    return out;
  };
  const throughNames = THROUGH_HIKE_PATTERNS.map((p) => nameKey(p.name));
  const routeLabel: Record<string, string> = { hiking: "Trail", foot: "Footpath", bicycle: "Bike Route", mtb: "MTB Route", horse: "Horse Trail", ski: "Ski Route" };
  const relRows: CatalogTrail[] = [];
  const allLines = new Map<string, Lines>();
  const relationLinesById = new Map<number, Lines>();
  const retrievedAt = new Date().toISOString();
  for (const [rid, t] of relTags) {
    const raw = relLinesOf(rid);
    if (!raw.length) continue;
    const lines = chainLines(raw).map((l) => simplifyLine(l, SIMPLIFY).map(([x, y]) => [round(x, 5), round(y, 5)] as Pt)).filter((l) => l.length > 1);
    relationLinesById.set(rid, lines);
    const name = (t.name ?? t["name:en"] ?? (t.ref ? `${routeLabel[t.route] ?? "Route"} ${t.ref}` : "")).trim();
    if (!name) { reject("R1_no_name", "osm-relation"); continue; }
    if ((t.route === "hiking" || t.route === "foot") && throughNames.includes(nameKey(name))) continue; // shown by the curated guide
    const measure = measureLines(lines);
    const miles = measure.meters / MILE_METERS;
    if (!measure.valid || lines.flat().length < 3) { reject("R8_degenerate", "osm-relation"); continue; }
    if (["private", "no"].includes(t.access ?? "") || t.state === "proposed" || t["disused:route"] !== undefined) { reject("R6_private_closed", "osm-relation"); continue; }
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a));
    const pin = longest[0];
    const place = placeOf(pin) ?? placeOf(longest[Math.floor(longest.length / 2)]);
    if (!place) { reject("R10_outside", "osm-relation"); continue; }
    if (miles < 0.1) { reject("R2_too_short", "osm-relation"); continue; }
    const distance = Number.parseFloat(t.distance ?? "");
    const reported = Number.isFinite(distance) ? (/mi/i.test(t.distance) ? distance : distance / 1.609344) : null;
    const info: OsmRouteInfo = { relation: rid, route: t.route, network: t.network, ref: t.ref, symbol: t["osmc:symbol"], description: t.description, distance: t.distance, sacScale: t.sac_scale, website: t.website };
    const row: CatalogTrail = {
      id: `osm-r${rid}`, name, country: place.country, region: place.region, kind: "segment",
      miles: round(miles), distanceBasis: "geometry", latitude: pin[1], longitude: pin[0],
      difficulty: null, dogs: t.dog === "yes" ? true : t.dog === "no" ? false : null,
      source: "osm", sourceId: String(rid), sourceUrl: `https://www.openstreetmap.org/relation/${rid}`,
      officialUrl: /^https:\/\//.test(t.website ?? "") ? t.website : null, sourceDate: retrievedAt,
      manager: t.operator ?? null, surface: t.surface ?? null, season: null, geometryShard: geometryCell(pin[0], pin[1]),
      quality: "ok", flags: [], routeType: routeTypeOf(measure) ?? undefined, tier: "verified",
      sourceType: "OPENSTREETMAP", confidence: "VERIFIED", osm: info,
      altNames: [...new Set([t.alt_name, t.official_name, t.short_name, t.loc_name, t["name:en"]].flatMap((v) => (v ?? "").split(";")).map((v) => v.trim()).filter((v) => v && v !== name))],
      factSources: { name: "OpenStreetMap relation name", miles: "Measured along the OpenStreetMap relation's member ways", line: "OpenStreetMap relation (ODbL)" },
      ...(reported && miles > 0 && Math.abs(reported - miles) / miles > 0.1 ? { reportedMiles: round(reported) } : {}),
    };
    if (!row.altNames!.length) delete row.altNames;
    relRows.push(row);
    allLines.set(row.id, lines);
  }
  log(`Relations: ${relRows.length.toLocaleString("en-US")} trails.`);

  // ---- named OSM candidates → filtered rows ----
  const namedRows: CatalogTrail[] = [];
  for (const c of candidates) {
    const lines = c.lines.map((l) => simplifyLine(l, SIMPLIFY).map(([x, y]) => [round(x, 5), round(y, 5)] as Pt)).filter((l) => l.length > 1);
    const measure = measureLines(lines);
    const miles = measure.meters / MILE_METERS;
    const [w, s, e, n] = measure.bounds ?? [0, 0, 0, 0];
    const extentM = metersBetween([w, s], [e, n]);
    const rule = osmRule(c.name, c.tags, miles, { points: lines.flat().length, crossings: measure.meters < 20_000 ? selfCrossings(lines) : 0, extentM, meters: measure.meters });
    if (rule) { reject(rule, "osm-way"); continue; }
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), lines[0] ?? []);
    if (!longest?.length) { reject("R8_degenerate", "osm-way"); continue; }
    const pin = longest[0];
    const place = placeOf(pin);
    if (!place) { reject("R10_outside", "osm-way"); continue; }
    const highway = majority(c.tags.map((t) => t.highway)) ?? "path";
    const sac = c.tags.map((t) => t.sac_scale).filter(Boolean).sort((a, b) => SAC_ORDER.indexOf(b!) - SAC_ORDER.indexOf(a!))[0];
    const routeType = routeTypeOf(measure) ?? undefined;
    const row: CatalogTrail = {
      id: c.id, name: c.name.trim(), country: place.country, region: place.region, kind: "segment",
      miles: round(miles), distanceBasis: "geometry", latitude: pin[1], longitude: pin[0], difficulty: null, dogs: null,
      source: "osm", sourceId: String(c.wayIds[0]), sourceUrl: `https://www.openstreetmap.org/way/${Math.min(...c.wayIds)}`,
      officialUrl: c.tags.find((t) => /^https:\/\//.test(t.website ?? ""))?.website ?? null, sourceDate: retrievedAt,
      manager: majority(c.tags.map((t) => t.operator)) ?? null, surface: majority(c.tags.map((t) => t.surface)) ?? null, season: null,
      geometryShard: geometryCell(pin[0], pin[1]), sectionCount: c.wayIds.length, quality: miles < 0.3 ? "short" : "ok", flags: [], routeType,
      tier: "mapped", sourceType: "OPENSTREETMAP", confidence: "VERIFIED", uses: osmUses(c.tags),
      osmWay: { ids: c.wayIds.slice(0, 50), highway, ...(sac ? { sacScale: sac } : {}), ...(majority(c.tags.map((t) => t["mtb:scale"] ?? t["mtb:scale:imba"])) ? { mtbScale: majority(c.tags.map((t) => t["mtb:scale"] ?? t["mtb:scale:imba"])) } : {}) },
      altNames: [...new Set(c.tags.flatMap((t) => [t.alt_name, t.official_name]).filter((v): v is string => Boolean(v) && v !== c.name))],
      factSources: { name: "OpenStreetMap way name", miles: `Measured along ${c.wayIds.length} joined OpenStreetMap way${c.wayIds.length > 1 ? "s" : ""}`, line: "OpenStreetMap ways (ODbL)" },
    };
    if (!row.altNames!.length) delete row.altNames;
    namedRows.push(row);
    allLines.set(row.id, lines);
  }
  candidates.length = 0;
  log(`Named ways: ${namedRows.length.toLocaleString("en-US")} passed the tag and geometry rules.`);

  // ---- official records: rules that apply to them ----
  const officialRows: CatalogTrail[] = [];
  for (const r of official) {
    const lines = officialLines(r);
    if (r.flags?.includes("closed") || r.trailStatus === "CLOSED") { reject("R6_private_closed", "official"); r.confidence = "REJECTED"; }
    else if (r.kind === "segment" && r.source !== "resort" && lines?.length && !placeOf([r.longitude, r.latitude])) { reject("R10_outside", "official"); r.confidence = "REJECTED"; }
    else if (r.quality === "fragment" && /^unnamed/i.test(r.name)) { reject("R1_no_name", "official"); }
    if (r.confidence !== "REJECTED" && r.quality !== "fragment") r.tier = "verified";
    officialRows.push(r);
    if (lines) allLines.set(r.id, lines);
  }

  // ---- matching: official ↔ relations (same name ≥50% within 100 m → one trail) ----
  const relIndex = new LineIndex(MATCH_METERS);
  const relCoarse = new Set<string>();
  const coarseKey = (x: number, y: number) => `${Math.floor(x * 4)}:${Math.floor(y * 4)}`;
  for (const r of relRows) { const l = allLines.get(r.id)!; relIndex.add(l, r.id); for (const line of l) for (const [x, y] of line) relCoarse.add(coarseKey(x, y)); }
  const relById = new Map(relRows.map((r) => [r.id, r]));
  const redirects = new Map<string, string>();
  let officialMatched = 0, mergedOfficial = 0;
  const officialToRel = new Map<string, { rid: string; share: number }[]>();
  for (const r of officialRows) {
    if (r.tier !== "verified" || r.kind !== "segment") continue;
    const lines = allLines.get(r.id);
    if (!lines?.length || !lines.some((l) => l.some(([x, y]) => relCoarse.has(coarseKey(x, y))))) continue;
    let hit = false;
    for (const [rid, share] of relIndex.ownerShares(lines)) if (share >= MATCH_SHARE) { hit = true; (officialToRel.get(rid) ?? officialToRel.set(rid, []).get(rid)!).push({ rid: r.id, share }); }
    if (hit) officialMatched++;
  }
  const officialById = new Map(officialRows.map((r) => [r.id, r]));
  const refOf = (row: CatalogTrail): SourceRef => ({ type: row.sourceType ?? sourceTypeFor(row), id: row.sourceId, url: row.sourceUrl, name: row.name, ...(row.officialTrailId ? { officialTrailId: row.officialTrailId } : {}) });
  for (const rel of relRows) {
    const same = (officialToRel.get(rel.id) ?? []).map((m) => officialById.get(m.rid)!).filter((o) => !o.mergedInto && [rel.name, ...(rel.altNames ?? [])].some((n) => sameName(n, o.name)));
    if (!same.length) continue;
    const primary = same.reduce((a, b) => ((b.miles ?? 0) > (a.miles ?? 0) ? b : a));
    if ((primary.miles ?? 0) > (rel.miles ?? 0) * 1.25) {
      primary.osm = rel.osm;
      primary.altNames = [...new Set([...(primary.altNames ?? []), rel.name, ...(rel.altNames ?? [])].filter((x) => x !== primary.name))];
      primary.sources = [...(primary.sources ?? []), { type: "OPENSTREETMAP", id: rel.sourceId, url: rel.sourceUrl, name: rel.name }];
      redirects.set(rel.id, primary.id);
      relById.delete(rel.id);
      continue;
    }
    if (primary.name !== rel.name) rel.altNames = [...new Set([...(rel.altNames ?? []), rel.name])];
    rel.name = primary.name;
    rel.factSources!.name = `Official name (${primary.manager ?? sourceTypeFor(primary)})`;
    if (same.length === 1 && primary.miles && rel.miles && primary.miles / rel.miles >= 0.8 && primary.miles / rel.miles <= 1.25) {
      rel.reportedMiles = rel.miles; rel.miles = primary.miles; rel.distanceBasis = primary.distanceBasis;
      rel.factSources!.miles = `Official length (${primary.manager ?? sourceTypeFor(primary)})`;
    }
    for (const key of ["manager", "park", "forest", "blmArea", "officialTrailId", "uses", "trailhead", "season", "difficulty", "trailStatus", "trailType"] as const) {
      if ((rel as unknown as Record<string, unknown>)[key] == null && primary[key] != null) (rel as unknown as Record<string, unknown>)[key] = primary[key];
    }
    if (!rel.officialUrl) rel.officialUrl = primary.officialUrl;
    if (rel.dogs === null) rel.dogs = primary.dogs;
    if (!rel.surface) rel.surface = primary.surface;
    rel.flags = [...new Set(same.flatMap((o) => o.flags ?? []).filter((f) => ["no-hiking", "motorized"].includes(f)))];
    rel.sources = same.flatMap((o) => [refOf(o), ...(o.sources ?? [])]).filter((s, i, a) => a.findIndex((x) => x.url === s.url) === i);
    rel.confidence = "OFFICIAL_GEOMETRY_VERIFIED";
    for (const o of same) { o.mergedInto = rel.id; redirects.set(o.id, rel.id); }
    mergedOfficial += same.length;
  }
  const relFinal = [...relById.values()];
  log(`Official ↔ relation: ${officialMatched.toLocaleString("en-US")} official trails lie ≥50% on a relation; ${mergedOfficial.toLocaleString("en-US")} same-name records merged.`);

  // ---- matching: named ways ↔ verified records; named ↔ named duplicates ----
  const verified = [...relFinal, ...officialRows.filter((r) => r.tier === "verified" && !r.mergedInto)];
  const vIndex = new LineIndex(MATCH_METERS);
  const vCoarse = new Set<string>();
  for (const r of verified) { const l = allLines.get(r.id); if (!l?.length) continue; vIndex.add(l, r.id); for (const line of l) for (const [x, y] of line) vCoarse.add(coarseKey(x, y)); }
  const verifiedById = new Map(verified.map((r) => [r.id, r]));
  let namedIntoVerified = 0;
  const namedKept: CatalogTrail[] = [];
  for (const r of namedRows) {
    const lines = allLines.get(r.id)!;
    let target: CatalogTrail | null = null;
    if (lines.some((l) => l.some(([x, y]) => vCoarse.has(coarseKey(x, y))))) {
      for (const [vid, share] of vIndex.ownerShares(lines)) {
        if (share < MATCH_SHARE) continue;
        const v = verifiedById.get(vid)!;
        if ([v.name, ...(v.altNames ?? [])].some((n) => sameName(n, r.name))) { target = v; break; }
      }
    }
    if (target) {
      // The same trail an official layer or relation already lists: record OSM as a contributor.
      target.sources = [...(target.sources ?? []), { type: "OPENSTREETMAP" as const, id: r.sourceId, url: r.sourceUrl, name: r.name }].filter((s, i, a) => a.findIndex((x) => x.url === s.url) === i);
      if (!target.osmWay && r.osmWay) target.osmWay = r.osmWay;
      if (!target.surface && r.surface) target.surface = r.surface;
      redirects.set(r.id, target.id);
      namedIntoVerified++;
      continue;
    }
    namedKept.push(r);
  }
  // Same name within 2 km with overlapping lines: keep the record with more sources (then the longer one).
  const byName = new Map<string, CatalogTrail[]>();
  for (const r of namedKept) { const k = nameKey(r.name); (byName.get(k) ?? byName.set(k, []).get(k)!).push(r); }
  const dropped = new Set<string>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (b.sources?.length ?? 0) - (a.sources?.length ?? 0) || (b.miles ?? 0) - (a.miles ?? 0));
    for (let i = 0; i < group.length; i++) {
      if (dropped.has(group[i].id)) continue;
      const keep = group[i];
      let idx: LineIndex | null = null;
      for (let j = i + 1; j < group.length; j++) {
        const other = group[j];
        if (dropped.has(other.id) || km([keep.longitude, keep.latitude], [other.longitude, other.latitude]) > DUPLICATE_KM + (keep.miles ?? 0) * 1.6) continue;
        idx ??= (() => { const x = new LineIndex(MATCH_METERS); x.add(allLines.get(keep.id)!, keep.id); return x; })();
        if (idx.coveredShare(allLines.get(other.id)!) >= MATCH_SHARE) { dropped.add(other.id); redirects.set(other.id, keep.id); reject("R7_duplicate", "osm-way"); }
      }
    }
  }
  const namedFinal = namedKept.filter((r) => !dropped.has(r.id));
  log(`Named ways: ${namedIntoVerified.toLocaleString("en-US")} were the same trail as a verified record (merged as a source); ${dropped.size.toLocaleString("en-US")} duplicates; ${namedFinal.length.toLocaleString("en-US")} kept as mapped.`);

  // ---- parks, short-trail rule, scoring ----
  const parks = await npsParks();
  const parkOf = (p: Pt) => parks.find((k) => p[0] >= k.bounds[0] && p[0] <= k.bounds[2] && p[1] >= k.bounds[1] && p[1] <= k.bounds[3] && k.rings.filter((ring) => inside(p, ring)).length % 2 === 1)?.name;
  const live = [...relFinal, ...officialRows.filter((r) => !r.mergedInto), ...namedFinal];
  for (const r of live) if (!r.park && r.country === "US" && r.tier) { const p = parkOf([r.longitude, r.latitude]); if (p) r.park = p; }
  const mappedFinal: CatalogTrail[] = [];
  for (const r of namedFinal) {
    // R2 applies to mapped trails only: official-layer trails keep their own length rules.
    if ((r.miles ?? 0) < MIN_MILES && !(r.routeType === "loop" && (r.park || r.forest))) { reject("R2_too_short", "osm-way"); redirects.delete(r.id); continue; }
    mappedFinal.push(r);
  }

  // ---- Wikidata / Wikipedia ----
  const wiki = JSON.parse(gunzipSync(await readFile(path.join(root, "data/sources/wiki-trails.json.gz"))).toString()) as { trails: WikiTrail[] };
  const shown = [...relFinal, ...officialRows.filter((r) => !r.mergedInto && r.tier), ...mappedFinal];
  const nameIndex = new Map<string, CatalogTrail[]>();
  for (const r of shown) for (const n of [r.name, ...(r.altNames ?? [])]) { const k = nameKey(n); if (k) (nameIndex.get(k) ?? nameIndex.set(k, []).get(k)!).push(r); }
  const byRelation = new Map<number, CatalogTrail>();
  for (const r of shown) if (r.osm) byRelation.set(r.osm.relation, r);
  const relWikidata = new Map<string, CatalogTrail>();
  for (const [rid, t] of relTags) if (/^Q\d+$/.test(t.wikidata ?? "") && byRelation.has(rid)) relWikidata.set(t.wikidata, byRelation.get(rid)!);
  let wikiMatched = 0;
  for (const w of wiki.trails) {
    let target = relWikidata.get(w.qid) ?? (w.osmRelation ? byRelation.get(w.osmRelation) : undefined);
    if (!target && w.coord) {
      const options = [w.label, ...w.aliases].flatMap((n) => nameIndex.get(nameKey(n)) ?? []).filter((r) => km([r.longitude, r.latitude], w.coord!) <= WIKI_KM);
      target = options.sort((a, b) => Number(b.tier === "verified") - Number(a.tier === "verified") || (b.miles ?? 0) - (a.miles ?? 0))[0];
    }
    if (!target || target.wiki) continue;
    target.wiki = { qid: w.qid, ...(w.wikipedia?.extract ? { title: w.wikipedia.title, url: w.wikipedia.url, extract: w.wikipedia.extract } : {}), ...(w.image?.url ? { image: w.image } : {}) };
    target.altNames = [...new Set([...(target.altNames ?? []), ...w.aliases, ...(w.label !== target.name ? [w.label] : [])])];
    wikiMatched++;
  }
  for (const r of [...shown]) r.qualityScore = qualityScore(r);
  log(`Wikidata: ${wikiMatched} items matched; ${parks.length} NPS units used for park placement.`);

  // ---- curated guides: real lines ----
  const guideKey = (n: string) => nameKey(n).replace(/\b(national|scenic|recreation|historic)\b/g, "").replace(/\s+/g, " ").trim();
  const relByKey = new Map<string, { id: number; lines: Lines; meters: number }>();
  for (const [rid, t] of relTags) {
    const name = t.name ?? t["name:en"];
    const lines = relationLinesById.get(rid);
    if (!name || !lines || !["hiking", "foot"].includes(t.route)) continue;
    const meters = measureLines(lines).meters;
    const k = guideKey(name);
    if ((relByKey.get(k)?.meters ?? 0) < meters) relByKey.set(k, { id: rid, lines, meters });
  }
  const simplify = (lines: Lines, tol: number) => lines.map((l) => simplifyLine(l, tol)).filter((l) => l.length > 1);
  const curated: { lines: Record<string, Lines>; links: Record<string, string> } = { lines: {}, links: {} };
  const guideReport: string[] = [];
  const shownById = new Map(shown.map((r) => [r.id, r]));
  for (const hike of DETAILED_THRU_HIKES) {
    const rel = relByKey.get(guideKey(hike.name)) ?? relByKey.get(guideKey(hike.shortName));
    if (!rel) { guideReport.push(`${hike.name}: no OSM relation found, so no line is drawn`); continue; }
    curated.lines[hike.id] = simplify(rel.lines, 0.0002);
    const linked = shownById.get(`osm-r${rel.id}`)?.id ?? (redirects.get(`osm-r${rel.id}`) && shownById.get(redirects.get(`osm-r${rel.id}`)!)?.id);
    if (linked) curated.links[hike.id] = linked;
    let cut = 0;
    for (const sec of hike.sections) {
      const lines = sliceRoute(rel.lines, [sec.startLng, sec.startLat], [sec.endLng, sec.endLat]);
      if (lines) { curated.lines[sec.id] = simplify(lines, 0.00005); cut++; if (linked) curated.links[sec.id] = linked; }
    }
    guideReport.push(`${hike.name}: relation ${rel.id} (${Math.round(rel.meters / MILE_METERS)} mi mapped of ${hike.officialMiles}); ${cut}/${hike.sections.length} sections cut from it`);
  }
  let peaksLinked = 0;
  for (const peak of PEAK_DEFINITIONS) {
    const near = shown.filter((r) => r.kind === "segment" && km([r.longitude, r.latitude], [peak.trailheadLng, peak.trailheadLat]) <= 15 && (sameName(r.name, peak.standardRoute) || nameKey(r.name).includes(nameKey(peak.name))));
    const best = near.sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))[0];
    const lines = best ? allLines.get(best.id) : undefined;
    if (!best || !lines?.length) continue;
    curated.lines[peak.id] = simplify(lines, 0.00005);
    curated.links[peak.id] = best.id;
    peaksLinked++;
  }
  guideReport.push(`Peaks: ${peaksLinked} of ${PEAK_DEFINITIONS.length} linked to a mapped route (the rest show summit and trailhead only)`);

  // ---- write the snapshot ----
  const name = `snapshot-${Date.now()}`;
  const dir = path.join(catalogRoot, name);
  await mkdir(dir, { recursive: true });
  const out = [...officialRows, ...relFinal, ...mappedFinal];
  const outCells = new Map<string, Record<string, Lines>>();
  for (const r of out) {
    if (r.source === "resort" || r.kind === "route") continue;
    const lines = allLines.get(r.id);
    if (!lines) continue;
    (outCells.get(r.geometryShard) ?? outCells.set(r.geometryShard, {}).get(r.geometryShard)!)[r.id] = lines;
  }
  for (const [cell, data] of outCells) await writeFile(path.join(dir, `geometry-${cell}.json.gz`), gzipSync(JSON.stringify(data)));
  const aliasShards = new Map<string, Record<string, string>>();
  for (let i = 0; i < 64; i++) {
    const k = String(i).padStart(2, "0");
    try { aliasShards.set(k, JSON.parse(gunzipSync(await readFile(path.join(officialDir, `aliases-${k}.json.gz`))).toString())); } catch { aliasShards.set(k, {}); }
  }
  for (const shard of aliasShards.values()) for (const [from, to] of Object.entries(shard)) if (redirects.has(to)) shard[from] = redirects.get(to)!;
  for (const [from, to] of redirects) aliasShards.get(aliasShard(from))![from] = to;
  for (const [k, shard] of aliasShards) await writeFile(path.join(dir, `aliases-${k}.json.gz`), gzipSync(JSON.stringify(shard)));
  try { await copyFile(path.join(officialDir, "audit.json.gz"), path.join(dir, "audit.json.gz")); } catch { /* optional */ }
  await writeFile(path.join(dir, "curated.json.gz"), gzipSync(JSON.stringify(curated)));
  const indexBuf = gzipSync(JSON.stringify(out), { level: 9 });
  await writeFile(path.join(dir, "index.json.gz"), indexBuf);

  const visible = out.filter((r) => r.tier && !r.mergedInto && r.confidence !== "REJECTED" && r.quality !== "fragment");
  const tiers = { verified: visible.filter((r) => r.tier === "verified").length, mapped: visible.filter((r) => r.tier === "mapped").length };
  const bySource: Record<string, number> = {};
  for (const r of visible) { const k = r.source === "osm" ? (r.osm ? "OpenStreetMap route relation" : "OpenStreetMap named ways") : r.sourceType ?? r.source; bySource[k] = (bySource[k] ?? 0) + 1; }
  const byRegion: Record<string, number> = {};
  for (const r of visible) { const k = `${r.region ?? "Unknown"}, ${r.country}`; byRegion[k] = (byRegion[k] ?? 0) + 1; }
  const countries: Record<string, number> = {};
  for (const r of out) if (!r.mergedInto) countries[r.country] = (countries[r.country] ?? 0) + 1;
  const report = { tiers, total: tiers.verified + tiers.mapped, bySource, byRegion, rejected, rules: RULES, guides: guideReport, matching: { officialMatched, mergedOfficial, namedIntoVerified, wikiMatched } };
  await writeFile(path.join(dir, "build-report.json"), JSON.stringify(report, null, 2) + "\n");
  const next: CatalogManifest & { tiers?: typeof tiers } = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    total: out.length,
    countries,
    tiers,
    indexSha256: sha(indexBuf),
    sources: [
      ...manifest.sources.filter((s) => !["osm", "osm-ways", "wikidata"].includes(s.key ?? "")),
      { key: "osm", name: "OpenStreetMap route relations (hiking, foot, bicycle, mtb, horse, ski)", url: "https://www.openstreetmap.org", license: "ODbL 1.0 — © OpenStreetMap contributors", count: relFinal.length, query: "route relations in Geofabrik extracts of every U.S. state and Canadian province/territory", retrievedAt },
      { key: "osm-ways", name: "Named OpenStreetMap ways (path, footway, track, bridleway, cycleway), joined by name within 25 m", url: "https://www.openstreetmap.org", license: "ODbL 1.0 — © OpenStreetMap contributors", count: mappedFinal.length, query: "highway=path|footway|track|bridleway|cycleway with a name, after verification rules R1–R10", retrievedAt },
      { key: "wikidata", name: "Wikidata trails, Wikipedia lead paragraphs and Wikimedia Commons images", url: "https://www.wikidata.org", license: "Wikidata CC0; Wikipedia text CC BY-SA 4.0; images per their Commons licence", count: wikiMatched, query: "instances of trail (Q628179) in the U.S. and Canada, plus items linked from OSM relations", retrievedAt },
    ],
    notes: [
      ...manifest.notes.filter((n) => !/^(Catalog v3|Difficulty|Quality score|Tiers)/.test(n)),
      `Tiers: ${tiers.verified.toLocaleString("en-US")} verified (official agency record or OpenStreetMap route relation) and ${tiers.mapped.toLocaleString("en-US")} mapped (named OpenStreetMap ways that passed every verification rule). Nothing below "mapped" is shown.`,
      `Catalog v3: sources are matched by name and geometry (≥50% of a line within ${MATCH_METERS} m) and merged into one record listing every contributor; old links redirect.`,
      `Difficulty: ${DIFFICULTY_FORMULA}`,
      `Quality score: ${SCORE_DOC}`,
    ],
  };
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(next, null, 2) + "\n");
  await writeFile(path.join(catalogRoot, "current.json"), JSON.stringify({ directory: name }) + "\n");
  log(`Wrote ${name}: ${tiers.verified.toLocaleString("en-US")} verified + ${tiers.mapped.toLocaleString("en-US")} mapped = ${(tiers.verified + tiers.mapped).toLocaleString("en-US")} trails.`);
  console.log(`Curated guides:\n  ${guideReport.join("\n  ")}`);
  console.log("Rejected by rule:");
  for (const [rule, bySrc] of Object.entries(rejected)) console.log(`  ${rule}: ${Object.values(bySrc).reduce((a, b) => a + b, 0).toLocaleString("en-US")} ${JSON.stringify(bySrc)}`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
