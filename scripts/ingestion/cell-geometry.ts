/** One-time conversion of a snapshot's geometry from id-hash shards (geometry-00…63) to geographic
 * cells (geometry-<cell>), updating each row's geometryShard and the index checksum. Idempotent.
 * Run with: npx tsx scripts/ingestion/cell-geometry.ts [snapshot-dir]
 */
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import type { CatalogManifest, CatalogTrail } from "../../src/lib/trail-catalog/types";
import { geometryCell } from "../../src/lib/trail-catalog/cells";

async function main() {
  const root = path.join(process.cwd(), "data/trail-catalog");
  const dir = path.join(root, process.argv[2] ?? JSON.parse(await readFile(path.join(root, "current.json"), "utf8")).directory);
  const rows = JSON.parse(gunzipSync(await readFile(path.join(dir, "index.json.gz"))).toString()) as CatalogTrail[];
  const files = (await readdir(dir)).filter((f) => /^geometry-\d{2}\.json\.gz$/.test(f));
  if (!files.length) { console.log("Already cell-based; nothing to do."); return; }
  const lines: Record<string, unknown> = {};
  for (const f of files) Object.assign(lines, JSON.parse(gunzipSync(await readFile(path.join(dir, f))).toString()));
  const cells: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const cell = geometryCell(row.longitude, row.latitude);
    if (!lines[row.id]) throw new Error(`Missing geometry for ${row.id}`);
    (cells[cell] ??= {})[row.id] = lines[row.id];
    row.geometryShard = cell;
  }
  for (const [cell, data] of Object.entries(cells)) await writeFile(path.join(dir, `geometry-${cell}.json.gz`), gzipSync(JSON.stringify(data), { level: 9 }));
  for (const f of files) await rm(path.join(dir, f));
  const index = gzipSync(JSON.stringify(rows), { level: 9 });
  await writeFile(path.join(dir, "index.json.gz"), index);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as CatalogManifest;
  manifest.indexSha256 = createHash("sha256").update(index).digest("hex");
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`${rows.length} trails in ${Object.keys(cells).length} geographic cells (was ${files.length} id shards).`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
