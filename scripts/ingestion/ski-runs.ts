/** Downloads the OpenSkiMap run and ski-area exports (ODbL, © OpenStreetMap contributors) and keeps the
 * U.S. and Canadian features in a compact cache that `npm run source:trails` uses to find catalog records
 * that are really ski runs. Run with npm run source:ski [--refresh].
 */
import { createReadStream } from "node:fs";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import type { SkiRunCache } from "../../src/lib/trail-catalog/ski-runs";

const cache = path.join(process.cwd(), ".cache/ski");
const refresh = process.argv.includes("--refresh");
const COUNTRIES = new Set(["US", "CA"]);
const round = (n: number) => Math.round(n * 1e5) / 1e5;

async function download(name: string) {
  const target = path.join(cache, name);
  if (!refresh) { try { await stat(target); return target; } catch { /* fetch below */ } }
  const response = await fetch(`https://tiles.openskimap.org/geojson/${name}`, { headers: { "User-Agent": "Hyked/1.0 (https://github.com/tackleguy/health)" } });
  if (!response.ok || !response.body) throw new Error(`OpenSkiMap ${name}: HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(`${target}.tmp`));
  await rename(`${target}.tmp`, target);
  return target;
}

/** The exports are one feature per line; parse line by line so the 800 MB file never loads at once. */
async function* features(file: string) {
  for await (const raw of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    const line = raw.trim().replace(/,$/, "");
    if (!line.startsWith("{\"type\":\"Feature\"") && !line.startsWith("{\"properties\"")) continue;
    yield JSON.parse(line) as { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } };
  }
}

const inRegion = (props: Record<string, unknown>) =>
  (props.places as { iso3166_1Alpha2?: string }[] | undefined)?.some((p) => COUNTRIES.has(p.iso3166_1Alpha2 ?? "")) ?? false;

async function main() {
  await mkdir(cache, { recursive: true });
  const [runsFile, areasFile] = [await download("runs.geojson"), await download("ski_areas.geojson")];
  const out: SkiRunCache = { retrievedAt: (await stat(runsFile)).mtime.toISOString(), runs: [], areas: [] };

  for await (const f of features(areasFile)) {
    const p = f.properties;
    if (p.type !== "skiArea" || !inRegion(p) || f.geometry?.type !== "Point") continue;
    const [lng, lat] = f.geometry.coordinates as number[];
    out.areas.push({ id: String(p.id), name: (p.name as string | null) ?? null, activities: (p.activities as string[]) ?? [], point: [round(lng), round(lat)], website: ((p.websites as string[]) ?? [])[0] ?? null });
  }
  let seen = 0;
  for await (const f of features(runsFile)) {
    seen++;
    const p = f.properties;
    if (p.type !== "run" || !inRegion(p)) continue;
    const g = f.geometry;
    const lines = g.type === "LineString" ? [g.coordinates as number[][]] : g.type === "MultiLineString" ? (g.coordinates as number[][][]) : g.type === "Polygon" ? [(g.coordinates as number[][][])[0]] : g.type === "MultiPolygon" ? (g.coordinates as number[][][][]).map((poly) => poly[0]) : [];
    if (!lines.length) continue;
    const area = (p.skiAreas as { properties: { id: string; name: string | null } }[] | undefined)?.[0]?.properties;
    out.runs.push({
      name: (p.name as string | null) ?? null,
      uses: (p.uses as string[]) ?? [],
      difficulty: (p.difficulty as string | null) ?? null,
      areaId: area?.id ?? null,
      areaName: area?.name ?? null,
      lines: lines.map((line) => line.map(([x, y]) => [round(x), round(y)] as [number, number])),
    });
  }
  await writeFile(path.join(cache, "runs-na.json.gz"), gzipSync(JSON.stringify(out)));
  console.log(`${seen.toLocaleString()} runs scanned; kept ${out.runs.length.toLocaleString()} U.S./Canadian runs and ${out.areas.length.toLocaleString()} ski areas.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
