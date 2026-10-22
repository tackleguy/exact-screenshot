/**
 * Hike-feature layer: water sources, campsites, shelters and huts, trailheads and parking, toilets, viewpoints,
 * peaks and passes, bridges, fords, stream crossings, picnic sites, ranger stations and waterfalls from the
 * OpenStreetMap feature pass (`.cache/osm-features/<region>.json.gz`, written by extract-osm.py).
 *
 * Every feature is placed on the trails it sits on or near, with its mile marker along each of them, measured the
 * same way trail pages measure (pieces ordered with chainLines). Features near no shown trail are dropped.
 *
 * Worldwide trails (world.ts) get the same pass from `.cache/world-features/<country>.json.gz` (extract-world.py),
 * one country at a time, against the lines in the snapshot's `world/geometry-<cell>.json.gz` near its features.
 *
 * Output, in the current snapshot:
 *   features/f-<cell>.json.gz   rows [id, type, name, lon, lat, extra, [[trailId, mile, offTrailMeters], ...]]
 *   features-report.json        counts by type
 *
 * Usage: npx tsx pipeline/steps/features.ts
 */
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";
import type { CatalogTrail } from "../../src/lib/trail-catalog/types";
import { geometryCell } from "../../src/lib/trail-catalog/cells";
import { chainLines, MILE_METERS } from "../../src/lib/geo/line";
import { FEATURE_TYPES, type FeatureType } from "../../src/lib/trail-catalog/features";

type LngLat = [number, number];
type Raw = [FeatureType, string, number, number, Record<string, unknown>];

const root = process.cwd();
const catalogRoot = path.join(root, "data/trail-catalog");
const GRID = 0.01;
const MAX_TRAILS_PER_FEATURE = 12;
/** How far from a trail line a feature may be to count as on or near it, in metres. */
const RADIUS: Partial<Record<FeatureType, number>> = { crossing: 40, bridge: 40, ford: 60, lake: 200, river: 200 };
const DEFAULT_RADIUS = 300;
const MAX_RADIUS = 300;

const gz = async <T,>(file: string): Promise<T> => JSON.parse(gunzipSync(await readFile(file)).toString()) as T;
const key = (x: number, y: number) => (x + 20000) * 40000 + (y + 20000);

function idOf(type: string, lon: number, lat: number) {
  let h = 0x811c9dc5;
  for (const ch of `${type}:${lon.toFixed(5)}:${lat.toFixed(5)}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return `f${h.toString(36)}`;
}

interface Placed { cells: Map<string, unknown[]>; byType: Record<string, number>; kept: number; links: number }

/**
 * Places features on the trails `walk` hands to `place` (each line walked in page order, nearest point kept per
 * trail), and returns the rows of features on or near at least one trail, by 1° cell.
 */
async function placeFeatures(features: Raw[], walk: (place: (id: string, lines: LngLat[][]) => void) => Promise<void>): Promise<Placed> {
  const grid = new Map<number, number[]>();
  features.forEach((f, i) => {
    const k = key(Math.floor(f[2] / GRID), Math.floor(f[3] / GRID));
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const on: Map<string, [number, number]>[] = features.map(() => new Map());
  const place = (id: string, lines: LngLat[][]) => {
    let along = 0;
    for (const line of chainLines(lines)) {
      for (let s = 1; s < line.length; s++) {
        const a = line[s - 1], b = line[s];
        const kx = Math.cos((a[1] * Math.PI) / 180) * 111_320, ky = 110_540;
        const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
        const len = Math.hypot(dx, dy);
        const pad = MAX_RADIUS / 111_000 * 1.6;
        const x0 = Math.floor((Math.min(a[0], b[0]) - pad) / GRID), x1 = Math.floor((Math.max(a[0], b[0]) + pad) / GRID);
        const y0 = Math.floor((Math.min(a[1], b[1]) - pad) / GRID), y1 = Math.floor((Math.max(a[1], b[1]) + pad) / GRID);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const cell = grid.get(key(x, y));
          if (!cell) continue;
          for (const i of cell) {
            const f = features[i];
            const px = (f[2] - a[0]) * kx, py = (f[3] - a[1]) * ky;
            const t = len ? Math.max(0, Math.min(1, (px * dx + py * dy) / (len * len))) : 0;
            const off = Math.hypot(px - t * dx, py - t * dy);
            if (off > (RADIUS[f[0]] ?? DEFAULT_RADIUS)) continue;
            const prev = on[i].get(id);
            if (!prev || off < prev[1]) on[i].set(id, [(along + t * len) / MILE_METERS, off]);
          }
        }
        along += len;
      }
    }
  };
  await walk(place);
  const out: Placed = { cells: new Map(), byType: {}, kept: 0, links: 0 };
  features.forEach((f, i) => {
    if (!on[i].size) return;
    const near = [...on[i]].sort((a, b) => a[1][1] - b[1][1]).slice(0, MAX_TRAILS_PER_FEATURE).map(([id, [mile, off]]) => [id, Math.round(mile * 100) / 100, Math.round(off)]);
    const extra = Object.keys(f[4] ?? {}).length ? f[4] : 0;
    const row = [idOf(f[0], f[2], f[3]), f[0], f[1], f[2], f[3], extra, near];
    const cell = geometryCell(f[2], f[3]);
    (out.cells.get(cell) ?? out.cells.set(cell, []).get(cell)!).push(row);
    out.byType[f[0]] = (out.byType[f[0]] ?? 0) + 1;
    out.kept++;
    out.links += near.length;
  });
  return out;
}

async function main() {
  const { directory } = JSON.parse(await readFile(path.join(catalogRoot, "current.json"), "utf8")) as { directory: string };
  const dir = path.join(catalogRoot, directory);

  // 1. Features from every U.S./Canada region, deduplicated where extracts overlap at borders.
  const cacheDir = path.join(root, ".cache/osm-features");
  const files = (await readdir(cacheDir)).filter((f) => f.endsWith(".json.gz"));
  const features: Raw[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const row of (await gz<{ features: Raw[] }>(path.join(cacheDir, file))).features) {
      if (!FEATURE_TYPES.includes(row[0])) continue;
      const k = `${row[0]}|${row[1]}|${row[2].toFixed(4)}|${row[3].toFixed(4)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      features.push(row);
    }
  }
  seen.clear();
  console.log(`${features.length.toLocaleString("en-US")} features from ${files.length} regions`);

  // 2. Walk every shown trail's line in page order and record the nearest point to each nearby feature.
  const index = await gz<CatalogTrail[]>(path.join(dir, "index.json.gz"));
  const shown = new Set(index.filter((r) => r.tier && !r.mergedInto && r.confidence !== "REJECTED" && r.quality !== "fragment").map((r) => r.id));
  const curated = await gz<{ lines: Record<string, LngLat[][]> }>(path.join(dir, "curated.json.gz"));
  let placed = 0;
  // 3. Rows of features that are on or near at least one trail, by 1° cell.
  const { cells, byType } = await placeFeatures(features, async (place) => {
    for (const file of (await readdir(dir)).filter((f) => /^geometry-.+\.json\.gz$/.test(f))) {
      for (const [id, lines] of Object.entries(await gz<Record<string, LngLat[][]>>(path.join(dir, file)))) {
        if (!shown.has(id)) continue;
        place(id, lines);
        placed++;
      }
    }
    // Curated guide sections and peak routes have their own lines; their pages measure along those.
    for (const [id, lines] of Object.entries(curated.lines)) place(id, lines);
  });
  let kept = [...cells.values()].reduce((n, rows) => n + rows.length, 0);
  let links = [...cells.values()].reduce((n, rows) => n + rows.reduce((m: number, r) => m + (r as unknown[][])[6].length, 0), 0);
  console.log(`placed along ${placed.toLocaleString("en-US")} trails and ${Object.keys(curated.lines).length} guide lines`);

  // 4. Worldwide: each country's features against the worldwide lines of the cells they fall in.
  const stage = path.join(root, ".cache/world-features-stage");
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const staged = new Set<string>();
  const worldDir = path.join(root, ".cache/world-features");
  const worldGeometry = new Set((await readdir(path.join(dir, "world")).catch(() => [] as string[])).filter((f) => /^geometry-.+\.json\.gz$/.test(f)));
  for (const file of worldGeometry.size ? (await readdir(worldDir).catch(() => [] as string[])).filter((f) => f.endsWith(".json.gz")).sort() : []) {
    const rows = (await gz<{ features: Raw[] }>(path.join(worldDir, file))).features.filter((r) => FEATURE_TYPES.includes(r[0]));
    const result = await placeFeatures(rows, async (place) => {
      const wanted = new Set<string>();
      for (const f of rows) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) wanted.add(geometryCell(f[2] + dx * 0.02, f[3] + dy * 0.02));
      for (const cell of wanted) {
        if (!worldGeometry.has(`geometry-${cell}.json.gz`)) continue;
        for (const [id, lines] of Object.entries(await gz<Record<string, LngLat[][]>>(path.join(dir, "world", `geometry-${cell}.json.gz`)))) place(id, lines);
      }
    });
    for (const [cell, part] of result.cells) { await appendFile(path.join(stage, cell), JSON.stringify(part) + "\n"); staged.add(cell); }
    for (const [t, n] of Object.entries(result.byType)) byType[t] = (byType[t] ?? 0) + n;
    kept += result.kept;
    links += result.links;
    console.log(`${file.replace(".json.gz", "")}: ${result.kept.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} features on or near trails`);
  }

  const out = path.join(dir, "features");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  let bytes = 0;
  for (const cell of new Set([...cells.keys(), ...staged])) {
    const rows = [...(cells.get(cell) ?? [])] as unknown[][];
    if (staged.has(cell)) {
      const seenIds = new Set(rows.map((r) => r[0]));
      for (const line of (await readFile(path.join(stage, cell), "utf8")).split("\n")) if (line) for (const r of JSON.parse(line) as unknown[][]) if (!seenIds.has(r[0])) { seenIds.add(r[0]); rows.push(r); }
    }
    const buf = gzipSync(JSON.stringify(rows), { level: 9 });
    bytes += buf.length;
    await writeFile(path.join(out, `f-${cell}.json.gz`), buf);
  }
  await rm(stage, { recursive: true, force: true });
  const report = { total: kept, trailLinks: links, byType: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1])), cells: cells.size, bytes, source: "OpenStreetMap contributors (ODbL 1.0)" };
  await writeFile(path.join(dir, "features-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`${kept.toLocaleString("en-US")} features on or near trails in ${cells.size + staged.size} cells, ${(bytes / 1e6).toFixed(1)} MB`);
  for (const [t, n] of Object.entries(report.byType)) console.log(`  ${t}: ${n.toLocaleString("en-US")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
