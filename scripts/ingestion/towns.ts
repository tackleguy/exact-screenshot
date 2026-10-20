/** Builds data/towns/towns.json.gz: U.S. and Canadian populated places (population ≥ 500) from GeoNames
 * (CC BY 4.0, https://www.geonames.org). Used to find resupply towns near trails.
 * Run with npm run source:towns [--refresh].
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const cache = path.join(process.cwd(), ".cache/towns");
const output = path.join(process.cwd(), "data/towns/towns.json.gz");
const refresh = process.argv.includes("--refresh");

async function download(url: string, file: string) {
  if (!refresh) { try { await stat(file); return; } catch { /* fetch */ } }
  const response = await fetch(url, { headers: { "User-Agent": "Hyked/1.0 (https://github.com/tackleguy/health)" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}

async function main() {
  await mkdir(cache, { recursive: true });
  await mkdir(path.dirname(output), { recursive: true });
  const zip = path.join(cache, "cities500.zip"), admin = path.join(cache, "admin1CodesASCII.txt");
  await download("https://download.geonames.org/export/dump/cities500.zip", zip);
  await download("https://download.geonames.org/export/dump/admin1CodesASCII.txt", admin);
  execFileSync("unzip", ["-o", "-q", zip, "-d", cache]);
  const states = new Map((await readFile(admin, "utf8")).split("\n").filter(Boolean).map((line) => { const [code, name] = line.split("\t"); return [code, name] as const; }));
  const towns: [number, string, string, string, number, number, number][] = [];
  for (const line of (await readFile(path.join(cache, "cities500.txt"), "utf8")).split("\n")) {
    const f = line.split("\t");
    if (f.length < 15) continue;
    const [id, name, , , lat, lng, featureClass, , country, , admin1, , , , population] = f;
    if (featureClass !== "P" || (country !== "US" && country !== "CA")) continue;
    towns.push([Number(id), name, states.get(`${country}.${admin1}`) ?? admin1, country, Number(Number(lat).toFixed(4)), Number(Number(lng).toFixed(4)), Number(population) || 0]);
  }
  await writeFile(output, gzipSync(JSON.stringify({ source: "GeoNames cities500 (CC BY 4.0, https://www.geonames.org)", retrievedAt: new Date().toISOString(), fields: ["id", "name", "state", "country", "lat", "lng", "population"], towns })));
  console.log(`${towns.length.toLocaleString()} towns written to ${path.relative(process.cwd(), output)}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
