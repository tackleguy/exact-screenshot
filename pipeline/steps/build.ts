/**
 * Catalog build: whole, verified trails from three sources, in priority order.
 *
 *   1. OpenStreetMap route relations (hiking, foot, bicycle, mtb, horse, ski, …)    → tier "verified"
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
 * The OSM rules and row builders are shared with the worldwide build (osm-trails.ts, world.ts).
 */
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import type { CatalogManifest, CatalogTrail, WikiInfo } from "../../src/lib/trail-catalog/types";
import type { SourceRef } from "../../src/lib/trail-catalog/agencies";
import { sourceTypeFor } from "../../src/lib/trail-catalog/agencies";
import { LineIndex } from "../../src/lib/trail-catalog/additions";
import { MILE_METERS, measureLines, metersBetween } from "../../src/lib/trail-catalog/quality";
import { THROUGH_HIKE_PATTERNS } from "../../src/lib/trail-catalog/through-hikes";
import { qualityScore, SCORE_DOC } from "../../src/lib/trail-catalog/score";
import { DIFFICULTY_FORMULA } from "../../src/lib/trail-difficulty";
import { DETAILED_THRU_HIKES } from "../../src/lib/trail-catalog/through-hikes-data";
import { PEAK_DEFINITIONS } from "../../src/lib/trail-catalog/peaks";
import { sliceRoute } from "../../src/lib/trail-catalog/curated-geometry";
import { simplifyLine } from "../../src/lib/geo/simplify";
import {
  RULES, type Rule, type Pt, type Lines, type Tags, type Candidate, type RegionShape,
  inside, placeIn, boundsOf, nameKey, sameName, joinNamedWays, readOsmRegion, relationRows, namedRows,
} from "./osm-trails";

export { RULES };
const root = process.cwd();
const catalogRoot = path.join(root, "data/trail-catalog");
const OSM_DIR = path.join(root, ".cache/osm-pbf");
const MATCH_METERS = 100;
const MATCH_SHARE = 0.5;
const MIN_MILES = 0.3;
const DUPLICATE_KM = 2;
const WIKI_KM = 20;
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const aliasShard = (id: string) => (parseInt(sha(id).slice(0, 2), 16) % 64).toString().padStart(2, "0");
const km = (a: Pt, b: Pt) => metersBetween(a, b) / 1000;

const rejected: Record<Rule, Record<string, number>> = Object.fromEntries(Object.keys(RULES).map((r) => [r, {}])) as Record<Rule, Record<string, number>>;
const reject = (rule: Rule, source: string) => { rejected[rule][source] = (rejected[rule][source] ?? 0) + 1; };

// ---------------------------------------------------------------- regions and parks
const regions: RegionShape[] = [];
/** State/province containing the point; within ~10 km of a generalized coastline or border counts. */
const placeOf = (p: Pt) => placeIn(regions, p);

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
      regions.push({ name: f.properties.name, country: f.properties.admin === "Canada" ? "CA" : "US", rings, bounds: boundsOf(pts) });
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
    const data = await readOsmRegion(path.join(OSM_DIR, file));
    for (const [id, r] of Object.entries(data.relations)) if (!relTags.has(Number(id))) { relTags.set(Number(id), r.tags); relMembers.set(Number(id), r.members); }
    const needed = new Set<number>();
    for (const r of Object.values(data.relations)) for (const [t, ref] of r.members) if (t === "w") needed.add(ref);
    for (const id of needed) if (!memberWays.has(id) && data.ways[id]) memberWays.set(id, data.ways[id]);
    for (const c of joinNamedWays(data.trails ?? {}, data.ways, usedWays)) candidates.push(c);
  }
  log(`OSM: ${relTags.size.toLocaleString("en-US")} route relations, ${usedWays.size.toLocaleString("en-US")} named trail ways joined into ${candidates.length.toLocaleString("en-US")} candidates, from ${regionFiles.length} regions.`);

  // ---- assemble relations ----
  const throughNames = THROUGH_HIKE_PATTERNS.map((p) => nameKey(p.name));
  const retrievedAt = new Date().toISOString();
  const allLines = new Map<string, Lines>();
  const rel = relationRows({
    relTags, relMembers, memberWays, placeOf, reject, retrievedAt,
    // Through-hikes with a curated guide are shown by the guide.
    linesOnly: (_id, name, t) => (t.route === "hiking" || t.route === "foot") && throughNames.includes(nameKey(name)),
  });
  const relRows = rel.rows;
  const relationLinesById = rel.relationLinesById;
  for (const [id, l] of rel.lines) allLines.set(id, l);
  log(`Relations: ${relRows.length.toLocaleString("en-US")} trails.`);

  // ---- named OSM candidates → filtered rows ----
  const named = namedRows({ candidates, placeOf, reject, retrievedAt });
  const namedRows_ = named.rows;
  for (const [id, l] of named.lines) allLines.set(id, l);
  candidates.length = 0;
  log(`Named ways: ${namedRows_.length.toLocaleString("en-US")} passed the tag and geometry rules.`);

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
  for (const r of namedRows_) {
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

  if (process.argv.includes("--dry-run")) {
    log(`Dry run: ${relFinal.length.toLocaleString("en-US")} relation trails, ${mappedFinal.length.toLocaleString("en-US")} mapped trails; nothing written.`);
    for (const [rule, bySrc] of Object.entries(rejected)) console.log(`  ${rule}: ${JSON.stringify(bySrc)}`);
    const sample = [...relFinal, ...mappedFinal].sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0)).slice(0, 15);
    for (const r of sample) console.log(`  ${r.name} · ${r.miles} mi · ${r.tier} · score ${r.qualityScore} · ${r.region}${r.sources?.length ? ` · +${r.sources.length} sources` : ""}`);
    return;
  }

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
