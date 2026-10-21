/** Second-pass winter classification over a built snapshot: lift lines and courses on pistes, USFS
 * snow-only routes and winter-only names become ski/over-snow records, out of hiking results.
 * npx tsx scripts/ingestion/reclassify-winter.ts [--apply]   (dry run without --apply)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import type { CatalogManifest, CatalogTrail } from "../../src/lib/trail-catalog/types";
import type { SkiRunCache } from "../../src/lib/trail-catalog/ski-runs";
import { LineIndex } from "../../src/lib/trail-catalog/additions";
import { USFS_SNOW_WHERE, pisteIndexes, winterVerdict } from "../../src/lib/trail-catalog/winter-audit";
import { confidenceFor } from "../../src/lib/trail-catalog/agencies";

const USFS = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0/query";

async function usfsSnowIndex() {
  const cacheDir = path.join(process.cwd(), ".cache/usfs-snow");
  await mkdir(cacheDir, { recursive: true });
  const index = new LineIndex();
  let count = 0;
  for (let offset = 0; ; offset += 1000) {
    const file = path.join(cacheDir, `${offset}.json`);
    let data: { features?: { attributes: Record<string, unknown>; geometry?: { paths: [number, number][][] } }[]; exceededTransferLimit?: boolean };
    try { data = JSON.parse(await readFile(file, "utf8")); } catch {
      const q = new URLSearchParams({ where: USFS_SNOW_WHERE, outFields: "objectid", returnGeometry: "true", outSR: "4326", geometryPrecision: "5", maxAllowableOffset: "0.0001", orderByFields: "objectid ASC", resultOffset: String(offset), resultRecordCount: "1000", f: "json" });
      const r = await fetch(`${USFS}?${q}`, { headers: { "User-Agent": "Hyked/1.0 (https://github.com/tackleguy/health)" }, signal: AbortSignal.timeout(120_000) });
      data = await r.json();
      await writeFile(file, JSON.stringify(data));
    }
    for (const f of data.features ?? []) if (f.geometry?.paths?.length) { index.add(f.geometry.paths, String(f.attributes.objectid)); count++; }
    if (!data.exceededTransferLimit || !(data.features ?? []).length) break;
  }
  console.log(`${count} USFS snow-only trail lines`);
  return index;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const root = path.join(process.cwd(), "data/trail-catalog");
  const dir = path.join(root, JSON.parse(await readFile(path.join(root, "current.json"), "utf8")).directory);
  const rows = JSON.parse(gunzipSync(await readFile(path.join(dir, "index.json.gz"))).toString()) as CatalogTrail[];
  const ski = JSON.parse(gunzipSync(await readFile(path.join(process.cwd(), ".cache/ski/runs-na.json.gz"))).toString()) as SkiRunCache;
  const { pistes, downhillOnly } = pisteIndexes(ski);
  const snow = await usfsSnowIndex();
  const cells: Record<string, Record<string, [number, number][][]>> = {};
  const geometry = async (r: CatalogTrail) => (cells[r.geometryShard] ??= JSON.parse(gunzipSync(await readFile(path.join(dir, `geometry-${r.geometryShard}.json.gz`))).toString()))[r.id];
  const changed: Record<string, { name: string; region: string | null; reason: string }[]> = {};
  for (const row of rows) {
    if (row.kind !== "segment" || row.winterUse === "downhill") continue;
    const lines = await geometry(row);
    if (!lines) continue;
    const verdict = winterVerdict(row, lines, pistes, downhillOnly, snow);
    if (!verdict) continue;
    (changed[verdict.reason] ??= []).push({ name: row.name, region: row.region, reason: verdict.reason });
    if (apply) {
      row.winterUse = verdict.use;
      row.confidence = confidenceFor(row);
    }
  }
  for (const [reason, list] of Object.entries(changed)) {
    console.log(`\n${reason}: ${list.length}`);
    console.log(list.slice(0, 25).map((c) => `  ${c.name} | ${c.region}`).join("\n"));
  }
  if (!apply) { console.log("\nDry run. Re-run with --apply to write the snapshot."); return; }
  const index = gzipSync(JSON.stringify(rows), { level: 9 });
  await writeFile(path.join(dir, "index.json.gz"), index);
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as CatalogManifest;
  manifest.indexSha256 = createHash("sha256").update(index).digest("hex");
  const total = Object.values(changed).reduce((n, l) => n + l.length, 0);
  manifest.notes = [...manifest.notes.filter((n) => !n.startsWith("Second winter pass")), `Second winter pass: ${total} more records are ski or over-snow routes (lift lines and courses on pistes, U.S. Forest Service snow-only trails, winter-only names) and are listed under Ski, not hiking.`];
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nApplied to ${total} records.`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
