/**
 * Turns the current catalog snapshot (data/trail-catalog) into the static files the web app loads, at build time:
 *
 *   public/trail-data/<snapshot>/cell-<x>_<y>.json.gz     trails whose pin is in each 2° cell (loaded per map view)
 *   public/trail-data/<snapshot>/geometry-<cell>.json.gz  their lines, in 1° cells
 *   public/trail-data/<snapshot>/search.json.gz           search index (names, other names, places, score)
 *   public/trail-data/<snapshot>/clusters.json.gz         zoomed-out count bubbles per section and grid size
 *   public/trail-data/<snapshot>/redirects.json.gz        merged/duplicate ids → the trail they now belong to
 *   public/sitemap.xml + public/sitemaps/trails-N.xml + public/robots.txt
 *
 * Only shown trails are shipped (verified or mapped tier; nothing rejected, merged or a fragment). Everything here
 * is generated, so public/trail-data, public/sitemaps, public/sitemap.xml and public/robots.txt are not committed.
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildThroughHikeOverlay } from "../src/lib/trail-catalog/through-hikes";
import { buildResortOverlay } from "../src/lib/trail-catalog/resorts";
import { normalizeSeason, titleCaseName } from "../src/lib/trail-catalog/agencies";
import { sectionOf, trailActivities } from "../src/lib/trail-catalog/activity";
import type { CatalogTrail } from "../src/lib/trail-catalog/types";

const SITE = (process.env.SITE_URL ?? process.env.VITE_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://hyked.lovable.app").replace(/\/+$/, "");
const GRIDS = [8, 4, 2, 1, 0.5, 0.25];
const SITEMAP_URLS = 45_000;

const shown = (t: CatalogTrail) => !t.mergedInto && t.confidence !== "REJECTED" && t.quality !== "fragment";
const zipped = (value: unknown) => gzipSync(JSON.stringify(value));
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function main() {
  const root = path.resolve("data/trail-catalog");
  const pointer = JSON.parse(await readFile(path.join(root, "current.json"), "utf8"));
  if (!/^snapshot-\d+$/.test(pointer.directory)) throw new Error("Invalid trail snapshot");
  const source = path.join(root, pointer.directory);
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  const raw = await readFile(path.join(source, "index.json.gz"));
  if (createHash("sha256").update(raw).digest("hex") !== manifest.indexSha256) throw new Error("Trail checksum mismatch");
  const sections: CatalogTrail[] = JSON.parse(gunzipSync(raw).toString());
  for (const row of sections) { row.name = titleCaseName(row.name); row.season = normalizeSeason(row.season); }
  const routes = buildThroughHikeOverlay(sections);
  const resorts = buildResortOverlay(JSON.parse(await readFile(path.join(root, "resort-trails.json"), "utf8")).resorts, sections);
  const redirects: Record<string, string> = Object.fromEntries(sections.filter((t) => t.mergedInto).map((t) => [t.id, t.mergedInto!]));
  const rows = [...sections.filter(shown), ...routes, ...resorts];

  await rm(path.resolve("public/trail-data"), { recursive: true, force: true });
  const output = path.resolve("public/trail-data", pointer.directory);
  await mkdir(output, { recursive: true });

  // Trails by 2° cell of their pin.
  const cellOf = (t: CatalogTrail) => `${Math.floor((t.longitude + 180) / 2)}_${Math.floor((t.latitude + 90) / 2)}`;
  const cells = new Map<string, CatalogTrail[]>();
  for (const row of rows) { const key = cellOf(row); (cells.get(key) ?? cells.set(key, []).get(key)!).push(row); }
  await Promise.all([...cells].map(([key, trails]) => writeFile(path.join(output, `cell-${key}.json.gz`), zipped(trails))));

  // Lines of shown trails only.
  const wanted = new Map<string, Set<string>>();
  for (const t of rows) if (t.geometryShard !== "route" && t.source !== "resort") (wanted.get(t.geometryShard) ?? wanted.set(t.geometryShard, new Set()).get(t.geometryShard)!).add(t.id);
  for (const [shard, ids] of wanted) {
    let data: Record<string, unknown>;
    try { data = JSON.parse(gunzipSync(await readFile(path.join(source, `geometry-${shard}.json.gz`))).toString()); } catch { continue; }
    await writeFile(path.join(output, `geometry-${shard}.json.gz`), zipped(Object.fromEntries(Object.entries(data).filter(([id]) => ids.has(id)))));
  }

  // Search index: id, name, other names (OSM, Wikidata, Wikipedia title), places, cell, quality score.
  const search = rows.map((t) => [t.id, t.name, [...(t.altNames ?? []), t.wiki?.title].filter(Boolean).join(" | "), [t.park, t.forest, t.blmArea, t.manager, t.region, t.country].filter(Boolean).join(" "), cellOf(t), t.qualityScore ?? 0]);
  await writeFile(path.join(output, "search.json.gz"), zipped(search));
  await writeFile(path.join(output, "redirects.json.gz"), zipped(redirects));
  await writeFile(path.join(output, "overview.json.gz"), zipped(routes));

  // Count bubbles: per section and grid size, [meanLng, meanLat, count, verified, west, south, east, north].
  type Acc = [number, number, number, number, number, number, number, number];
  const acc: Record<string, Record<string, Map<string, Acc>>> = {};
  for (const t of rows) {
    if (t.kind !== "segment" || t.source === "resort") continue;
    const keys = new Set(trailActivities(t).map((a) => sectionOf(a).key));
    for (const section of keys) {
      for (const g of GRIDS) {
        const bucket = ((acc[section] ??= {})[String(g)] ??= new Map());
        const k = `${Math.floor(t.longitude / g)}:${Math.floor(t.latitude / g)}`;
        const a = bucket.get(k) ?? [0, 0, 0, 0, 180, 90, -180, -90];
        a[0] += t.longitude; a[1] += t.latitude; a[2]++; if (t.tier === "verified") a[3]++;
        a[4] = Math.min(a[4], t.longitude); a[5] = Math.min(a[5], t.latitude); a[6] = Math.max(a[6], t.longitude); a[7] = Math.max(a[7], t.latitude);
        bucket.set(k, a);
      }
    }
  }
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const clusters = { grids: GRIDS, sections: Object.fromEntries(Object.entries(acc).map(([section, byGrid]) => [section, Object.fromEntries(Object.entries(byGrid).map(([g, bucket]) => [g, [...bucket.values()].map((a) => [r4(a[0] / a[2]), r4(a[1] / a[2]), a[2], a[3], r4(a[4]), r4(a[5]), r4(a[6]), r4(a[7])])]))])) };
  await writeFile(path.join(output, "clusters.json.gz"), zipped(clusters));

  await writeFile(path.join(output, "manifest.json"), JSON.stringify({ ...manifest, total: rows.length, cells: [...cells.keys()], featureCells: (await readdir(path.join(source, "features")).catch(() => [] as string[])).map((f) => f.slice(2, -8)), directory: pointer.directory }));
  await writeFile(path.resolve("public/trail-data/current.json"), JSON.stringify(pointer));
  await Promise.all([
    copyFile("data/sources/trailheads-na.json.gz", path.join(output, "trailheads.json.gz")),
    copyFile("data/towns/towns.json.gz", path.join(output, "towns.json.gz")),
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
  const trailUrls = rows.filter((t) => t.kind === "segment" || t.source === "route-aggregate").map((t) => `/explore/trails/${encodeURIComponent(t.id)}`);
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
  console.log(`Prepared ${rows.length.toLocaleString("en-US")} trails in ${cells.size} cells; ${names.length} sitemap files.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
