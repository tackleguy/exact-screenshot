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
  const root = path.resolve("data/trail-catalog");
  const pointer = JSON.parse(await readFile(path.join(root, "current.json"), "utf8"));
  if (!/^snapshot-\d+$/.test(pointer.directory)) throw new Error("Invalid trail snapshot");
  const source = path.join(root, pointer.directory);
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  const raw = await readFile(path.join(source, "index.json.gz"));
  if (sha(raw) !== manifest.indexSha256) throw new Error("Trail checksum mismatch");
  const sections: CatalogTrail[] = JSON.parse(gunzipSync(raw).toString());
  for (const row of sections) { row.name = titleCaseName(row.name); row.season = normalizeSeason(row.season); }
  const routes = buildThroughHikeOverlay(sections);
  const resorts = buildResortOverlay(JSON.parse(await readFile(path.join(root, "resort-trails.json"), "utf8")).resorts, sections);
  const redirects: Record<string, string> = Object.fromEntries(sections.filter((t) => t.mergedInto).map((t) => [t.id, t.mergedInto!]));
  const rows = [...sections.filter(shown), ...routes, ...resorts];

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
  const worldGeometry = new Set((await readdir(path.join(source, "world")).catch(() => [] as string[])).filter((f) => /^geometry-.+\.json\.gz$/.test(f)));
  const geometryCells = new Set([...wanted.keys(), ...[...worldGeometry].map((f) => f.slice(9, -8))]);
  for (const shard of geometryCells) {
    let data: Record<string, unknown> = {};
    const ids = wanted.get(shard);
    if (ids) {
      try { data = Object.fromEntries(Object.entries(JSON.parse(gunzipSync(await readFile(path.join(source, `geometry-${shard}.json.gz`))).toString()) as Record<string, unknown>).filter(([id]) => ids.has(id))); } catch { /* no lines in this cell */ }
    }
    if (worldGeometry.has(`geometry-${shard}.json.gz`)) Object.assign(data, JSON.parse(gunzipSync(await readFile(path.join(source, "world", `geometry-${shard}.json.gz`))).toString()));
    for (const [id, lines] of Object.entries(data)) boundsById.set(id, extent(lines as [number, number][][]));
    if (Object.keys(data).length) await writeFile(path.join(output, `geometry-${shard}.json.gz`), zipped(data));
  }

  // ---- U.S. and Canada: trails by 2° cell; a trail is listed in every cell its line passes through ----
  const cells = new Map<string, CatalogTrail[]>();
  for (const row of rows) {
    const b = boundsById.get(row.id);
    if (b) row.bounds = b;
    for (const key of cellKeysOf(row)) (cells.get(key) ?? cells.set(key, []).get(key)!).push(row);
  }
  await Promise.all([...cells].map(([key, trails]) => writeFile(path.join(output, `cell-${key}.json.gz`), zipped(trails.map(slim)))));
  for (const t of rows) { index(t); count(t); pageOf(t); }
  for (const [from, to] of Object.entries(redirects)) setRecord(from, JSON.stringify(`r:${to}`));

  // ---- worldwide, one country file at a time ----
  const world = manifest.world as { files: Record<string, { rows: number; sha256: string }> } | undefined;
  const worldCells: Record<string, string[]> = {};
  const countriesWithTrails: string[] = [];
  let worldRows = 0;
  for (const [code, info] of Object.entries(world?.files ?? {})) {
    const buf = await readFile(path.join(source, "world", `index-${code}.json.gz`));
    if (sha(buf) !== info.sha256) throw new Error(`Trail checksum mismatch (${code})`);
    const data = JSON.parse(gunzipSync(buf).toString()) as { rows: CatalogTrail[]; redirects: Record<string, string> };
    const byCell = new Map<string, CatalogTrail[]>();
    for (const t of data.rows) {
      t.name = titleCaseName(t.name);
      const b = boundsById.get(t.id);
      if (b) t.bounds = b;
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
    ...manifest, world: undefined, total: rows.length + worldRows, cells: [...cells.keys()], worldCells, searchRegions, searchCountries: [...new Set(["US", "CA", ...countriesWithTrails])],
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
  console.log(`Prepared ${(rows.length + worldRows).toLocaleString("en-US")} trails (${worldRows.toLocaleString("en-US")} worldwide in ${countriesWithTrails.length} countries) in ${cells.size} + ${Object.values(worldCells).flat().length} cell files; ${names.length} sitemap files.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
