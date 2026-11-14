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
import { createReadStream } from "node:fs";
import { appendFile, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createGunzip, gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildThroughHikeOverlay, THROUGH_HIKE_PATTERNS } from "../src/lib/trail-catalog/through-hikes";
import { buildResortOverlay, type ResortTrailSource } from "../src/lib/trail-catalog/resorts";
import { normalizeSeason, titleCaseName } from "../src/lib/trail-catalog/agencies";
import { computeDifficulty, effortClimbFt } from "../src/lib/trail-difficulty";
import { cleanTrailName, dedupeKey, isJunkName, isJunkSegment, overlapShareFlat, packLinesFlat, routeTypeFromLines } from "../src/lib/trail-catalog/cleanup";
import { sectionOf, trailActivities } from "../src/lib/trail-catalog/activity";
import { countryName, type CatalogTrail } from "../src/lib/trail-catalog/types";
import { pinCell, regionSlug, rowShard, searchKey, SEARCH_STOPWORDS } from "../src/lib/trail-catalog/static-data";
import { normalizeText } from "../src/lib/trail-catalog/fuzzy";

process.env.UV_THREADPOOL_SIZE ??= "8";
const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);

const SITE = (process.env.SITE_URL ?? process.env.VITE_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://hyked.lovable.app").replace(/\/+$/, "");
const GRIDS = [8, 4, 2, 1, 0.5, 0.25];
const SITEMAP_URLS = 45_000;
/** Trails in each region or country search file. */
const REGION_TOP = 1500;
const IO_CONCURRENCY = 24;
const ZLIB_CONCURRENCY = 4;
const GEO_CONCURRENCY = 4;
const BUCKETS = 32;
const FLUSH_BYTES = 16 * 1024 * 1024;

const shown = (t: CatalogTrail) => !t.mergedInto && t.confidence !== "REJECTED" && t.quality !== "fragment";
const zipped = (value: unknown) => gzipAsync(JSON.stringify(value), { level: 1 });
const zippedText = (text: string) => gzipAsync(text, { level: 1 });
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** With TRAIL_MEM_DEBUG=1, logs memory at each phase (rss, heap, ArrayBuffers/Buffers outside the heap). */
const memProbe = (label: string) => {
  if (process.env.TRAIL_MEM_DEBUG !== "1") return;
  const m = process.memoryUsage(), mb = (n: number) => Math.round(n / 1e6);
  console.log(`[mem] ${label}: rss ${mb(m.rss)} heap ${mb(m.heapUsed)} external ${mb(m.external)} arrayBuffers ${mb(m.arrayBuffers)}`);
};

/** Stream-gunzips a top-level JSON array of objects while verifying its compressed SHA-256. */
async function streamGzipJsonArray<T>(filePath: string, expectedSha256: string, onItem: (item: T) => void): Promise<void> {
  const hash = createHash("sha256");
  const gunzipStream = createGunzip();
  gunzipStream.setEncoding("utf8");
  const fileStream = createReadStream(filePath);
  fileStream.on("data", (chunk: Buffer | string) => hash.update(chunk));

  let depth = 0;
  let inString = false;
  let escaped = false;
  let carry = "";

  await new Promise<void>((resolve, reject) => {
    fileStream.on("error", reject);
    gunzipStream.on("error", reject);
    gunzipStream.on("data", (chunk: string) => {
      try {
        let objStart = depth > 0 ? 0 : -1;
        for (let i = 0; i < chunk.length; i++) {
          const code = chunk.charCodeAt(i);
          if (inString) {
            if (escaped) escaped = false;
            else if (code === 92) escaped = true;
            else if (code === 34) inString = false;
          } else if (code === 34) {
            inString = true;
          } else if (code === 123) {
            if (depth === 0) objStart = i;
            depth++;
          } else if (code === 125) {
            depth--;
            if (depth === 0) {
              const json = carry ? carry + chunk.slice(objStart, i + 1) : chunk.slice(objStart, i + 1);
              carry = "";
              objStart = -1;
              onItem(JSON.parse(json) as T);
            }
          }
        }
        if (depth > 0 && objStart >= 0) carry += chunk.slice(objStart);
      } catch (err) {
        reject(err);
      }
    });
    gunzipStream.on("end", () => {
      if (depth !== 0 || carry.length > 0) reject(new Error("Truncated JSON stream"));
      else resolve();
    });
    fileStream.pipe(gunzipStream);
  });

  if (hash.digest("hex") !== expectedSha256) throw new Error("Trail checksum mismatch");
}

async function mapPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

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

const bucketOf = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h & (BUCKETS - 1);
};

async function isAlreadyPrepared(directory: string, includeWorld: boolean): Promise<boolean> {
  try {
    const outRoot = path.resolve("public/trail-data");
    const cur = JSON.parse(await readFile(path.join(outRoot, "current.json"), "utf8")) as { directory?: string };
    if (cur.directory !== directory) return false;
    const built = JSON.parse(await readFile(path.join(outRoot, directory, "manifest.json"), "utf8")) as {
      total?: number;
      searchCountries?: string[];
      cells?: string[];
    };
    await stat(path.join(outRoot, directory, "clusters.json.gz"));
    await stat(path.join(outRoot, directory, "overview.json.gz"));
    const hasFullWorld = (built.searchCountries?.length ?? 0) > 2;
    return Boolean(built.total && built.cells?.length) && hasFullWorld === includeWorld;
  } catch {
    return false;
  }
}

async function ensureSeoRootFiles() {
  const sitemapsDir = path.resolve("public/sitemaps");
  const files = (await readdir(sitemapsDir).catch(() => [] as string[])).filter((f) => f.endsWith(".xml")).sort((a, b) => (a === "pages.xml" ? -1 : b === "pages.xml" ? 1 : a.localeCompare(b, undefined, { numeric: true })));
  if (files.length && !(await stat(path.resolve("public/sitemap.xml")).catch(() => null))) {
    const today = new Date().toISOString().slice(0, 10);
    await writeFile(path.resolve("public/sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files.map((n) => `<sitemap><loc>${SITE}/sitemaps/${n}</loc><lastmod>${today}</lastmod></sitemap>`).join("\n")}\n</sitemapindex>\n`);
  }
  if (!(await stat(path.resolve("public/robots.txt")).catch(() => null))) {
    await writeFile(path.resolve("public/robots.txt"), `User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${SITE}/sitemap.xml\n`);
  }
}

async function main() {
  const root = path.resolve("data/trail-catalog");
  const pointer = JSON.parse(await readFile(path.join(root, "current.json"), "utf8"));
  if (!/^snapshot-\d+$/.test(pointer.directory)) throw new Error("Invalid trail snapshot");
  const source = path.join(root, pointer.directory);
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  const allWorldFiles = (manifest.world?.files ?? {}) as Record<string, { rows: number; sha256: string }>;
  const hasWorldDir = Object.keys(allWorldFiles).length > 0;
  // Worldwide trails (232 countries, ~1.18M trails in all) are built by default: read one country at a time (big ones
  // alone), they take about two minutes and peak at the same memory as the U.S./Canada-only build (~1.9 GB RSS with
  // --max-old-space-size=1280). Set TRAIL_WORLD=0 to build U.S. (including AK/HI), Canada and curated routes only.
  const includeWorld = hasWorldDir && process.env.TRAIL_WORLD !== "0";

  if (process.argv.includes("--if-ready") && process.env.FORCE_TRAIL_PREP !== "1" && (await isAlreadyPrepared(pointer.directory, includeWorld))) {
    await ensureSeoRootFiles();
    return;
  }

  const resortSources: ResortTrailSource[] = JSON.parse(await readFile(path.join(root, "resort-trails.json"), "utf8")).resorts;
  const shownSections: CatalogTrail[] = [];
  const overlayStubs: CatalogTrail[] = [];
  const redirects: Record<string, string> = {};

  await streamGzipJsonArray<CatalogTrail>(path.join(source, "index.json.gz"), manifest.indexSha256, (row) => {
    row.name = titleCaseName(row.name);
    row.season = normalizeSeason(row.season);
    if (row.mergedInto) redirects[row.id] = row.mergedInto;
    if (shown(row)) {
      shownSections.push(row);
      return;
    }
    const matchesThruHike = row.kind !== "route" && THROUGH_HIKE_PATTERNS.some((p) => p.country === row.country && p.match.test(row.name));
    const nearResort = row.country === "US" && resortSources.some((rs) => Math.abs(rs.baseLatitude - row.latitude) <= 0.15 && Math.abs(rs.baseLongitude - row.longitude) <= 0.2);
    if (matchesThruHike || nearResort) {
      overlayStubs.push({
        id: row.id,
        name: row.name,
        country: row.country,
        region: null,
        kind: row.kind,
        miles: row.miles,
        distanceBasis: row.distanceBasis,
        latitude: row.latitude,
        longitude: row.longitude,
        difficulty: null,
        dogs: null,
        source: row.source,
        sourceId: row.sourceId,
        sourceUrl: "",
        officialUrl: null,
        sourceDate: null,
        manager: null,
        surface: null,
        season: null,
        geometryShard: row.geometryShard,
        sectionCount: row.sectionCount,
      });
    }
  });

  const allForOverlay = [...shownSections, ...overlayStubs];
  const routes = buildThroughHikeOverlay(allForOverlay);
  const resorts = buildResortOverlay(resortSources, allForOverlay);
  allForOverlay.length = 0;
  overlayStubs.length = 0;
  const rows = [...shownSections, ...routes, ...resorts];
  shownSections.length = 0;

  await rm(path.resolve("public/trail-data"), { recursive: true, force: true });
  const output = path.resolve("public/trail-data", pointer.directory);
  const tmpDir = path.join(output, ".tmp-buckets");
  await mkdir(path.join(output, "q"), { recursive: true });
  await mkdir(path.join(output, "rows"), { recursive: true });
  await mkdir(tmpDir, { recursive: true });

  // Stream full records and search entries into 32 disk buckets so peak V8 heap stays bounded.
  const rowBufs: string[][] = Array.from({ length: BUCKETS }, () => []);
  const qBufs: string[][] = Array.from({ length: BUCKETS }, () => []);
  let rowBufBytes = 0, qBufBytes = 0;

  const flushRows = async () => {
    if (!rowBufBytes) return;
    const tasks: Promise<void>[] = [];
    for (let b = 0; b < BUCKETS; b++) {
      if (!rowBufs[b].length) continue;
      const chunk = rowBufs[b].join("");
      rowBufs[b] = [];
      tasks.push(appendFile(path.join(tmpDir, `rows-${b}.ndjson`), chunk));
    }
    rowBufBytes = 0;
    await Promise.all(tasks);
  };
  const flushQ = async () => {
    if (!qBufBytes) return;
    const tasks: Promise<void>[] = [];
    for (let b = 0; b < BUCKETS; b++) {
      if (!qBufs[b].length) continue;
      const chunk = qBufs[b].join("");
      qBufs[b] = [];
      tasks.push(appendFile(path.join(tmpDir, `q-${b}.ndjson`), chunk));
    }
    qBufBytes = 0;
    await Promise.all(tasks);
  };

  const setRecord = (id: string, json: string) => {
    const k = rowShard(id);
    const line = `${k}\t${JSON.stringify(id)}:${json}\n`;
    rowBufs[parseInt(k, 16) & (BUCKETS - 1)].push(line);
    rowBufBytes += line.length;
  };

  const tops = new Map<string, [number, string][]>();
  const addTop = (file: string, score: number, json: string) => {
    const list = tops.get(file) ?? tops.set(file, []).get(file)!;
    list.push([score, json]);
    if (list.length > REGION_TOP * 3) tops.set(file, list.sort((a, b) => b[0] - a[0]).slice(0, REGION_TOP));
  };

  const shippedCountries: Record<string, number> = {};
  let shippedVerified = 0, shippedMapped = 0;

  const index = (t: CatalogTrail) => {
    setRecord(t.id, JSON.stringify(t));
    const entry = searchRow(t);
    const json = JSON.stringify(entry);
    for (const key of searchKeysOf(t)) {
      const line = `${key}\t${json}\n`;
      qBufs[bucketOf(key)].push(line);
      qBufBytes += line.length;
    }
    if (t.region) addTop(`r-${regionSlug(normalizeText(t.region))}`, entry[4], json);
    addTop(`c-${t.country}`, entry[4], json);
    shippedCountries[t.country] = (shippedCountries[t.country] ?? 0) + 1;
    if (t.tier === "verified") shippedVerified++;
    else if (t.tier === "mapped") shippedMapped++;
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

  // Clean names up front so near-duplicate candidate groups are known before the single geometry pass.
  const tally = { renamed: 0, review: 0, routeTypes: 0, dropped: 0, merged: 0 };
  const cleanNamesOn = (list: CatalogTrail[]) => {
    for (const t of list) {
      const { name, needsReview } = cleanTrailName(t.name);
      if (name !== t.name) { t.name = name; tally.renamed++; }
      if (t.sections) for (const sec of t.sections) sec.name = cleanTrailName(sec.name).name;
      if (t.partOfRoute) t.partOfRoute = { ...t.partOfRoute, name: cleanTrailName(t.partOfRoute.name).name };
      if (needsReview) { t.quality = "review"; t.flags = [...new Set([...(t.flags ?? []), "needs-review" as const])]; tally.review++; }
    }
  };
  cleanNamesOn(rows);

  const preGroups = new Map<string, string[]>();
  for (const t of rows) {
    if (t.kind !== "segment" || t.partOfRoute || isJunkName(t.name)) continue;
    const key = dedupeKey(t);
    if (key) {
      const gk = `${t.country}|${key}`;
      let g = preGroups.get(gk);
      if (!g) { g = []; preGroups.set(gk, g); }
      g.push(t.id);
    }
  }
  const candidateIds = new Set<string>();
  for (const ids of preGroups.values()) {
    if (ids.length >= 2 && ids.length <= 60) for (const id of ids) candidateIds.add(id);
  }
  preGroups.clear();

  memProbe("after index read");
  // Lines of shown U.S./Canada trails, plus Alaska/Hawaii (always) and all world shards (unless TRAIL_WORLD=0).
  const wanted = new Map<string, Set<string>>();
  for (const t of rows) if (t.geometryShard !== "route" && t.source !== "resort") (wanted.get(t.geometryShard) ?? wanted.set(t.geometryShard, new Set()).get(t.geometryShard)!).add(t.id);

  const worldEntries = includeWorld
    ? Object.entries(allWorldFiles)
    : Object.entries(allWorldFiles).filter(([code]) => code === "US-AK" || code === "US-HI");

  const existingWorldGeom = new Set((await readdir(path.join(source, "world")).catch(() => [] as string[])).filter((f) => /^geometry-.+\.json\.gz$/.test(f)));
  const worldWantedIds = new Set<string>();
  let worldGeometry: Set<string>;
  if (includeWorld) {
    worldGeometry = existingWorldGeom;
  } else {
    worldGeometry = new Set<string>();
    for (const [code] of worldEntries) {
      const buf = await readFile(path.join(source, "world", `index-${code}.json.gz`)).catch(() => null);
      if (!buf) continue;
      const parsed = JSON.parse((await gunzipAsync(buf)).toString()) as { rows?: CatalogTrail[] };
      for (const r of parsed.rows ?? []) {
        worldWantedIds.add(r.id);
        const fname = `geometry-${r.geometryShard}.json.gz`;
        if (existingWorldGeom.has(fname)) worldGeometry.add(fname);
      }
    }
  }
  existingWorldGeom.clear();

  const boundsById = new Map<string, [number, number, number, number]>();
  const routeTypeById = new Map<string, CatalogTrail["routeType"]>();
  const flatById = new Map<string, Float64Array>();
  const geometryCells = [...new Set([...wanted.keys(), ...[...worldGeometry].map((f) => f.slice(9, -8))])];

  await mapPool(geometryCells, GEO_CONCURRENCY, async (shard) => {
    const ids = wanted.get(shard);
    const hasWorldShard = worldGeometry.has(`geometry-${shard}.json.gz`);
    if (!ids && hasWorldShard) {
      await copyFile(path.join(source, "world", `geometry-${shard}.json.gz`), path.join(output, `geometry-${shard}.json.gz`));
      return;
    }
    if (!ids) return;
    let rawObj: Record<string, [number, number][][]> | null = null;
    try {
      rawObj = JSON.parse((await gunzipAsync(await readFile(path.join(source, `geometry-${shard}.json.gz`)))).toString()) as Record<string, [number, number][][]>;
    } catch {
      rawObj = null;
    }
    const data: Record<string, [number, number][][]> = {};
    let rawCount = 0, keptCount = 0;
    if (rawObj) {
      for (const [id, lines] of Object.entries(rawObj)) {
        rawCount++;
        if (!ids.has(id)) continue;
        data[id] = lines;
        keptCount++;
        boundsById.set(id, extent(lines));
        routeTypeById.set(id, routeTypeFromLines(lines));
        if (candidateIds.has(id)) flatById.set(id, packLinesFlat(lines));
      }
    }
    if (hasWorldShard) {
      const worldObj = JSON.parse((await gunzipAsync(await readFile(path.join(source, "world", `geometry-${shard}.json.gz`)))).toString()) as Record<string, [number, number][][]>;
      Object.assign(data, worldObj);
      await writeFile(path.join(output, `geometry-${shard}.json.gz`), await zipped(data));
    } else if (keptCount > 0 && keptCount === rawCount) {
      await copyFile(path.join(source, `geometry-${shard}.json.gz`), path.join(output, `geometry-${shard}.json.gz`));
    } else if (keptCount > 0) {
      await writeFile(path.join(output, `geometry-${shard}.json.gz`), await zipped(data));
    }
  });
  wanted.clear();
  candidateIds.clear();

  for (const t of rows) {
    const type = t.kind === "segment" ? routeTypeById.get(t.id) : undefined;
    if (type && type !== t.routeType) { t.routeType = type; tally.routeTypes++; }
    t.bounds = boundsById.get(t.id) ?? t.bounds;
  }
  boundsById.clear();
  routeTypeById.clear();

  const naRows = rows.filter((t) => !isJunkSegment(t));
  tally.dropped += rows.length - naRows.length;
  rows.length = 0;

  // Deduplicate overlapping same-name trails using compact Float64Arrays captured during the single geometry pass.
  const overlaps = (a: [number, number, number, number], b: [number, number, number, number]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  const groups = new Map<string, CatalogTrail[]>();
  for (const t of naRows) {
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
      const a = flatById.get(short.id), b = flatById.get(long.id);
      if (!a || !b || overlapShareFlat(a, b) <= 0.6) continue;
      short.partOfRoute = { id: long.id, name: long.name, totalMiles: long.miles ?? 0 };
      if ((long.sections?.length ?? 0) < 120) long.sections = [...(long.sections ?? []), { id: short.id, name: short.name, miles: short.miles ?? 0, difficulty: short.difficulty ?? null }];
      tally.merged++;
    }
  }
  groups.clear();
  memProbe("before geometry clear");
  flatById.clear();

  // Load measured elevation only after sections and geometry maps are freed so peak heap stays well under 1 GB.
  let elevation: Record<string, [number, number, number, number, number | null]> = await readFile(path.join(source, "elevation.json.gz")).then(async (b) => JSON.parse((await gunzipAsync(b)).toString())).catch(() => ({}));
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
  const ratedById = new Map<string, CatalogTrail["difficulty"]>();
  for (const t of naRows) {
    rate(t);
    ratedById.set(t.id, t.difficulty);
  }
  for (const t of naRows) {
    if (t.sections) for (const sec of t.sections) sec.difficulty = ratedById.get(sec.id) ?? sec.difficulty ?? null;
  }
  ratedById.clear();
  if (!worldEntries.length) {
    elevation = {};
  } else if (!includeWorld) {
    const keptElevation: typeof elevation = {};
    for (const id of worldWantedIds) {
      if (elevation[id]) keptElevation[id] = elevation[id];
    }
    elevation = keptElevation;
  }
  worldWantedIds.clear();

  memProbe("after geometry");
  // ---- U.S. and Canada: index full records first, then slim in-place and write 2° cells ----
  for (const t of naRows) {
    index(t);
    count(t);
    pageOf(t);
    if (rowBufBytes >= FLUSH_BYTES) await flushRows();
    if (qBufBytes >= FLUSH_BYTES) await flushQ();
  }
  const naRowCount = naRows.length;
  for (const [from, to] of Object.entries(redirects)) setRecord(from, JSON.stringify(`r:${to}`));
  await flushRows();
  await flushQ();

  const cells = new Map<string, CatalogTrail[]>();
  for (let i = 0; i < naRows.length; i++) {
    const slimmed = slim(naRows[i]);
    naRows[i] = slimmed;
    for (const key of cellKeysOf(slimmed)) (cells.get(key) ?? cells.set(key, []).get(key)!).push(slimmed);
  }
  naRows.length = 0;
  const naCellKeys = [...cells.keys()];
  await mapPool(naCellKeys, ZLIB_CONCURRENCY, async (key) => {
    const trails = cells.get(key)!;
    cells.delete(key);
    await writeFile(path.join(output, `cell-${key}.json.gz`), await zipped(trails));
  });
  cells.clear();

  memProbe("after NA cells");
  // ---- Alaska/Hawaii (always) + worldwide countries (unless TRAIL_WORLD=0): small countries two at a time, big ones
  // (Germany's index is 135 MB of JSON) on their own, so two large countries are never in memory together. ----
  const worldCells: Record<string, string[]> = {};
  const countriesWithTrails: string[] = [];
  let worldRows = 0;
  const BIG_COUNTRY_ROWS = 15_000;
  const worldBatches: (typeof worldEntries)[] = [];
  for (const entry of worldEntries) {
    const last = worldBatches[worldBatches.length - 1];
    if (entry[1].rows < BIG_COUNTRY_ROWS && last && last.length === 1 && last[0][1].rows < BIG_COUNTRY_ROWS) last.push(entry);
    else worldBatches.push([entry]);
  }
  for (const batch of worldBatches) {
    const loaded = await Promise.all(batch.map(async ([code, info]) => {
      const buf = await readFile(path.join(source, "world", `index-${code}.json.gz`));
      if (sha(buf) !== info.sha256) throw new Error(`Trail checksum mismatch (${code})`);
      const data = JSON.parse((await gunzipAsync(buf)).toString()) as { rows: CatalogTrail[]; redirects: Record<string, string> };
      for (const t of data.rows) t.name = titleCaseName(t.name);
      cleanNamesOn(data.rows);
      for (const t of data.rows) rate(t);
      const before = data.rows.length;
      data.rows = data.rows.filter((t) => !isJunkSegment(t));
      tally.dropped += before - data.rows.length;
      return { code, data };
    }));
    const cellWrites: [string, CatalogTrail[]][] = [];
    for (const { code, data } of loaded) {
      const byCell = new Map<string, CatalogTrail[]>();
      for (const t of data.rows) {
        for (const k of cellKeysOf(t)) (byCell.get(k) ?? byCell.set(k, []).get(k)!).push(t);
        index(t);
        count(t);
        pageOf(t);
      }
      for (const [from, to] of Object.entries(data.redirects)) setRecord(from, JSON.stringify(`r:${to}`));
      for (const [key, trails] of byCell) {
        cellWrites.push([`cell-${key}-${code}.json.gz`, trails]);
        (worldCells[key] ??= []).push(code);
      }
      if (data.rows.length > 0) {
        for (const cc of new Set(data.rows.map((r) => r.country))) countriesWithTrails.push(cc);
      }
      worldRows += data.rows.length;
    }
    await mapPool(cellWrites, ZLIB_CONCURRENCY, async ([file, trails]) => {
      await writeFile(path.join(output, file), await zipped(trails.map(slim)));
    });
    if (rowBufBytes >= FLUSH_BYTES) await flushRows();
    if (qBufBytes >= FLUSH_BYTES) await flushQ();
  }
  elevation = {};
  await flushRows();
  await flushQ();
  memProbe("after world");
  // ---- indexes (written one disk bucket at a time so heap stays small) ----
  const writeText = async (file: string, text: string) => writeFile(path.join(output, file), await zippedText(text));
  for (let b = 0; b < BUCKETS; b++) {
    const rawBucket = await readFile(path.join(tmpDir, `q-${b}.ndjson`), "utf8").catch(() => "");
    if (!rawBucket) continue;
    const byKey = new Map<string, string[]>();
    let start = 0;
    while (start < rawBucket.length) {
      const nl = rawBucket.indexOf("\n", start);
      const end = nl === -1 ? rawBucket.length : nl;
      const tab = rawBucket.indexOf("\t", start);
      if (tab !== -1 && tab < end) {
        const key = rawBucket.slice(start, tab);
        const json = rawBucket.slice(tab + 1, end);
        let arr = byKey.get(key);
        if (!arr) { arr = []; byKey.set(key, arr); }
        arr.push(json);
      }
      start = end + 1;
    }
    await mapPool([...byKey.entries()], IO_CONCURRENCY, async ([key, entries]) => {
      await writeText(`q/${key}.json.gz`, `[${entries.join(",")}]`);
    });
  }
  const searchRegions: string[] = [];
  await mapPool([...tops.entries()], IO_CONCURRENCY, async ([file, list]) => {
    await writeText(`q/${file}.json.gz`, `[${list.sort((a, b) => b[0] - a[0]).slice(0, REGION_TOP).map((x) => x[1]).join(",")}]`);
    if (file.startsWith("r-")) searchRegions.push(file.slice(2));
  });
  tops.clear();

  for (let b = 0; b < BUCKETS; b++) {
    const rawBucket = await readFile(path.join(tmpDir, `rows-${b}.ndjson`), "utf8").catch(() => "");
    if (!rawBucket) continue;
    const byShard = new Map<string, string[]>();
    let start = 0;
    while (start < rawBucket.length) {
      const nl = rawBucket.indexOf("\n", start);
      const end = nl === -1 ? rawBucket.length : nl;
      const tab = rawBucket.indexOf("\t", start);
      if (tab !== -1 && tab < end) {
        const shard = rawBucket.slice(start, tab);
        const kv = rawBucket.slice(tab + 1, end);
        let arr = byShard.get(shard);
        if (!arr) { arr = []; byShard.set(shard, arr); }
        arr.push(kv);
      }
      start = end + 1;
    }
    await mapPool([...byShard.entries()], IO_CONCURRENCY, async ([k, part]) => {
      await writeText(`rows/r-${k}.json.gz`, `{${part.join(",")}}`);
    });
  }
  await rm(tmpDir, { recursive: true, force: true });

  await writeFile(path.join(output, "redirects.json.gz"), await zipped(redirects));
  await writeFile(path.join(output, "overview.json.gz"), await zipped(routes));

  // Count bubbles: per section and grid size, [meanLng, meanLat, count, verified, west, south, east, north].
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
  const clusters = { grids: GRIDS, sections: Object.fromEntries(Object.entries(acc).map(([section, byGrid]) => [section, Object.fromEntries(Object.entries(byGrid).map(([g, bucket]) => [g, [...bucket.values()].map((a) => [r4(a[0] / a[2]), r4(a[1] / a[2]), a[2], a[3], r4(a[4]), r4(a[5]), r4(a[6]), r4(a[7])])]))])) };
  await writeFile(path.join(output, "clusters.json.gz"), await zipped(clusters));

  const totalShipped = naRowCount + worldRows;
  const sources = includeWorld
    ? manifest.sources
    : (manifest.sources ?? []).filter((s: { key?: string }) => !["osm-world", "wikidata-world", "natural-earth"].includes(s.key ?? ""));
  const notes = includeWorld
    ? manifest.notes
    : (manifest.notes ?? []).filter((n: string) => !/^Worldwide:/.test(n));

  await writeFile(path.join(output, "manifest.json"), JSON.stringify({
    ...manifest,
    world: undefined,
    total: totalShipped,
    publicTotal: totalShipped,
    countries: shippedCountries,
    ...(manifest.tiers ? { tiers: { verified: shippedVerified, mapped: shippedMapped } } : {}),
    sources,
    notes,
    cells: naCellKeys,
    worldCells,
    searchRegions,
    searchCountries: [...new Set(["US", "CA", ...countriesWithTrails])],
    rowShards: true,
    searchFiles: true,
    featureCells: (await readdir(path.join(source, "features")).catch(() => [] as string[])).map((f) => f.slice(2, -8)),
    directory: pointer.directory,
  }));
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
    await mapPool(featureFiles, IO_CONCURRENCY, (f) => copyFile(path.join(source, "features", f), path.join(output, "features", f)));
  }
  // Write current.json only after every snapshot file (including features, trailheads, towns, clusters) is in place.
  await writeFile(path.resolve("public/trail-data/current.json"), JSON.stringify(pointer));

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
  console.log(`Prepared ${totalShipped.toLocaleString("en-US")} trails (${worldRows.toLocaleString("en-US")} worldwide in ${new Set(countriesWithTrails).size} countries) in ${naCellKeys.length} + ${Object.values(worldCells).flat().length} cell files; ${names.length} sitemap files; peak RSS ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB.`);
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
