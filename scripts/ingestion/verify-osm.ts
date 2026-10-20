/** Independent check of a random sample of catalog trails against OpenStreetMap (ODbL).
 * For each sampled trail it asks: is there a mapped path where we draw the trail, does OSM give it the
 * same name, and does the same-named OSM path have a similar length?
 *
 * npm run verify:trails [-- --per 100 --seed 1 --by division|state --out report.json]
 * Overpass responses are cached in .cache/verify so reruns are fast and polite.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import type { CatalogTrail } from "../../src/lib/trail-catalog/types";
import { filterCatalog } from "../../src/lib/trail-catalog/search";
import { MILE_METERS, measureLines, type Lines } from "../../src/lib/trail-catalog/quality";
import { CENSUS_DIVISIONS, compareWithOsm, divisionOf, type OsmWay, type OsmVerdict } from "../../src/lib/trail-catalog/verify";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const PER = Number(opt("per", "100"));
const SEED = Number(opt("seed", "1"));
const BY = opt("by", "division") as "division" | "state";
const OUT = opt("out", "");
const CHUNK = 20;
const PAD_DEG = 0.004;
const root = process.cwd();
const cacheDir = path.join(root, ".cache/verify");
const ENDPOINTS = [process.env.OVERPASS_API_URL, "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"].filter((u): u is string => Boolean(u));
/** Two requests in flight at most, each worker starting from a different instance. */
const WORKERS = 2;

/** Deterministic PRNG so a rerun samples the same trails. */
function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

async function overpass(query: string, worker = 0): Promise<{ elements: { type: string; id: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; members?: { type: string; geometry?: { lat: number; lon: number }[] }[] }[] }> {
  const file = path.join(cacheDir, `${createHash("sha256").update(query).digest("hex").slice(0, 16)}.json`);
  try { return JSON.parse(await readFile(file, "utf8")); } catch { /* fetch */ }
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const endpoint of [...ENDPOINTS.slice(worker % ENDPOINTS.length), ...ENDPOINTS.slice(0, worker % ENDPOINTS.length)]) {
      try {
        const response = await fetch(endpoint, { method: "POST", body: new URLSearchParams({ data: query }), headers: { "User-Agent": "Hyked/1.0 trail verification (https://github.com/tackleguy/health)" }, signal: AbortSignal.timeout(180_000) });
        if (!response.ok) continue;
        const text = await response.text();
        if (!text.startsWith("{")) continue;
        const data = JSON.parse(text);
        if (data.remark && /runtime error|timed out/i.test(data.remark)) continue;
        await writeFile(file, text);
        return data;
      } catch { /* next endpoint */ }
    }
    await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
  }
  throw new Error("Overpass unavailable");
}

async function main() {
  await mkdir(cacheDir, { recursive: true });
  const dir = path.join(root, "data/trail-catalog", JSON.parse(await readFile(path.join(root, "data/trail-catalog/current.json"), "utf8")).directory);
  const rows = JSON.parse(gunzipSync(await readFile(path.join(dir, "index.json.gz"))).toString()) as CatalogTrail[];
  // Only what a user sees by default: hiking results, excluding flagged fragments.
  const visible = rows.filter((r) => r.country === "US" && r.kind === "segment" && filterCatalog([r], {}).total === 1);
  const groups = new Map<string, CatalogTrail[]>();
  for (const r of visible) {
    const key = BY === "state" ? r.region : divisionOf(r.region);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const random = mulberry32(SEED);
  const sample: { group: string; trail: CatalogTrail }[] = [];
  for (const [group, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const pool = [...list].sort((a, b) => a.id.localeCompare(b.id));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    for (const trail of pool.slice(0, PER)) sample.push({ group, trail });
  }
  const shards = new Map<string, Record<string, Lines>>();
  const linesOf = async (trail: CatalogTrail) => {
    if (!shards.has(trail.geometryShard)) shards.set(trail.geometryShard, JSON.parse(gunzipSync(await readFile(path.join(dir, `geometry-${trail.geometryShard}.json.gz`))).toString()));
    return shards.get(trail.geometryShard)![trail.id];
  };

  const results: (OsmVerdict & { group: string; id: string; name: string; region: string | null; miles: number | null; quality?: string })[] = [];
  const chunks: typeof sample[] = [];
  for (let i = 0; i < sample.length; i += CHUNK) chunks.push(sample.slice(i, i + CHUNK));
  let next = 0, done = 0;
  const work = async (worker: number) => {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      const withLines = await Promise.all(chunk.map(async (s) => ({ ...s, lines: await linesOf(s.trail) })));
      const boxes = withLines.map(({ lines }) => { const b = measureLines(lines).bounds!; return `(${(b[1] - PAD_DEG).toFixed(5)},${(b[0] - PAD_DEG).toFixed(5)},${(b[3] + PAD_DEG).toFixed(5)},${(b[2] + PAD_DEG).toFixed(5)})`; });
      const query = `[out:json][timeout:170];(${boxes.map((b) => `way["highway"~"^(path|footway|track|bridleway|cycleway|steps|pedestrian|living_street|service|unclassified|residential)$"]${b};way["piste:type"]${b};`).join("")});out tags geom;`;
      let data;
      try { data = await overpass(query, worker); } catch (error) { console.warn(`\nA chunk failed: ${String(error)}; skipped`); continue; }
      const ways: OsmWay[] = data.elements.filter((e) => e.type === "way" && e.geometry).map((e) => ({ id: e.id, tags: e.tags ?? {}, line: e.geometry!.map((p) => [p.lon, p.lat] as [number, number]) }));
      for (const { group, trail, lines } of withLines) {
        results.push({ group, id: trail.id, name: trail.name, region: trail.region, miles: trail.miles, quality: trail.quality, ...compareWithOsm(trail.name, trail.miles ?? measureLines(lines).meters / MILE_METERS, lines, ways) });
      }
      done += chunk.length;
      process.stdout.write(`\r${done}/${sample.length} checked`);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, (_, w) => work(w)));
  console.log();

  const verdicts = ["confirmed", "same-path-other-name", "same-path-unnamed-in-osm", "length-differs", "partly-mapped", "not-in-osm", "follows-road", "ski-piste"] as const;
  const table = [...groups.keys()].sort().map((group) => {
    const own = results.filter((r) => r.group === group);
    const row: Record<string, string | number> = { group, checked: own.length };
    for (const v of verdicts) row[v] = own.filter((r) => r.verdict === v).length;
    row["path exists %"] = own.length ? Math.round((100 * own.filter((r) => r.coverage >= 0.6).length) / own.length) : 0;
    return row;
  });
  console.table(table);
  const total: Record<string, number> = { checked: results.length };
  for (const v of verdicts) total[v] = results.filter((r) => r.verdict === v).length;
  total["path exists %"] = Math.round((100 * results.filter((r) => r.coverage >= 0.6).length) / Math.max(1, results.length));
  total["name agrees % (where OSM names it)"] = Math.round((100 * results.filter((r) => r.nameAgrees).length) / Math.max(1, results.filter((r) => r.osmName !== null).length));
  total["length within 0.67–1.5× % (where compared)"] = Math.round((100 * results.filter((r) => r.lengthRatio !== null && r.lengthRatio >= 0.67 && r.lengthRatio <= 1.5).length) / Math.max(1, results.filter((r) => r.lengthRatio !== null).length));
  console.log(total);
  if (OUT) await writeFile(OUT, JSON.stringify({ snapshot: path.basename(dir), seed: SEED, per: PER, by: BY, divisions: BY === "division" ? CENSUS_DIVISIONS : undefined, table, total, results }, null, 1));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
