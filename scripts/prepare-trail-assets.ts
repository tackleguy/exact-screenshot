/**
 * Turns the current catalog snapshot (data/trail-catalog) into the static files the web app loads, at build time:
 *
 *   public/trail-data/<snapshot>/cell-<x>_<y>.json.gz       U.S./Canada trails whose pin is in each 2° cell
 *   public/trail-data/<snapshot>/cell-<x>_<y>-<CC>.json.gz  worldwide trails, per 2° cell and country
 *   public/trail-data/<snapshot>/geometry-<cell>.json.gz    their lines, in 1° cells
 *   public/trail-data/<snapshot>/q/<key>.json.gz            search entries [id, name, other names, places, score] of
 *                                                           every trail with a word starting with the key
 *   public/trail-data/<snapshot>/q/r-<region>.json.gz       the best trails of a region (q/c-<CC>: of a country)
 *   public/trail-data/<snapshot>/rows/r-<hhhh>.json.gz       full trail records by id, and merged id → trail it joined
 *   public/trail-data/<snapshot>/ski-areas.json.gz          every operating ski area (OpenSkiMap), for the ski map
 *   public/trail-data/<snapshot>/clusters.json.gz           zoomed-out count bubbles per section and grid size
 *   public/trail-data/<snapshot>/redirects.json.gz          merged/duplicate ids → the trail they now belong to
 *   public/sitemap.xml + public/sitemaps/trails-N.xml + public/robots.txt
 *
 * Worldwide trails (pipeline/steps/world.ts) are read one country at a time, so memory stays bounded however many
 * countries the snapshot holds. Only shown trails are shipped (verified or mapped tier; nothing rejected, merged
 * or a fragment). Everything here is generated, so public/trail-data, public/sitemaps, public/sitemap.xml and
 * public/robots.txt are not committed.
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildThroughHikeOverlay } from "../src/lib/trail-catalog/through-hikes";
import { buildResortOverlay } from "../src/lib/trail-catalog/resorts";
import { normalizeSeason, titleCaseName } from "../src/lib/trail-catalog/agencies";
import { computeDifficulty, effortClimbFt } from "../src/lib/trail-difficulty";
import { cleanTrailName, dedupeKey, isJunkSegment, overlapShare, routeTypeFromLines } from "../src/lib/trail-catalog/cleanup";
import { sectionOf, trailActivities } from "../src/lib/trail-catalog/activity";
import { countryName, type CatalogTrail } from "../src/lib/trail-catalog/types";
import { pinCell, regionSlug, rowShard, searchKey, SEARCH_STOPWORDS } from "../src/lib/trail-catalog/static-data";
import { normalizeText } from "../src/lib/trail-catalog/fuzzy";

const SITE = (process.env.SITE_URL ?? process.env.VITE_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://hyked.lovable.app").replace(/\/+$/, "");
const GRIDS = [8, 4, 2, 1, 0.5, 0.25];
const SITEMAP_URLS = 45_000;
/** Trails in each region or country search file. */
const REGION_TOP = 1500;

const shown = (t: CatalogTrail) => !t.mergedInto && t.confidence !== "REJECTED" && t.quality !== "fragment";
const zipped = (value: unknown) => gzipSync(JSON.stringify(value));
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** Extent [west, south, east, north] of a trail's lines, rounded to ~10 m. */
function extent(lines: [number, number][][]): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90;
  for (const line of lines) for (const [x, y] of line) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return [r(w), r(s), r(e), r(n)];
}

/** 2° cells a trail is listed in: its pin's, plus every cell its line extent overlaps (up to 64). */
function cellKeysOf(t: CatalogTrail): string[] {
  const home = pinCell(t.longitude, t.latitude);
  const b = t.bounds;
  if (!b || b[2] - b[0] > 180) return [home];
  const keys = new Set([home]);
  const x0 = Math.floor((b[0] + 180) / 2), x1 = Math.floor((b[2] + 180) / 2), y0 = Math.floor((b[1] + 90) / 2), y1 = Math.floor((b[3] + 90) / 2);
  for (let x = x0; x <= x1 && keys.size < 64; x++) for (let y = y0; y <= y1 && keys.size < 64; y++) keys.add(`${x}_${y}`);
  return [...keys];
}

type SearchRow = [id: string, name: string, alt: string, place: string, score: number];
const searchRow = (t: CatalogTrail): SearchRow => [t.id, t.name, [...(t.altNames ?? []), t.wiki?.title].filter(Boolean).join(" | "), [t.park, t.forest, t.blmArea, t.manager, t.region, t.country !== "US" && t.country !== "CA" ? countryName(t.country) : t.country].filter(Boolean).join(" "), t.qualityScore ?? 0];
/** Search files a trail is filed under: its name, other-name and park/forest words (common words only when nothing else). */
function searchKeysOf(t: CatalogTrail) {
  const words = normalizeText([t.name, ...(t.altNames ?? []), t.wiki?.title, t.park, t.forest, t.blmArea].filter(Boolean).join(" ")).split(" ").filter((w) => w.length >= 3);
  const keys = new Set(words.filter((w) => !SEARCH_STOPWORDS.has(w)).map(searchKey));
  if (!keys.size) for (const w of words) keys.add(searchKey(w));
  return keys;
}
/** Detail-only fields left out of the map/list cells (the trail page reads the full record from rows/). */
const DETAIL_ONLY = ["factSources", "sourceUrl", "sourceDate", "distanceBasis", "confidence", "sourceId", "officialUrl", "sources"] as const;
function slim(t: CatalogTrail): CatalogTrail {
  const out = { ...t } as Record<string, unknown>;
  for (const k of DETAIL_ONLY) delete out[k];
  if (t.osmWay) out.osmWay = { highway: t.osmWay.highway };
  if (t.wiki) out.wiki = { ...t.wiki, extract: undefined };
  return out as unknown as CatalogTrail;
}

async function main() {
  const __t0=Date.now();const lap=(m:string)=>console.log(`[prep ${((Date.now()-__t0)/1000).toFixed(1)}s] ${m}`);
  const root = path.resolve("data/trail-catalog");
  const pointer = JSON.parse(await readFile(path.join(root, "current.json"), "utf8"));
  if (!/^snapshot-\d+$/.test(pointer.directory)) throw new Error("Invalid trail snapshot");
  const source = path.join(root, pointer.directory);
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  const raw = await readFile(path.join(source, "index.json.gz"));
  if (sha(raw) !== manifest.indexSha256) throw new Error("Trail checksum mismatch");
  const sections: CatalogTrail[] = JSON.parse(gunzipSync(raw).toString());
  for (const row of sections) { row.name = titleCaseName(row.name); row.season = normalizeSeason(row.season); }
  lap("loaded");
  const routes = buildThroughHikeOverlay(sections);
  lap("routes built");
  const resorts = buildResortOverlay(JSON.parse(await readFile(path.join(root, "resort-trails.json"), "utf8")).resorts, sections);
  lap("resorts built");
  const redirects: Record<string, string> = Object.fromEntries(sections.filter((t) => t.mergedInto).map((t) => [t.id, t.mergedInto!]));
  // Measured elevation (pipeline/steps/elevation.ts): [gainFt, lossFt, minFt, maxFt, steepestGradePct] by trail id.
  const elevation: Record<string, [number, number, number, number, number | null]> = await readFile(path.join(source, "elevation.json.gz")).then((b) => JSON.parse(gunzipSync(b).toString())).catch(() => ({}));
  /** Stores the measured climb and the one difficulty rating (src/lib/trail-difficulty.ts) on a trail. */
  const rate = (t: CatalogTrail) => {
    const e = elevation[t.id];
    if (e) {
      const climb = effortClimbFt({ gainFt: e[0], lossFt: e[1] }, t.routeType);
      t.gainFt = climb;
      t.lossFt = climb === e[0] ? e[1] : e[0];
      t.minElevFt = e[2]; t.maxElevFt = e[3]; t.steepestGradePct = e[4];
    }
    if (t.reportedDifficulty === undefined) t.reportedDifficulty = t.difficulty ?? null;
    t.difficulty = computeDifficulty({ lengthMi: t.miles, gainFt: t.gainFt, steepestGradePct: t.steepestGradePct, maxElevFt: t.maxElevFt }) ?? t.difficulty;
  };
  const rows = [...sections.filter(shown), ...routes, ...resorts];

  lap("rows ready");
  await rm(path.resolve("public/trail-data"), { recursive: true, force: true });
  const output = path.resolve("public/trail-data", pointer.directory);
  await mkdir(path.join(output, "q"), { recursive: true });
  await mkdir(path.join(output, "rows"), { recursive: true });

  // Everything below accumulates across the U.S./Canada rows and then each country's rows in turn.
  // Full records and search entries are kept as JSON text (one string per trail, shared by every file it is in).
  const records = new Map<string, string[]>();
  const setRecord = (id: string, json: string) => { const k = rowShard(id); (records.get(k) ?? records.set(k, []).get(k)!).push(`${JSON.stringify(id)}:${json}`); };
  const searchFiles = new Map<string, string[]>();
  const tops = new Map<string, [number, string][]>();
  const addTop = (file: string, score: number, json: string) => {
    const list = tops.get(file) ?? tops.set(file, []).get(file)!;
    list.push([score, json]);
    if (list.length > REGION_TOP * 3) tops.set(file, list.sort((a, b) => b[0] - a[0]).slice(0, REGION_TOP));
  };
  const index = (t: CatalogTrail) => {
    setRecord(t.id, JSON.stringify(t));
    const entry = searchRow(t);
    const json = JSON.stringify(entry);
    for (const key of searchKeysOf(t)) (searchFiles.get(key) ?? searchFiles.set(key, []).get(key)!).push(json);
    if (t.region) addTop(`r-${regionSlug(normalizeText(t.region))}`, entry[4], json);
    addTop(`c-${t.country}`, entry[4], json);
  };
  type Acc = [number, number, number, number, number, number, number, number];
  const acc: Record<string, Record<string, Map<string, Acc>>> = {};
  const count = (t: CatalogTrail) => {
    if (t.kind !== "segment" || t.source === "resort") return;
    for (const section of new Set(trailActivities(t).map((a) => sectionOf(a).key))) {
      for (const g of GRIDS) {
        const bucket = ((acc[section] ??= {})[String(g)] ??= new Map());
        const k = `${Math.floor(t.longitude / g)}:${Math.floor(t.latitude / g)}`;
        const a = bucket.get(k) ?? [0, 0, 0, 0, 180, 90, -180, -90];
        a[0] += t.longitude; a[1] += t.latitude; a[2]++; if (t.tier === "verified") a[3]++;
        a[4] = Math.min(a[4], t.longitude); a[5] = Math.min(a[5], t.latitude); a[6] = Math.max(a[6], t.longitude); a[7] = Math.max(a[7], t.latitude);
        bucket.set(k, a);
      }
    }
  };
  const trailUrls: string[] = [];
  const pageOf = (t: CatalogTrail) => { if (t.kind === "segment" || t.source === "route-aggregate") trailUrls.push(`/explore/trails/${encodeURIComponent(t.id)}`); };

  // Lines of shown U.S./Canada trails only.
  const wanted = new Map<string, Set<string>>();
  for (const t of rows) if (t.geometryShard !== "route" && t.source !== "resort") (wanted.get(t.geometryShard) ?? wanted.set(t.geometryShard, new Set()).get(t.geometryShard)!).add(t.id);

  // ---- geometry: U.S./Canada lines of shown trails, merged with the worldwide lines of the same 1° cell ----
  const boundsById = new Map<string, [number, number, number, number]>();
  const routeTypeById = new Map<string, CatalogTrail["routeType"]>();
  // Worldwide rows are too large to rebuild inside a publish (time limit and memory); opt in with TRAIL_WORLD=1.
  const includeWorld = process.env.TRAIL_WORLD === "1";
  const worldGeometry = new Set(!includeWorld ? [] : (await readdir(path.join(source, "world")).catch(() => [] as string[])).filter((f) => /^geometry-.+\.json\.gz$/.test(f)));
  const geometryCells = new Set([...wanted.keys(), ...[...worldGeometry].map((f) => f.slice(9, -8))]);
  for (const shard of geometryCells) {
    let data: Record<string, unknown> = {};
    const ids = wanted.get(shard);
    if (ids) {
      try { data = Object.fromEntries(Object.entries(JSON.parse(gunzipSync(await readFile(path.join(source, `geometry-${shard}.json.gz`))).toString()) as Record<string, unknown>).filter(([id]) => ids.has(id))); } catch { /* no lines in this cell */ }
    }
    if (worldGeometry.has(`geometry-${shard}.json.gz`)) Object.assign(data, JSON.parse(gunzipSync(await readFile(path.join(source, "world", `geometry-${shard}.json.gz`))).toString()));
    for (const [id, lines] of Object.entries(data)) {
      boundsById.set(id, extent(lines as [number, number][][]));
      routeTypeById.set(id, routeTypeFromLines(lines as [number, number][][]));
    }
    if (!ids && worldGeometry.has(`geometry-${shard}.json.gz`)) await copyFile(path.join(source, "world", `geometry-${shard}.json.gz`), path.join(output, `geometry-${shard}.json.gz`));
    else if (Object.keys(data).length) await writeFile(path.join(output, `geometry-${shard}.json.gz`), zipped(data));
  }

  lap("geometry done");
  // ---- cleanup (src/lib/trail-catalog/cleanup.ts): names, route type from the line, rating, junk, near-duplicates ----
  const tally = { renamed: 0, review: 0, routeTypes: 0, dropped: 0, merged: 0 };
  const lineCache = new Map<string, Record<string, [number, number][][]>>();
  const linesOf = async (t: CatalogTrail) => {
    if (!t.geometryShard || t.geometryShard === "route") return null;
    let cell = lineCache.get(t.geometryShard);
    if (!cell) {
      cell = await readFile(path.join(output, `geometry-${t.geometryShard}.json.gz`)).then((b) => JSON.parse(gunzipSync(b).toString())).catch(() => ({}));
      lineCache.set(t.geometryShard, cell!);
      if (lineCache.size > 64) lineCache.delete(lineCache.keys().next().value!);
    }
    return cell![t.id] ?? null;
  };
  const overlaps = (a: [number, number, number, number], b: [number, number, number, number]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  const cleanup = async (list: CatalogTrail[]) => {
    for (const t of list) {
      const { name, needsReview } = cleanTrailName(t.name);
      if (name !== t.name) { t.name = name; tally.renamed++; }
      // Section lists and "part of" links carry copies of other trails' names.
      if (t.sections) for (const sec of t.sections) sec.name = cleanTrailName(sec.name).name;
      if (t.partOfRoute) t.partOfRoute = { ...t.partOfRoute, name: cleanTrailName(t.partOfRoute.name).name };
      if (needsReview) { t.quality = "review"; t.flags = [...new Set([...(t.flags ?? []), "needs-review" as const])]; tally.review++; }
      const type = t.kind === "segment" ? routeTypeById.get(t.id) : undefined;
      if (type && type !== t.routeType) { t.routeType = type; tally.routeTypes++; }
      if (t.routeType === "network") t.routeType = "segment";
      t.bounds = boundsById.get(t.id) ?? t.bounds;
      rate(t);
    }
    const kept = list.filter((t) => !isJunkSegment(t));
    tally.dropped += list.length - kept.length;
    // The same trail mapped twice under slightly different names ("Valley Loop Trail" and "Yosemite Valley Loop
    // Trail"): when the lines overlap by more than 60%, the shorter becomes a segment of the longer.
    const groups = new Map<string, CatalogTrail[]>();
    for (const t of kept) {
      if (t.kind !== "segment" || t.partOfRoute || !t.bounds) continue;
      const key = dedupeKey(t);
      if (key) (groups.get(`${t.country}|${key}`) ?? groups.set(`${t.country}|${key}`, []).get(`${t.country}|${key}`)!).push(t);
    }
    for (const group of groups.values()) {
      if (group.length < 2 || group.length > 60) continue;
      group.sort((a, b) => (b.miles ?? 0) - (a.miles ?? 0));
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
        const long = group[i], short = group[j];
        if (long.partOfRoute || short.partOfRoute || !overlaps(long.bounds!, short.bounds!)) continue;
        const [a, b] = await Promise.all([linesOf(short), linesOf(long)]);
        if (!a || !b || overlapShare(a, b) <= 0.6) continue;
        short.partOfRoute = { id: long.id, name: long.name, totalMiles: long.miles ?? 0 };
        if ((long.sections?.length ?? 0) < 120) long.sections = [...(long.sections ?? []), { id: short.id, name: short.name, miles: short.miles ?? 0, difficulty: short.difficulty ?? null }];
        tally.merged++;
      }
    }
    return kept;
  };

  lap("cleanup defined");
  // ---- U.S. and Canada: trails by 2° cell; a trail is listed in every cell its line passes through ----
  const naRows = await cleanup(rows);
  lap("NA cleanup done");
  const cells = new Map<string, CatalogTrail[]>();
  for (const row of naRows) {
    const b = boundsById.get(row.id);
    if (b) row.bounds = b;
    for (const key of cellKeysOf(row)) (cells.get(key) ?? cells.set(key, []).get(key)!).push(row);
  }
  await Promise.all([...cells].map(([key, trails]) => writeFile(path.join(output, `cell-${key}.json.gz`), zipped(trails.map(slim)))));
  for (const t of naRows) { index(t); count(t); pageOf(t); }
  for (const [from, to] of Object.entries(redirects)) setRecord(from, JSON.stringify(`r:${to}`));

  lap("NA written");
  // ---- worldwide, one country file at a time ----
  const world = !includeWorld ? undefined : manifest.world as { files: Record<string, { rows: number; sha256: string }> } | undefined;
  const worldCells: Record<string, string[]> = {};
  const countriesWithTrails: string[] = [];
  let worldRows = 0;
  for (const [code, info] of Object.entries(world?.files ?? {})) {
    const buf = await readFile(path.join(source, "world", `index-${code}.json.gz`));
    if (sha(buf) !== info.sha256) throw new Error(`Trail checksum mismatch (${code})`);
    const data = JSON.parse(gunzipSync(buf).toString()) as { rows: CatalogTrail[]; redirects: Record<string, string> };
    const byCell = new Map<string, CatalogTrail[]>();
    for (const t of data.rows) t.name = titleCaseName(t.name);
    data.rows = await cleanup(data.rows);
    for (const t of data.rows) {
      for (const k of cellKeysOf(t)) (byCell.get(k) ?? byCell.set(k, []).get(k)!).push(t);
      index(t);
      count(t);
      pageOf(t);
    }
    for (const [from, to] of Object.entries(data.redirects)) setRecord(from, JSON.stringify(`r:${to}`));
    for (const [key, trails] of byCell) {
      await writeFile(path.join(output, `cell-${key}-${code}.json.gz`), zipped(trails.map(slim)));
      (worldCells[key] ??= []).push(code);
    }
    countriesWithTrails.push(code);
    worldRows += data.rows.length;
  }

  lap("world done");
  // ---- indexes ----
  const writeText = (file: string, text: string) => writeFile(path.join(output, file), gzipSync(text));
  for (const [key, entries] of searchFiles) await writeText(`q/${key}.json.gz`, `[${entries.join(",")}]`);
  const searchRegions: string[] = [];
  for (const [file, list] of tops) {
    await writeText(`q/${file}.json.gz`, `[${list.sort((a, b) => b[0] - a[0]).slice(0, REGION_TOP).map((x) => x[1]).join(",")}]`);
    if (file.startsWith("r-")) searchRegions.push(file.slice(2));
  }
  for (const [k, part] of records) await writeText(`rows/r-${k}.json.gz`, `{${part.join(",")}}`);
  await writeFile(path.join(output, "redirects.json.gz"), zipped(redirects));
  await writeFile(path.join(output, "overview.json.gz"), zipped(routes));

  // Count bubbles: per section and grid size, [meanLng, meanLat, count, verified, west, south, east, north].
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const clusters = { grids: GRIDS, sections: Object.fromEntries(Object.entries(acc).map(([section, byGrid]) => [section, Object.fromEntries(Object.entries(byGrid).map(([g, bucket]) => [g, [...bucket.values()].map((a) => [r4(a[0] / a[2]), r4(a[1] / a[2]), a[2], a[3], r4(a[4]), r4(a[5]), r4(a[6]), r4(a[7])])]))])) };
  await writeFile(path.join(output, "clusters.json.gz"), zipped(clusters));

  await writeFile(path.join(output, "manifest.json"), JSON.stringify({
    ...manifest, world: undefined, total: naRows.length + worldRows, cells: [...cells.keys()], worldCells, searchRegions, searchCountries: [...new Set(["US", "CA", ...countriesWithTrails])],
    rowShards: true, searchFiles: true,
    featureCells: (await readdir(path.join(source, "features")).catch(() => [] as string[])).map((f) => f.slice(2, -8)), directory: pointer.directory,
  }));
  await writeFile(path.resolve("public/trail-data/current.json"), JSON.stringify(pointer));
  await Promise.all([
    copyFile("data/sources/trailheads-na.json.gz", path.join(output, "trailheads.json.gz")),
    copyFile("data/towns/towns.json.gz", path.join(output, "towns.json.gz")),
    copyFile("data/sources/ski-areas.json.gz", path.join(output, "ski-areas.json.gz")).catch((error) => { if (error.code !== "ENOENT") throw error; }),
    copyFile(path.join(source, "curated.json.gz"), path.join(output, "curated.json.gz")).catch((error) => { if (error.code !== "ENOENT") throw error; }),
  ]);
  // Hike-feature layer (pipeline/steps/features.ts), already sharded by 1° cell.
  const featureFiles = await readdir(path.join(source, "features")).catch(() => [] as string[]);
  if (featureFiles.length) {
    await mkdir(path.join(output, "features"), { recursive: true });
    await Promise.all(featureFiles.map((f) => copyFile(path.join(source, "features", f), path.join(output, "features", f))));
  }

  // Sitemaps: one file per 45,000 trail pages plus the main pages, and robots.txt pointing at the index.
  await rm(path.resolve("public/sitemaps"), { recursive: true, force: true });
  await mkdir(path.resolve("public/sitemaps"), { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const pages = ["/", "/map", "/explore/trails", "/explore/trails/catalog", "/plan", "/gear", "/ski-areas", "/about/data"];
  const shards: string[][] = [pages];
  for (let i = 0; i < trailUrls.length; i += SITEMAP_URLS) shards.push(trailUrls.slice(i, i + SITEMAP_URLS));
  const names: string[] = [];
  for (const [i, urls] of shards.entries()) {
    const name = i === 0 ? "pages.xml" : `trails-${i}.xml`;
    names.push(name);
    await writeFile(path.resolve("public/sitemaps", name), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${xml(SITE + u)}</loc><lastmod>${today}</lastmod></url>`).join("\n")}\n</urlset>\n`);
  }
  await writeFile(path.resolve("public/sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${names.map((n) => `<sitemap><loc>${SITE}/sitemaps/${n}</loc><lastmod>${today}</lastmod></sitemap>`).join("\n")}\n</sitemapindex>\n`);
  await writeFile(path.resolve("public/robots.txt"), `User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`Cleanup: ${tally.renamed.toLocaleString("en-US")} renamed (${tally.review.toLocaleString("en-US")} review flags moved out of names), ${tally.routeTypes.toLocaleString("en-US")} route types read from the line, ${tally.dropped.toLocaleString("en-US")} junk segments dropped, ${tally.merged.toLocaleString("en-US")} near-duplicates folded into a longer trail.`);
  console.log(`Prepared ${(naRows.length + worldRows).toLocaleString("en-US")} trails (${worldRows.toLocaleString("en-US")} worldwide in ${countriesWithTrails.length} countries) in ${cells.size} + ${Object.values(worldCells).flat().length} cell files; ${names.length} sitemap files.`);
}
/** Lovable hosting rejects builds with more than 50,000 files; keep generated data well under that. */
const MAX_FILES = Number(process.env.MAX_TRAIL_FILES ?? 40_000);
async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) n += e.isDirectory() ? await countFiles(path.join(dir, e.name)) : 1;
  return n;
}
main().then(async () => {
  const n = await countFiles(path.resolve("public"));
  console.log(`public/ holds ${n.toLocaleString("en-US")} files`);
  if (n > MAX_FILES) throw new Error(`Too many generated files (${n} > ${MAX_FILES}); hosting caps builds at 50,000.`);
}).catch((error) => { console.error(error); process.exitCode = 1; });
