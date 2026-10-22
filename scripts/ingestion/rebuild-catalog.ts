/**
 * Catalog v3: whole trails from OpenStreetMap route relations merged with the official trail records, Wikidata /
 * Wikipedia matches and a quality score. Reads the current snapshot plus data/sources/osm-routes.json.gz and
 * data/sources/wiki-trails.json.gz and writes a NEW snapshot directory (the old one is kept), then points
 * current.json at it. Run: node --max-old-space-size=8192 node_modules/.bin/tsx scripts/ingestion/rebuild-catalog.ts
 *
 * Merge rules
 * - A relation becomes one trail: its member ways chained in order, length measured from that line.
 * - An official trail (USGS/NPS/USFS/BLM/Parks Canada/Ontario) with ≥50% of its line within MATCH_METERS of a
 *   relation is "matched". When the names agree, the two are one trail: it keeps the official name (and the
 *   official length when one official record covers the whole relation), uses whichever line is more complete,
 *   lists every contributor in sources[], and the absorbed record's links redirect to it.
 * - Relations whose name is a curated through-hike (AT, PCT, …) are left to the through-hike guides.
 */
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import type { CatalogManifest, CatalogTrail, OsmRouteInfo, WikiInfo } from "../../src/lib/trail-catalog/types";
import type { SourceRef } from "../../src/lib/trail-catalog/agencies";
import { sourceTypeFor } from "../../src/lib/trail-catalog/agencies";
import { LineIndex } from "../../src/lib/trail-catalog/additions";
import { MILE_METERS, measureLines, routeTypeOf, metersBetween } from "../../src/lib/trail-catalog/quality";
import { geometryCell } from "../../src/lib/trail-catalog/cells";
import { THROUGH_HIKE_PATTERNS } from "../../src/lib/trail-catalog/through-hikes";
import { normalizeTrailName } from "../../src/lib/trail-catalog/through-hikes";
import { qualityScore, SCORE_DOC } from "../../src/lib/trail-catalog/score";
import { DIFFICULTY_FORMULA } from "../../src/lib/trail-difficulty";
import { DETAILED_THRU_HIKES } from "../../src/lib/trail-catalog/through-hikes-data";
import { PEAK_DEFINITIONS } from "../../src/lib/trail-catalog/peaks";
import { sliceRoute } from "../../src/lib/trail-catalog/curated-geometry";
import { simplifyLine } from "../../src/lib/geo/simplify";

const MATCH_METERS = 100;
const MATCH_SHARE = 0.5;
const WIKI_KM = 20;
type Pt = [number, number];
type Lines = Pt[][];
const root = process.cwd();
const catalogRoot = path.join(root, "data/trail-catalog");
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const aliasShard = (id: string) => (parseInt(sha(id).slice(0, 2), 16) % 64).toString().padStart(2, "0");
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

// --- regions (Natural Earth admin-1, same file the builder uses) ---
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
function placeOf(p: Pt): { country: "US" | "CA"; region: string } | null {
  for (const b of regions) {
    if (p[0] < b.bounds[0] || p[1] < b.bounds[1] || p[0] > b.bounds[2] || p[1] > b.bounds[3]) continue;
    if (inside(p, b.rings[0]) && !b.rings.slice(1).some((r) => inside(p, r))) return { country: b.country, region: b.name };
  }
  return null;
}

// --- names ---
const STOP = /\b(the|trail|trails|path|loop|route|tr|trl)\b/g;
const nameKey = (s: string) => normalizeTrailName(s).replace(STOP, " ").replace(/\s+/g, " ").trim();
function sameName(a: string, b: string) {
  const x = nameKey(a), y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tx = new Set(x.split(" ")), ty = new Set(y.split(" "));
  const common = [...tx].filter((t) => ty.has(t)).length;
  return common / Math.max(tx.size, ty.size) >= 0.75;
}

/** National Park Service unit boundaries (public domain), generalized to ~100 m and cached. */
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
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, gzipSync(JSON.stringify(features)));
  }
  return features.filter((f) => f.geometry?.rings?.length).map((f) => {
    const pts = f.geometry!.rings.flat();
    return { name: f.attributes.UNIT_NAME, rings: f.geometry!.rings, bounds: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] };
  });
}

interface OsmRoute { id: number; tags: Record<string, string>; children: number[]; lines: Lines }
interface WikiTrail { qid: string; label: string; aliases: string[]; coord: Pt | null; osmRelation: number | null; wikipedia: { title: string; url: string; extract: string } | null; image: WikiInfo["image"] | null }

async function main() {
  const pointer = JSON.parse(await readFile(path.join(catalogRoot, "current.json"), "utf8"));
  const oldDir = path.join(catalogRoot, pointer.directory);
  const manifest = JSON.parse(await readFile(path.join(oldDir, "manifest.json"), "utf8")) as CatalogManifest;
  const rows = JSON.parse(gunzipSync(await readFile(path.join(oldDir, "index.json.gz"))).toString()) as CatalogTrail[];
  const beforePublic = rows.filter((r) => r.confidence !== "REJECTED" && r.quality !== "fragment").length;
  const geo = JSON.parse(await readFile(path.join(catalogRoot, "regions.geojson"), "utf8")) as { features: { properties: { name: string; admin: string }; geometry: { type: string; coordinates: number[][][] | number[][][][] } }[] };
  for (const f of geo.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates as number[][][]] : (f.geometry.coordinates as number[][][][]);
    for (const rings of polys) {
      const pts = rings[0];
      regions.push({ name: f.properties.name, country: f.properties.admin === "Canada" ? "CA" : "US", rings, bounds: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] });
    }
  }

  // Every geometry cell, in memory.
  const cells = new Map<string, Record<string, Lines>>();
  for (const file of await readdir(oldDir)) {
    const m = file.match(/^geometry-(.+)\.json\.gz$/);
    if (m) cells.set(m[1], JSON.parse(gunzipSync(await readFile(path.join(oldDir, file))).toString()));
  }
  const linesOf = (r: CatalogTrail) => cells.get(r.geometryShard)?.[r.id];
  const changedCells = new Set<string>();

  // ---------- Step 1: relations → trails ----------
  const osm = JSON.parse(gunzipSync(await readFile(path.join(root, "data/sources/osm-routes.json.gz"))).toString()) as { retrievedAt: string; routes: OsmRoute[] };
  const throughNames = THROUGH_HIKE_PATTERNS.map((p) => nameKey(p.name));
  const skipped: Record<string, number> = { noName: 0, outside: 0, tooShort: 0, throughHike: 0 };
  const relRows: CatalogTrail[] = [];
  const relLines = new Map<string, Lines>();
  const routeLabel: Record<string, string> = { hiking: "Trail", foot: "Footpath", bicycle: "Bike Route", mtb: "MTB Route", horse: "Horse Trail", ski: "Ski Route" };
  for (const r of osm.routes) {
    const t = r.tags;
    const route = t.route;
    const name = (t.name ?? t["name:en"] ?? (t.ref ? `${routeLabel[route] ?? "Route"} ${t.ref}` : "")).trim();
    if (!name) { skipped.noName++; continue; }
    if (route === "hiking" || route === "foot") if (throughNames.includes(nameKey(name))) { skipped.throughHike++; continue; }
    const measure = measureLines(r.lines);
    const miles = measure.meters / MILE_METERS;
    if (!measure.valid || miles < 0.1) { skipped.tooShort++; continue; }
    const longest = r.lines.reduce((a, b) => (b.length > a.length ? b : a));
    const pin = longest[0];
    const place = placeOf(pin) ?? placeOf(longest[Math.floor(longest.length / 2)]);
    if (!place) { skipped.outside++; continue; }
    const distanceKm = Number.parseFloat(t.distance ?? "");
    const reported = Number.isFinite(distanceKm) ? (/mi/i.test(t.distance) ? distanceKm : distanceKm / 1.609344) : null;
    const info: OsmRouteInfo = { relation: r.id, route, network: t.network, ref: t.ref, symbol: t["osmc:symbol"], description: t.description, distance: t.distance, sacScale: t.sac_scale, website: t.website };
    const id = `osm-r${r.id}`;
    const row: CatalogTrail = {
      id, name, country: place.country, region: place.region, kind: "segment",
      miles: round(miles), distanceBasis: "geometry", latitude: pin[1], longitude: pin[0],
      difficulty: null, dogs: t.dog === "yes" ? true : t.dog === "no" ? false : null,
      source: "osm", sourceId: String(r.id), sourceUrl: `https://www.openstreetmap.org/relation/${r.id}`,
      officialUrl: /^https:\/\//.test(t.website ?? "") ? t.website : null, sourceDate: osm.retrievedAt,
      manager: t.operator ?? null, surface: t.surface ?? null, season: null, geometryShard: geometryCell(pin[0], pin[1]),
      quality: miles < 0.25 ? "short" : "ok", flags: [], routeType: routeTypeOf(measure) ?? undefined,
      sourceType: "OPENSTREETMAP", confidence: "VERIFIED", osm: info,
      altNames: [...new Set([t.alt_name, t.official_name, t.short_name, t.loc_name, t["name:en"]].flatMap((v) => (v ?? "").split(";")).map((v) => v.trim()).filter((v) => v && v !== name))],
      factSources: { name: "OpenStreetMap relation name", miles: "Measured along the OpenStreetMap relation's member ways", line: "OpenStreetMap relation (ODbL)" },
      ...(reported && Math.abs(reported - miles) / miles > 0.1 ? { reportedMiles: round(reported) } : {}),
    };
    if (row.altNames!.length === 0) delete row.altNames;
    relRows.push(row);
    relLines.set(id, r.lines);
  }
  console.log(`Step 1: ${osm.routes.length.toLocaleString("en-US")} relations → ${relRows.length.toLocaleString("en-US")} trails (skipped ${JSON.stringify(skipped)}).`);

  // ---------- Step 2: match official records to relations ----------
  const index = new LineIndex(MATCH_METERS);
  const coarse = new Set<string>();
  for (const row of relRows) {
    const lines = relLines.get(row.id)!;
    index.add(lines, row.id);
    for (const line of lines) for (const [x, y] of line) coarse.add(`${Math.floor(x * 4)}:${Math.floor(y * 4)}`);
  }
  const matches = new Map<string, { row: CatalogTrail; share: number }[]>();
  let officialChecked = 0, officialMatched = 0;
  for (const row of rows) {
    if (row.kind !== "segment" || row.source === "resort") continue;
    const lines = linesOf(row);
    if (!lines?.length) continue;
    officialChecked++;
    if (!lines.some((l) => l.some(([x, y]) => coarse.has(`${Math.floor(x * 4)}:${Math.floor(y * 4)}`)))) continue;
    let hit = false;
    for (const [rid, share] of index.ownerShares(lines)) {
      if (share < MATCH_SHARE) continue;
      hit = true;
      (matches.get(rid) ?? matches.set(rid, []).get(rid)!).push({ row, share });
    }
    if (hit) officialMatched++;
  }

  const byId = new Map(rows.map((r) => [r.id, r]));
  const relById = new Map(relRows.map((r) => [r.id, r]));
  const redirects = new Map<string, string>();
  let merged = 0, officialKept = 0, relationsMatched = 0;
  const absorbed = new Set<string>();
  for (const rel of relRows) {
    const list = matches.get(rel.id) ?? [];
    if (list.length) relationsMatched++;
    const same = list.filter((m) => !absorbed.has(m.row.id) && !m.row.mergedInto && [rel.name, ...(rel.altNames ?? [])].some((n) => sameName(n, m.row.name)));
    if (!same.length) continue;
    const primary = same.reduce((a, b) => ((b.row.miles ?? 0) > (a.row.miles ?? 0) ? b : a)).row;
    const sources: SourceRef[] = [];
    for (const { row } of same) {
      sources.push({ type: row.sourceType ?? sourceTypeFor(row), id: row.sourceId, url: row.sourceUrl, name: row.name, ...(row.officialTrailId ? { officialTrailId: row.officialTrailId } : {}) });
      for (const s of row.sources ?? []) if (!sources.some((x) => x.url === s.url)) sources.push(s);
    }
    if ((primary.miles ?? 0) > (rel.miles ?? 0) * 1.25) {
      // The official line is more complete: keep it, and record the relation on it.
      primary.osm = rel.osm;
      primary.altNames = [...new Set([...(primary.altNames ?? []), rel.name, ...(rel.altNames ?? [])].filter((n) => n !== primary.name))];
      primary.sources = [...(primary.sources ?? []), { type: "OPENSTREETMAP", id: rel.sourceId, url: rel.sourceUrl, name: rel.name }];
      redirects.set(rel.id, primary.id);
      relById.delete(rel.id);
      absorbed.add(primary.id);
      officialKept++;
      continue;
    }
    // The relation is the whole trail; official records join it.
    if (primary.name !== rel.name) rel.altNames = [...new Set([...(rel.altNames ?? []), rel.name])];
    rel.name = primary.name;
    rel.factSources!.name = `Official name (${primary.manager ?? sourceTypeFor(primary)})`;
    if (same.length === 1 && primary.miles && rel.miles && primary.miles / rel.miles >= 0.8 && primary.miles / rel.miles <= 1.25) {
      rel.reportedMiles = rel.miles;
      rel.miles = primary.miles;
      rel.distanceBasis = primary.distanceBasis;
      rel.factSources!.miles = `Official length (${primary.manager ?? sourceTypeFor(primary)})`;
    }
    for (const key of ["manager", "park", "forest", "blmArea", "officialTrailId", "uses", "trailhead", "season", "difficulty", "officialUrl", "trailStatus", "trailType"] as const) {
      if ((rel as unknown as Record<string, unknown>)[key] == null && primary[key] != null) (rel as unknown as Record<string, unknown>)[key] = primary[key];
    }
    if (rel.dogs === null) rel.dogs = primary.dogs;
    if (!rel.surface) rel.surface = primary.surface;
    rel.flags = [...new Set(same.flatMap((m) => m.row.flags ?? []).filter((f) => ["no-hiking", "motorized"].includes(f)))];
    rel.sources = sources;
    rel.confidence = "OFFICIAL_GEOMETRY_VERIFIED";
    for (const { row } of same) {
      row.mergedInto = rel.id;
      absorbed.add(row.id);
      redirects.set(row.id, rel.id);
    }
    merged += same.length;
  }
  const relFinal = [...relById.values()];
  console.log(`Step 2: ${officialMatched.toLocaleString("en-US")} of ${officialChecked.toLocaleString("en-US")} official trails (${((officialMatched / officialChecked) * 100).toFixed(1)}%) lie ≥50% on a relation; ${relationsMatched.toLocaleString("en-US")} of ${relRows.length.toLocaleString("en-US")} relations (${((relationsMatched / relRows.length) * 100).toFixed(1)}%) overlap an official trail. ${merged.toLocaleString("en-US")} official records merged into ${relFinal.filter((r) => r.sources?.length).length.toLocaleString("en-US")} relation trails; ${officialKept} relations folded into a longer official record.`);

  // ---------- Step 3 (part): Wikidata / Wikipedia ----------
  const wiki = JSON.parse(gunzipSync(await readFile(path.join(root, "data/sources/wiki-trails.json.gz"))).toString()) as { trails: WikiTrail[] };
  const all = [...rows.filter((r) => !r.mergedInto), ...relFinal];
  const byName = new Map<string, CatalogTrail[]>();
  for (const r of all) for (const n of [r.name, ...(r.altNames ?? [])]) {
    const k = nameKey(n);
    if (k) (byName.get(k) ?? byName.set(k, []).get(k)!).push(r);
  }
  const byRelation = new Map<number, CatalogTrail>();
  for (const r of all) if (r.osm) byRelation.set(r.osm.relation, r);
  const relWikidata = new Map<string, CatalogTrail>();
  for (const r of osm.routes) if (/^Q\d+$/.test(r.tags.wikidata ?? "")) {
    const row = byRelation.get(r.id);
    if (row) relWikidata.set(r.tags.wikidata, row);
  }
  let wikiMatched = 0;
  const km = (a: Pt, b: Pt) => metersBetween(a, b) / 1000;
  for (const w of wiki.trails) {
    let target = relWikidata.get(w.qid) ?? (w.osmRelation ? byRelation.get(w.osmRelation) : undefined);
    if (!target && w.coord) {
      const candidates = [w.label, ...w.aliases].flatMap((n) => byName.get(nameKey(n)) ?? []).filter((r) => km([r.longitude, r.latitude], w.coord!) <= WIKI_KM);
      target = candidates.sort((a, b) => Number(Boolean(b.osm)) - Number(Boolean(a.osm)) || (b.miles ?? 0) - (a.miles ?? 0))[0];
    }
    if (!target || target.wiki) continue;
    target.wiki = {
      qid: w.qid,
      ...(w.wikipedia?.extract ? { title: w.wikipedia.title, url: w.wikipedia.url, extract: w.wikipedia.extract } : {}),
      ...(w.image?.url ? { image: w.image } : {}),
    };
    target.altNames = [...new Set([...(target.altNames ?? []), ...w.aliases, ...(w.label !== target.name ? [w.label] : [])])];
    wikiMatched++;
  }
  console.log(`Wikidata: ${wikiMatched} of ${wiki.trails.length} items matched to a trail (${all.filter((r) => r.wiki?.extract).length} with a Wikipedia lead, ${all.filter((r) => r.wiki?.image).length} with a licensed photo).`);

  // Park: trails whose pin lies inside a National Park Service unit get its name (search "Yosemite" finds them).
  const parks = await npsParks();
  let parked = 0;
  for (const r of [...rows, ...relFinal]) {
    if (r.park || r.mergedInto || r.country !== "US") continue;
    const p: Pt = [r.longitude, r.latitude];
    // ArcGIS rings: outer rings clockwise, holes counter-clockwise; an odd number of containing rings = inside.
    const hit = parks.find((k) => p[0] >= k.bounds[0] && p[0] <= k.bounds[2] && p[1] >= k.bounds[1] && p[1] <= k.bounds[3] && k.rings.filter((ring) => inside(p, ring)).length % 2 === 1);
    if (hit) { r.park = hit.name; parked++; }
  }
  console.log(`National Park Service units: ${parks.length}; ${parked.toLocaleString("en-US")} trails placed in a park.`);

  // Unnamed pieces under half a mile are fragments, not trails (they stay reachable by link).
  let unnamedDropped = 0;
  for (const r of rows) {
    if (r.mergedInto || r.quality === "fragment" || (r.miles ?? 0) >= 0.5) continue;
    if (!/^unnamed/i.test(r.name) && !r.originalName) continue;
    r.quality = "fragment";
    r.flags = [...new Set([...(r.flags ?? []), "unnamed" as const])];
    r.confidence = "REJECTED";
    unnamedDropped++;
  }
  console.log(`Unnamed pieces under 0.5 mi hidden: ${unnamedDropped.toLocaleString("en-US")}.`);

  // ---------- Step 4: quality score ----------
  for (const r of [...rows, ...relFinal]) r.qualityScore = qualityScore(r);

  // ---------- curated guides: real lines instead of drawn ones ----------
  // Through-hikes use their OSM relation (sections are cut from it between their listed endpoints); a peak uses
  // the catalog trail named for its standard route near its trailhead. No match → no line.
  const relationByKey = new Map<string, { id: number; lines: Lines; meters: number }>();
  for (const r of osm.routes) {
    const name = r.tags.name ?? r.tags["name:en"];
    if (!name || !["hiking", "foot"].includes(r.tags.route)) continue;
    const k = nameKey(name).replace(/\b(national|scenic|recreation|historic)\b/g, "").replace(/\s+/g, " ").trim();
    const meters = measureLines(r.lines).meters;
    if ((relationByKey.get(k)?.meters ?? 0) < meters) relationByKey.set(k, { id: r.id, lines: r.lines, meters });
  }
  const guideKey = (n: string) => nameKey(n).replace(/\b(national|scenic|recreation|historic)\b/g, "").replace(/\s+/g, " ").trim();
  const simplify = (lines: Lines, tol: number) => lines.map((l) => simplifyLine(l, tol)).filter((l) => l.length > 1);
  const curated: { lines: Record<string, Lines>; links: Record<string, string> } = { lines: {}, links: {} };
  const guideReport: string[] = [];
  const shownById = new Map([...rows.filter((r) => !r.mergedInto), ...relFinal].map((r) => [r.id, r]));
  for (const hike of DETAILED_THRU_HIKES) {
    const rel = relationByKey.get(guideKey(hike.name)) ?? relationByKey.get(guideKey(hike.shortName));
    if (!rel) { guideReport.push(`${hike.name}: no OSM relation found — no line drawn`); continue; }
    curated.lines[hike.id] = simplify(rel.lines, 0.0002);
    const row = shownById.get(`osm-r${rel.id}`) ?? [...shownById.values()].find((r) => r.osm?.relation === rel.id);
    if (row) curated.links[hike.id] = row.id;
    let cut = 0;
    for (const sec of hike.sections) {
      const lines = sliceRoute(rel.lines, [sec.startLng, sec.startLat], [sec.endLng, sec.endLat]);
      if (lines) { curated.lines[sec.id] = simplify(lines, 0.00005); cut++; if (row) curated.links[sec.id] = row.id; }
    }
    guideReport.push(`${hike.name}: relation ${rel.id} (${Math.round(rel.meters / MILE_METERS)} mi mapped of ${hike.officialMiles}); ${cut}/${hike.sections.length} sections cut from it`);
  }
  let peaksLinked = 0;
  for (const peak of PEAK_DEFINITIONS) {
    const near = [...shownById.values()].filter((r) => r.kind === "segment" && km([r.longitude, r.latitude], [peak.trailheadLng, peak.trailheadLat]) <= 15 && (sameName(r.name, peak.standardRoute) || nameKey(r.name).includes(nameKey(peak.name))));
    const best = near.sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))[0];
    const lines = best ? (relLines.get(best.id) ?? linesOf(best)) : undefined;
    if (!best || !lines?.length) continue;
    curated.lines[peak.id] = simplify(lines, 0.00005);
    curated.links[peak.id] = best.id;
    peaksLinked++;
  }
  guideReport.push(`Peaks: ${peaksLinked} of ${PEAK_DEFINITIONS.length} linked to a mapped route trail (the rest show summit and trailhead only)`);
  console.log(`\nCurated guides:\n  ${guideReport.join("\n  ")}`);

  // ---------- write the new snapshot ----------
  const newName = `snapshot-${Date.now()}`;
  const newDir = path.join(catalogRoot, newName);
  await mkdir(newDir, { recursive: true });
  for (const r of relFinal) {
    const cell = cells.get(r.geometryShard) ?? cells.set(r.geometryShard, {}).get(r.geometryShard)!;
    cell[r.id] = relLines.get(r.id)!;
    changedCells.add(r.geometryShard);
  }
  for (const [cell, data] of cells) {
    const file = `geometry-${cell}.json.gz`;
    if (changedCells.has(cell)) await writeFile(path.join(newDir, file), gzipSync(JSON.stringify(data)));
    else await copyFile(path.join(oldDir, file), path.join(newDir, file));
  }
  // Redirects: merged records and their old aliases point at the surviving trail.
  const aliasShards = new Map<string, Record<string, string>>();
  for (let i = 0; i < 64; i++) {
    const k = String(i).padStart(2, "0");
    try { aliasShards.set(k, JSON.parse(gunzipSync(await readFile(path.join(oldDir, `aliases-${k}.json.gz`))).toString())); } catch { aliasShards.set(k, {}); }
  }
  for (const shard of aliasShards.values()) for (const [from, to] of Object.entries(shard)) if (redirects.has(to)) shard[from] = redirects.get(to)!;
  for (const [from, to] of redirects) aliasShards.get(aliasShard(from))![from] = to;
  for (const [k, shard] of aliasShards) await writeFile(path.join(newDir, `aliases-${k}.json.gz`), gzipSync(JSON.stringify(shard)));
  try { await copyFile(path.join(oldDir, "audit.json.gz"), path.join(newDir, "audit.json.gz")); } catch { /* optional */ }
  await writeFile(path.join(newDir, "curated.json.gz"), gzipSync(JSON.stringify(curated)));

  const out = [...rows, ...relFinal];
  const indexBuf = gzipSync(JSON.stringify(out), { level: 9 });
  await writeFile(path.join(newDir, "index.json.gz"), indexBuf);
  const countries: Record<string, number> = {};
  for (const r of out) if (!r.mergedInto) countries[r.country] = (countries[r.country] ?? 0) + 1;
  const next: CatalogManifest = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    total: out.length,
    countries,
    indexSha256: sha(indexBuf),
    sources: [
      ...manifest.sources.filter((s) => s.key !== "osm" && s.key !== "wikidata"),
      { key: "osm", name: "OpenStreetMap route relations (hiking, foot, bicycle, mtb, horse, ski)", url: "https://www.openstreetmap.org", license: "ODbL 1.0 — © OpenStreetMap contributors", count: relFinal.length, query: "relation[type~route|superroute][route~hiking|foot|bicycle|mtb|horse|ski] in the U.S. and Canada (Overpass API)", retrievedAt: osm.retrievedAt },
      { key: "wikidata", name: "Wikidata trails, Wikipedia lead paragraphs and Wikimedia Commons images", url: "https://www.wikidata.org", license: "Wikidata CC0; Wikipedia text CC BY-SA 4.0; images per their Commons licence", count: wikiMatched, query: "instances of trail (Q628179) in the U.S. and Canada, plus items linked from OSM relations", retrievedAt: new Date().toISOString() },
    ],
    notes: [
      ...manifest.notes.filter((n) => !/^(Catalog v3|Difficulty|Quality score)/.test(n)),
      `Catalog v3: ${relFinal.length.toLocaleString("en-US")} trails are OpenStreetMap route relations, each one whole trail with its member ways in order. ${merged.toLocaleString("en-US")} official records with the same name and ≥50% of their line within ${MATCH_METERS} m of a relation were merged into it (official name kept, every contributor listed in sources; old links redirect).`,
      `Difficulty: ${DIFFICULTY_FORMULA}`,
      `Quality score: ${SCORE_DOC}`,
    ],
  };
  await writeFile(path.join(newDir, "manifest.json"), JSON.stringify(next, null, 2) + "\n");
  await writeFile(path.join(catalogRoot, "current.json"), JSON.stringify({ ...pointer, directory: newName }) + "\n");

  // ---------- report ----------
  const visible = out.filter((r) => !r.mergedInto && r.confidence !== "REJECTED" && r.quality !== "fragment");
  console.log(`\nTrails shown: before ${beforePublic.toLocaleString("en-US")}, after ${visible.length.toLocaleString("en-US")} (${relFinal.length.toLocaleString("en-US")} relation trails added, ${merged.toLocaleString("en-US")} official records merged into them).`);
  const yosemite = visible.filter((r) => r.longitude > -119.9 && r.longitude < -119.2 && r.latitude > 37.5 && r.latitude < 38.1).sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0)).slice(0, 20);
  console.log("\n20 best-scored trails around Yosemite Valley:");
  for (const r of yosemite) console.log(`  ${r.name.padEnd(40)} ${String(r.miles).padStart(7)} mi  score ${r.qualityScore}  ${r.source}${r.osm ? ` rel ${r.osm.relation}` : ""}${r.sources?.length ? ` +${r.sources.length} sources` : ""}${r.wiki ? " +wiki" : ""}`);
  console.log(`\nWrote ${newName} (old snapshot ${pointer.directory} kept).`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
