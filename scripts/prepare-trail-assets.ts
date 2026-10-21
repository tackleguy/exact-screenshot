import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildThroughHikeOverlay } from "../src/lib/trail-catalog/through-hikes";
import { buildResortOverlay } from "../src/lib/trail-catalog/resorts";
import { titleCaseName, normalizeSeason } from "../src/lib/trail-catalog/agencies";
import type { CatalogTrail } from "../src/lib/trail-catalog/types";
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
const rows = [...sections, ...routes, ...resorts];
const output = path.resolve("public/trail-data", pointer.directory);
await mkdir(output, { recursive: true });
const cellOf = (t: CatalogTrail) => `${Math.floor((t.longitude + 180) / 2)}_${Math.floor((t.latitude + 90) / 2)}`;
const cells = new Map<string, CatalogTrail[]>();
for (const row of rows) { const key = cellOf(row); const cell = cells.get(key) ?? []; cell.push(row); cells.set(key, cell); }
const zipped = (value: unknown) => gzipSync(JSON.stringify(value));
await Promise.all([...cells].map(([key, trails]) => writeFile(path.join(output, `cell-${key}.json.gz`), zipped(trails))));
const search = rows.map(t => [t.id, [t.name, t.region, t.country, t.park, t.forest, t.manager].filter(Boolean).join(" "), cellOf(t)]);
await writeFile(path.join(output, "search.json.gz"), zipped(search));
await writeFile(path.join(output, "overview.json.gz"), zipped(routes));
const files = new Set(rows.filter(t => t.geometryShard !== "route" && t.source !== "resort").map(t => `geometry-${t.geometryShard}.json.gz`));
await Promise.all([...files].map(file => copyFile(path.join(source, file), path.join(output, file)).catch(error => { if (error.code !== "ENOENT") throw error; })));
await writeFile(path.join(output, "manifest.json"), JSON.stringify({ ...manifest, total: rows.length, cells: [...cells.keys()], directory: pointer.directory }));
await writeFile(path.resolve("public/trail-data/current.json"), JSON.stringify(pointer));
console.log(`Prepared ${rows.length} source-backed trails in ${cells.size} local cells.`);
await Promise.all([
  copyFile("data/sources/trailheads-na.json.gz", path.join(output, "trailheads.json.gz")),
  copyFile("data/towns/towns.json.gz", path.join(output, "towns.json.gz")),
]);
}
main().catch(error => { console.error(error); process.exitCode = 1; });