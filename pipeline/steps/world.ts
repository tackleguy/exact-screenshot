/**
 * Worldwide trails: every country outside the U.S. and Canada (plus Alaska and Hawaii), added to the current
 * snapshot that build.ts wrote. Runs after build.ts.
 *
 * Input: .cache/world-pbf/<country>.json.gz (extract-world.py; one file per country, complete relations) and
 * data/sources/world-admin1.json.gz (Natural Earth states/provinces, places.py), and data/sources/wiki-world.json.gz
 * (wiki.ts --world: Wikidata items that worldwide relations link, with Wikipedia lead paragraphs and Commons photos).
 *
 * Each country file goes through the same steps as the U.S. and Canada (osm-trails.ts): route relations become
 * verified trails, named trail ways and pistes are joined by name and pass rules R1–R10 to become mapped trails, a
 * named way that is the same trail as a relation becomes one of its sources, and same-name duplicates are merged.
 * A trail that crosses a border is built once, by the country that holds its map pin.
 *
 * Output, in the current snapshot:
 *   world/index-<country>.json.gz     catalog rows per country file
 *   world/geometry-<cell>.json.gz     their lines in 1° cells (merged with the U.S./Canada cells when the app's
 *                                     files are prepared)
 *   world/report.json                 counts per country and rejections by rule
 * and the manifest's totals, country counts, tiers and sources include them.
 *
 * Usage: node --max-old-space-size=12288 node_modules/.bin/tsx pipeline/steps/world.ts
 */
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import type { CatalogManifest, CatalogTrail, WikiInfo } from "../../src/lib/trail-catalog/types";
import { LineIndex } from "../../src/lib/trail-catalog/additions";
import { metersBetween } from "../../src/lib/trail-catalog/quality";
import { qualityScore } from "../../src/lib/trail-catalog/score";
import {
  RULES, type Rule, type Pt, type Lines, type Tags, type RegionShape, type Place,
  inside, distanceToRing, boundsOf, nameKey, sameName, joinNamedWays, readOsmRegion, relationRows, namedRows,
} from "./osm-trails";

const root = process.cwd();
const catalogRoot = path.join(root, "data/trail-catalog");
const WORLD_DIR = path.join(root, ".cache/world-pbf");
const STAGE = path.join(root, ".cache/world-stage");
const MATCH_METERS = 100;
const MATCH_SHARE = 0.5;
const MIN_MILES = 0.3;
const DUPLICATE_KM = 2;
/** Line simplification for worldwide trails (~5 m; the U.S./Canada build keeps ~3 m). */
const SIMPLIFY_WORLD = 0.00005;
/** Countries built from the regional extracts (build.ts); their trails are never built here. */
const REGIONAL = new Set(["US", "CA"]);
/** Files for parts of the regional countries the regional mirror doesn't cover. */
const PART_OF: Record<string, { country: string; region: string }> = { "US-AK": { country: "US", region: "Alaska" }, "US-HI": { country: "US", region: "Hawaii" } };
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const km = (a: Pt, b: Pt) => metersBetween(a, b) / 1000;
const coarseKey = (x: number, y: number) => `${Math.floor(x * 4)}:${Math.floor(y * 4)}`;

const rejected: Record<Rule, Record<string, number>> = Object.fromEntries(Object.keys(RULES).map((r) => [r, {}])) as Record<Rule, Record<string, number>>;
const reject = (rule: Rule, source: string) => { rejected[rule][source] = (rejected[rule][source] ?? 0) + 1; };

/** States/provinces in a 1° grid, so a point is tested only against the few regions whose box covers it. */
class RegionGrid {
  private cells = new Map<number, RegionShape[]>();
  constructor(regions: RegionShape[]) {
    for (const r of regions) {
      for (let x = Math.floor(r.bounds[0]); x <= Math.floor(r.bounds[2]); x++) for (let y = Math.floor(r.bounds[1]); y <= Math.floor(r.bounds[3]); y++) {
        const k = (x + 180) * 1000 + (y + 90);
        (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(r);
      }
    }
  }
  private near(p: Pt) {
    const out = new Set<RegionShape>();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const r of this.cells.get((Math.floor(p[0]) + dx + 180) * 1000 + (Math.floor(p[1]) + dy + 90)) ?? []) out.add(r);
    return out;
  }
  /** Region containing the point; within ~10 km (0.1°) of a generalized coastline or border counts. */
  placeOf(p: Pt): Place | null {
    for (const b of this.cells.get((Math.floor(p[0]) + 180) * 1000 + (Math.floor(p[1]) + 90)) ?? []) {
      if (p[0] < b.bounds[0] || p[1] < b.bounds[1] || p[0] > b.bounds[2] || p[1] > b.bounds[3]) continue;
      if (inside(p, b.rings[0]) && !b.rings.slice(1).some((r) => inside(p, r))) return { country: b.country, region: b.name };
    }
    let best: RegionShape | null = null, bestD = 0.1;
    for (const b of this.near(p)) {
      if (p[0] < b.bounds[0] - bestD || p[0] > b.bounds[2] + bestD || p[1] < b.bounds[1] - bestD || p[1] > b.bounds[3] + bestD) continue;
      const d = distanceToRing(p, b.rings[0]);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best ? { country: best.country, region: best.name } : null;
  }
}

async function main() {
  const started = Date.now();
  const log = (s: string) => console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${s}`);
  const { directory } = JSON.parse(await readFile(path.join(catalogRoot, "current.json"), "utf8")) as { directory: string };
  const dir = path.join(catalogRoot, directory);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as CatalogManifest & { tiers?: { verified: number; mapped: number }; world?: WorldManifest };
  if (manifest.world) throw new Error(`${directory} already has worldwide trails; run build.ts first for a fresh snapshot.`);

  const admin1 = JSON.parse(gunzipSync(await readFile(path.join(root, "data/sources/world-admin1.json.gz"))).toString()) as { regions: { c: string; n: string; b: number[]; p: number[][][][] }[] };
  const regions: RegionShape[] = admin1.regions.flatMap((r) => r.p.map((rings) => ({ name: r.n, country: r.c, rings, bounds: boundsOf(rings[0]) })));
  const grid = new RegionGrid(regions);
  const placeOf = (p: Pt) => grid.placeOf(p);

  // Wikidata items linked from relations (their wikidata tag, or the item's OSM relation id).
  interface WikiItem { qid: string; label: string; aliases: string[]; osmRelation: number | null; wikipedia: { title: string; url: string; extract: string } | null; image: WikiInfo["image"] | null }
  let wikiItems: WikiItem[] = [];
  try { wikiItems = (JSON.parse(gunzipSync(await readFile(path.join(root, "data/sources/wiki-world.json.gz"))).toString()) as { trails: WikiItem[] }).trails; } catch { log("No wiki-world.json.gz; worldwide trails get no Wikipedia text or photos."); }
  const wikiByQid = new Map(wikiItems.map((w) => [w.qid, w]));
  const wikiByRelation = new Map(wikiItems.filter((w) => w.osmRelation).map((w) => [w.osmRelation!, w]));
  let wikiMatched = 0;

  const files = (await readdir(WORLD_DIR)).filter((f) => f.endsWith(".json.gz")).sort();
  const codes = new Set(files.map((f) => f.replace(/\.json\.gz$/, "")));
  log(`${files.length} country files, ${regions.length.toLocaleString("en-US")} region outlines`);

  const out = path.join(dir, "world");
  await rm(out, { recursive: true, force: true });
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await mkdir(STAGE, { recursive: true });

  const builtRelations = new Set<number>();
  const builtIds = new Set<string>();
  const report: Record<string, { relations: number; mapped: number; mergedIntoRelation: number; duplicates: number; tooShort: number }> = {};
  const countries: Record<string, number> = {};
  const indexFiles: Record<string, { rows: number; sha256: string }> = {};
  const retrievedAt = new Date().toISOString();
  const stagedCells = new Set<string>();
  let verified = 0, mapped = 0;

  for (const file of files) {
    const code = file.replace(/\.json\.gz$/, "");
    const part = PART_OF[code];
    // A trail belongs to the file of the country holding its pin; trails whose pin lies in a country without
    // its own file (small territories) are kept by the first file that has them.
    const owns = (place: Place) => part
      ? place.country === part.country && place.region === part.region
      : !REGIONAL.has(place.country) && (place.country === code || !codes.has(place.country));
    const data = await readOsmRegion(path.join(WORLD_DIR, file));
    const relTags = new Map<number, Tags>();
    const relMembers = new Map<number, [string, number, string][]>();
    for (const [id, r] of Object.entries(data.relations)) { relTags.set(Number(id), r.tags); relMembers.set(Number(id), r.members); }
    const memberWays = new Map<number, Pt[]>();
    for (const r of Object.values(data.relations)) for (const [t, ref] of r.members) if (t === "w" && data.ways[ref]) memberWays.set(ref, data.ways[ref]);
    const lines = new Map<string, Lines>();

    // ---- relations ----
    const rel = relationRows({ relTags, relMembers, memberWays, placeOf, reject, owns, retrievedAt, simplify: SIMPLIFY_WORLD, skip: (id) => builtRelations.has(id) });
    for (const r of rel.rows) {
      builtRelations.add(r.osm!.relation);
      const tags = relTags.get(r.osm!.relation)!;
      const w = wikiByQid.get(tags.wikidata ?? "") ?? wikiByRelation.get(r.osm!.relation);
      if (!w) continue;
      r.wiki = { qid: w.qid, ...(w.wikipedia?.extract ? { title: w.wikipedia.title, url: w.wikipedia.url, extract: w.wikipedia.extract } : {}), ...(w.image?.url ? { image: w.image } : {}) };
      const names = [...w.aliases, ...(w.label !== r.name ? [w.label] : [])].filter((n) => n && n !== r.name && !/^Q\d+$/.test(n));
      if (names.length) r.altNames = [...new Set([...(r.altNames ?? []), ...names])];
      wikiMatched++;
    }
    for (const [id, l] of rel.lines) lines.set(id, l);
    memberWays.clear();

    // ---- named ways ----
    const candidates = joinNamedWays(data.trails, data.ways, new Set<number>());
    const named = namedRows({ candidates, placeOf, reject, owns, retrievedAt, simplify: SIMPLIFY_WORLD });
    candidates.length = 0;
    for (const [id, l] of named.lines) lines.set(id, l);

    // A named way that is the same trail as a relation becomes one of its sources.
    const relIndex = new LineIndex(MATCH_METERS);
    const relCoarse = new Set<string>();
    for (const r of rel.rows) { const l = lines.get(r.id)!; relIndex.add(l, r.id); for (const line of l) for (const [x, y] of line) relCoarse.add(coarseKey(x, y)); }
    const relById = new Map(rel.rows.map((r) => [r.id, r]));
    const redirects: Record<string, string> = {};
    let mergedIntoRelation = 0;
    const kept: CatalogTrail[] = [];
    for (const r of named.rows) {
      if (builtIds.has(r.id)) continue;
      const l = lines.get(r.id)!;
      let target: CatalogTrail | null = null;
      if (l.some((line) => line.some(([x, y]) => relCoarse.has(coarseKey(x, y))))) {
        for (const [rid, share] of relIndex.ownerShares(l)) {
          if (share < MATCH_SHARE) continue;
          const v = relById.get(rid)!;
          if ([v.name, ...(v.altNames ?? [])].some((n) => sameName(n, r.name))) { target = v; break; }
        }
      }
      if (target) {
        target.sources = [...(target.sources ?? []), { type: "OPENSTREETMAP" as const, id: r.sourceId, url: r.sourceUrl, name: r.name }].filter((s, i, a) => a.findIndex((x) => x.url === s.url) === i);
        if (!target.osmWay && r.osmWay) target.osmWay = r.osmWay;
        if (!target.surface && r.surface) target.surface = r.surface;
        redirects[r.id] = target.id;
        mergedIntoRelation++;
        continue;
      }
      kept.push(r);
    }
    // Same name within 2 km with overlapping lines: keep the longer record.
    const byName = new Map<string, CatalogTrail[]>();
    for (const r of kept) { const k = nameKey(r.name); (byName.get(k) ?? byName.set(k, []).get(k)!).push(r); }
    const dropped = new Set<string>();
    for (const group of byName.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => (b.miles ?? 0) - (a.miles ?? 0));
      for (let i = 0; i < group.length; i++) {
        if (dropped.has(group[i].id)) continue;
        const keep = group[i];
        let idx: LineIndex | null = null;
        for (let j = i + 1; j < group.length; j++) {
          const other = group[j];
          if (dropped.has(other.id) || km([keep.longitude, keep.latitude], [other.longitude, other.latitude]) > DUPLICATE_KM + (keep.miles ?? 0) * 1.6) continue;
          idx ??= (() => { const x = new LineIndex(MATCH_METERS); x.add(lines.get(keep.id)!, keep.id); return x; })();
          if (idx.coveredShare(lines.get(other.id)!) >= MATCH_SHARE) { dropped.add(other.id); redirects[other.id] = keep.id; reject("R7_duplicate", "osm-way"); }
        }
      }
    }
    let tooShort = 0;
    const mappedRows = kept.filter((r) => {
      if (dropped.has(r.id)) return false;
      if ((r.miles ?? 0) < MIN_MILES) { reject("R2_too_short", "osm-way"); tooShort++; return false; }
      return true;
    });

    const rows = [...rel.rows.filter((r) => !builtIds.has(r.id)), ...mappedRows];
    for (const r of rows) { r.qualityScore = qualityScore(r); builtIds.add(r.id); countries[r.country] = (countries[r.country] ?? 0) + 1; }
    verified += rows.filter((r) => r.tier === "verified").length;
    mapped += rows.filter((r) => r.tier === "mapped").length;

    // ---- write ----
    const buf = gzipSync(JSON.stringify({ rows, redirects }), { level: 9 });
    await writeFile(path.join(out, `index-${code}.json.gz`), buf);
    indexFiles[code] = { rows: rows.length, sha256: sha(buf) };
    const byCell = new Map<string, Record<string, Lines>>();
    for (const r of rows) (byCell.get(r.geometryShard) ?? byCell.set(r.geometryShard, {}).get(r.geometryShard)!)[r.id] = lines.get(r.id)!;
    for (const [cell, part] of byCell) { await appendFile(path.join(STAGE, cell), JSON.stringify(part) + "\n"); stagedCells.add(cell); }
    report[code] = { relations: rel.rows.length, mapped: mappedRows.length, mergedIntoRelation, duplicates: dropped.size, tooShort };
    log(`${code}: ${rel.rows.length.toLocaleString("en-US")} relation trails, ${mappedRows.length.toLocaleString("en-US")} mapped (${mergedIntoRelation} merged into a relation, ${dropped.size} duplicates, ${tooShort} under ${MIN_MILES} mi)`);
  }

  // ---- geometry cells ----
  let geometryBytes = 0;
  for (const cell of stagedCells) {
    const merged: Record<string, Lines> = {};
    for (const line of (await readFile(path.join(STAGE, cell), "utf8")).split("\n")) if (line) Object.assign(merged, JSON.parse(line));
    const buf = gzipSync(JSON.stringify(merged), { level: 9 });
    geometryBytes += buf.length;
    await writeFile(path.join(out, `geometry-${cell}.json.gz`), buf);
  }
  await rm(STAGE, { recursive: true, force: true });

  // ---- manifest ----
  const world: WorldManifest = { files: indexFiles, countries, verified, mapped, wikiMatched, geometryCells: stagedCells.size, geometryBytes, retrievedAt };
  const total = verified + mapped;
  const next = {
    ...manifest,
    generatedAt: new Date().toISOString(),
    countries: { ...manifest.countries, ...Object.fromEntries(Object.entries(countries).map(([c, n]) => [c, (manifest.countries?.[c] ?? 0) + n])) },
    ...(manifest.tiers ? { tiers: { verified: manifest.tiers.verified + verified, mapped: manifest.tiers.mapped + mapped } } : {}),
    world,
    sources: [
      ...manifest.sources.filter((s) => !["osm-world", "wikidata-world", "natural-earth"].includes(s.key ?? "")),
      { key: "osm-world", name: "OpenStreetMap route relations and named trail ways worldwide", url: "https://www.openstreetmap.org", license: "ODbL 1.0 — © OpenStreetMap contributors", count: total, query: "the planet file (AWS Open Data mirror): route=hiking|foot|walking|running|fitness_trail|bicycle|mtb|horse|ski|piste|canoe|inline_skates relations, named highway=path|footway|track|bridleway|cycleway ways and named pistes, after verification rules R1–R10", retrievedAt },
      { key: "wikidata-world", name: "Wikidata items linked from worldwide OpenStreetMap routes, with Wikipedia lead paragraphs and Commons images", url: "https://www.wikidata.org", license: "Wikidata CC0; Wikipedia text CC BY-SA 4.0; images per their Commons licence", count: wikiMatched, query: "the wikidata tag of each worldwide route relation (or the item's OSM relation id)", retrievedAt },
      { key: "natural-earth", name: "Natural Earth admin-1 states and provinces", url: "https://www.naturalearthdata.com", license: "Public domain", count: regions.length, query: "1:10m cultural vectors, v5.1 — country and region of each worldwide trail", retrievedAt },
    ],
    notes: [
      ...manifest.notes.filter((n) => !/^Worldwide:/.test(n)),
      `Worldwide: ${total.toLocaleString("en-US")} trails in ${Object.keys(countries).length} countries outside the U.S. and Canada (and in Alaska and Hawaii) from OpenStreetMap — ${verified.toLocaleString("en-US")} route relations and ${mapped.toLocaleString("en-US")} named trails — built with the same verification rules.`,
    ],
  };
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(next, null, 2) + "\n");
  await writeFile(path.join(out, "report.json"), JSON.stringify({ world, byCountryFile: report, rejected, rules: RULES }, null, 2) + "\n");
  log(`Worldwide: ${verified.toLocaleString("en-US")} verified + ${mapped.toLocaleString("en-US")} mapped = ${total.toLocaleString("en-US")} trails in ${Object.keys(countries).length} countries; geometry ${(geometryBytes / 1e6).toFixed(0)} MB in ${stagedCells.size} cells.`);
  console.log("Rejected by rule:");
  for (const [rule, bySrc] of Object.entries(rejected)) console.log(`  ${rule}: ${Object.values(bySrc).reduce((a, b) => a + b, 0).toLocaleString("en-US")} ${JSON.stringify(bySrc)}`);
}

export interface WorldManifest {
  /** Per country file: rows and the sha-256 of world/index-<code>.json.gz. */
  files: Record<string, { rows: number; sha256: string }>;
  countries: Record<string, number>;
  verified: number;
  mapped: number;
  /** Worldwide trails with a matched Wikidata item. */
  wikiMatched: number;
  geometryCells: number;
  geometryBytes: number;
  retrievedAt: string;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
