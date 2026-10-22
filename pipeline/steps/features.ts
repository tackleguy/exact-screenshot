/**
 * Hike-feature layer: water sources, campsites, shelters and huts, trailheads and parking, toilets, viewpoints,
 * peaks and passes, bridges, fords, stream crossings, picnic sites, ranger stations and waterfalls from the
 * OpenStreetMap feature pass (`.cache/osm-features/<region>.json.gz`, written by extract-osm.py).
 *
 * Every feature is placed on the trails it sits on or near, with its mile marker along each of them, measured the
 * same way trail pages measure (pieces ordered with chainLines). Features near no shown trail are dropped.
 *
 * Output, in the current snapshot:
 *   features/f-<cell>.json.gz   rows [id, type, name, lon, lat, extra, [[trailId, mile, offTrailMeters], ...]]
 *   features-report.json        counts by type
 *
 * Usage: npx tsx pipeline/steps/features.ts
 */
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

async function main() {
  const { directory } = JSON.parse(await readFile(path.join(catalogRoot, "current.json"), "utf8")) as { directory: string };
  const dir = path.join(catalogRoot, directory);

  // 1. Features from every region, deduplicated where extracts overlap at borders.
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
  console.log(`${features.length.toLocaleString("en-US")} features from ${files.length} regions`);

  const grid = new Map<number, number[]>();
  features.forEach((f, i) => {
    const k = key(Math.floor(f[2] / GRID), Math.floor(f[3] / GRID));
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
  });
  const on: Map<string, [number, number]>[] = features.map(() => new Map());

  // 2. Walk every shown trail's line in page order and record the nearest point to each nearby feature.
  const index = await gz<CatalogTrail[]>(path.join(dir, "index.json.gz"));
  const shown = new Set(index.filter((r) => r.tier && !r.mergedInto && r.confidence !== "REJECTED" && r.quality !== "fragment").map((r) => r.id));
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
  let placed = 0;
  for (const file of (await readdir(dir)).filter((f) => /^geometry-.+\.json\.gz$/.test(f))) {
    for (const [id, lines] of Object.entries(await gz<Record<string, LngLat[][]>>(path.join(dir, file)))) {
      if (!shown.has(id)) continue;
      place(id, lines);
      placed++;
    }
  }
  // Curated guide sections and peak routes have their own lines; their pages measure along those.
  const curated = await gz<{ lines: Record<string, LngLat[][]> }>(path.join(dir, "curated.json.gz"));
  for (const [id, lines] of Object.entries(curated.lines)) place(id, lines);
  console.log(`placed along ${placed.toLocaleString("en-US")} trails and ${Object.keys(curated.lines).length} guide lines`);

  // 3. Write 1° cells of features that are on or near at least one trail.
  const cells = new Map<string, unknown[]>();
  const byType: Record<string, number> = {};
  let kept = 0, links = 0;
  features.forEach((f, i) => {
    if (!on[i].size) return;
    const near = [...on[i]].sort((a, b) => a[1][1] - b[1][1]).slice(0, MAX_TRAILS_PER_FEATURE).map(([id, [mile, off]]) => [id, Math.round(mile * 100) / 100, Math.round(off)]);
    const extra = Object.keys(f[4] ?? {}).length ? f[4] : 0;
    const row = [idOf(f[0], f[2], f[3]), f[0], f[1], f[2], f[3], extra, near];
    const cell = geometryCell(f[2], f[3]);
    (cells.get(cell) ?? cells.set(cell, []).get(cell)!).push(row);
    byType[f[0]] = (byType[f[0]] ?? 0) + 1;
    kept++;
    links += near.length;
  });
  const out = path.join(dir, "features");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  let bytes = 0;
  for (const [cell, rows] of cells) {
    const buf = gzipSync(JSON.stringify(rows), { level: 9 });
    bytes += buf.length;
    await writeFile(path.join(out, `f-${cell}.json.gz`), buf);
  }
  const report = { total: kept, dropped: features.length - kept, trailLinks: links, byType: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1])), cells: cells.size, bytes, source: "OpenStreetMap contributors (ODbL 1.0)" };
  await writeFile(path.join(dir, "features-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`${kept.toLocaleString("en-US")} features on or near trails (${(features.length - kept).toLocaleString("en-US")} near no shown trail) in ${cells.size} cells, ${(bytes / 1e6).toFixed(1)} MB`);
  for (const [t, n] of Object.entries(report.byType)) console.log(`  ${t}: ${n.toLocaleString("en-US")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
