/**
 * Measured elevation for every trail with a line: climb, descent, highest and lowest point and the steepest
 * sustained grade, sampled from AWS Terrain Tiles (Terrarium; USGS 3DEP, SRTM and other public DEMs) at zoom 12
 * (~30 m). The data build stores these on every trail, so the list, the map, page titles and the trail page all rate
 * difficulty from the same numbers (src/lib/trail-difficulty.ts).
 *
 * Each piece of a trail is sampled every 20 m (at most 4,000 points per piece); climb and descent ignore wiggles
 * under 4 m, the same rule as the trail page's chart. Results are cached by trail id and line fingerprint in
 * .cache/elevation, so a re-run only measures new or changed trails.
 *
 * Output: data/trail-catalog/<snapshot>/elevation.json.gz  { id: [gainFt, lossFt, minFt, maxFt, steepestGradePct] }
 *
 * Usage: NODE_OPTIONS=--max-old-space-size=12000 npx tsx pipeline/steps/elevation.ts
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import sharp from "sharp";
import { Route } from "../../src/lib/geo/line";
import { climb } from "../../src/lib/trip/elevation";
import { steepestGrade } from "../../src/lib/trip/grade";

type LngLat = [number, number];
type Stats = [gainFt: number, lossFt: number, minFt: number, maxFt: number, steepestGradePct: number | null];
const Z = 12;
const SPACING_M = 20;
const MAX_SAMPLES = 4000;
const CONCURRENCY = 32;
/** Geometry cells measured at once (downloads, not the CPU, are the limit). */
const CELLS_AT_ONCE = 16;
const TILE_CACHE = 4000;
const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const root = process.cwd();
const ft = (m: number) => Math.round(m * 3.28084);

/** Decoded tiles, least recently used dropped first; a tile that fails twice is remembered as missing. */
const tiles = new Map<string, Promise<Float32Array | null>>();
function tile(x: number, y: number): Promise<Float32Array | null> {
  const key = `${x}/${y}`;
  const hit = tiles.get(key);
  if (hit) { tiles.delete(key); tiles.set(key, hit); return hit; }
  const load = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${TERRARIUM}/${Z}/${key}.png`, { signal: AbortSignal.timeout(30_000) });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(String(res.status));
        const { data, info } = await sharp(Buffer.from(await res.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
        const out = new Float32Array(info.width * info.height);
        for (let i = 0; i < out.length; i++) { const o = i * info.channels; out[i] = data[o] * 256 + data[o + 1] + data[o + 2] / 256 - 32768; }
        return out;
      } catch { await new Promise((r) => setTimeout(r, 500 * (attempt + 1))); }
    }
    return null;
  })();
  tiles.set(key, load);
  if (tiles.size > TILE_CACHE) tiles.delete(tiles.keys().next().value!);
  return load;
}

function pixel([lng, lat]: LngLat) {
  const n = 2 ** Z, rad = (lat * Math.PI) / 180;
  const fx = ((lng + 180) / 360) * n, fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { fx, fy, x: Math.floor(fx), y: Math.floor(fy) };
}
function read(data: Float32Array, fx: number, fy: number, x: number, y: number) {
  const px = Math.min(254.999, Math.max(0, (fx - x) * 256 - 0.5)), py = Math.min(254.999, Math.max(0, (fy - y) * 256 - 0.5));
  const x0 = Math.floor(px), y0 = Math.floor(py), dx = px - x0, dy = py - y0, at = (cx: number, cy: number) => data[cy * 256 + cx];
  return (at(x0, y0) * (1 - dx) + at(x0 + 1, y0) * dx) * (1 - dy) + (at(x0, y0 + 1) * (1 - dx) + at(x0 + 1, y0 + 1) * dx) * dy;
}

/** Runs tasks with at most `limit` in flight. */
async function pooled<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) await run(items[next++]); }));
}

export async function measure(lines: LngLat[][]): Promise<Stats | null> {
  let gain = 0, loss = 0, min = Infinity, max = -Infinity, steepest: number | null = null;
  for (const line of lines) {
    if (line.length < 2) continue;
    const samples = new Route([line]).sample(SPACING_M, MAX_SAMPLES);
    const located = samples.map((s) => pixel(s.p));
    const keys = [...new Set(located.map((p) => `${p.x}/${p.y}`))];
    const loaded = new Map<string, Float32Array | null>();
    await Promise.all(keys.map(async (k) => { const [x, y] = k.split("/").map(Number); loaded.set(k, await tile(x, y)); }));
    const meters = located.map((p) => { const d = loaded.get(`${p.x}/${p.y}`); return d ? read(d, p.fx, p.fy, p.x, p.y) : NaN; });
    if (!meters.some(Number.isFinite)) continue;
    const c = climb(meters);
    gain += c.gain; loss += c.loss;
    for (const m of meters) if (Number.isFinite(m)) { if (m < min) min = m; if (m > max) max = m; }
    const g = steepestGrade(samples.map((s) => s.alongMeters), meters);
    if (g !== null && (steepest === null || g > steepest)) steepest = g;
  }
  return Number.isFinite(min) ? [ft(gain), ft(loss), ft(min), ft(max), steepest] : null;
}

async function main() {
  const { directory } = JSON.parse(await readFile(path.join(root, "data/trail-catalog/current.json"), "utf8")) as { directory: string };
  const dir = path.join(root, "data/trail-catalog", directory);
  const cacheFile = path.join(root, ".cache/elevation/stats.json.gz");
  await mkdir(path.dirname(cacheFile), { recursive: true });
  const cache: Record<string, [string, Stats | null]> = await readFile(cacheFile).then((b) => JSON.parse(gunzipSync(b).toString())).catch(() => ({}));
  const out: Record<string, Stats> = {};
  const files = [
    ...(await readdir(dir)).filter((f) => /^geometry-.+\.json\.gz$/.test(f)).map((f) => path.join(dir, f)),
    ...(await readdir(path.join(dir, "world")).catch(() => [] as string[])).filter((f) => /^geometry-.+\.json\.gz$/.test(f)).map((f) => path.join(dir, "world", f)),
  ].sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  // The guides' long-distance lines (curated.json.gz) are measured too.
  const curated = await readFile(path.join(dir, "curated.json.gz")).then((b) => (JSON.parse(gunzipSync(b).toString()) as { lines: Record<string, LngLat[][]> }).lines).catch(() => ({} as Record<string, LngLat[][]>));
  let done = 0, measured = 0, failed = 0;
  const started = Date.now();
  const save = () => writeFile(cacheFile, gzipSync(JSON.stringify(cache)));
  const runCell = async (lines: Record<string, LngLat[][]>) => {
    await pooled(Object.entries(lines), CONCURRENCY, async ([id, ls]) => {
      const print = createHash("sha1").update(JSON.stringify(ls)).digest("base64").slice(0, 12);
      let hit = cache[id]?.[0] === print ? cache[id][1] : undefined;
      if (hit === undefined) { hit = await measure(ls).catch(() => null); cache[id] = [print, hit]; measured++; if (!hit) failed++; }
      if (hit) out[id] = hit;
      done++;
    });
  };
  let cellsDone = 0;
  await pooled(files, CELLS_AT_ONCE, async (file) => {
    await runCell(JSON.parse(gunzipSync(await readFile(file)).toString()));
    const i = ++cellsDone;
    if (i % 100 === 0) {
      const mins = (Date.now() - started) / 60000;
      console.log(`${i}/${files.length} cells · ${done.toLocaleString("en-US")} trails (${measured.toLocaleString("en-US")} measured, ${failed} without elevation) · ${mins.toFixed(1)} min`);
      await save();
    }
  });
  await runCell(curated);
  await save();
  await writeFile(path.join(dir, "elevation.json.gz"), gzipSync(JSON.stringify(out), { level: 9 }));
  console.log(`Elevation for ${Object.keys(out).length.toLocaleString("en-US")} trails (${failed} without tiles) → elevation.json.gz`);
}

if (process.argv[1]?.endsWith("elevation.ts")) main().catch((e) => { console.error(e); process.exitCode = 1; });
