/** Downloads OpenStreetMap trailheads (highway=trailhead, ODbL) for North America into a local cache that
 * `npm run source:trails` uses to give each trail a start point. Public Overpass instances are slow and
 * sometimes down, so this runs once at build time rather than on each page view.
 * Run with npm run source:trailheads [--refresh].
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import type { CachedTrailhead, TrailheadCache } from "../../src/lib/trail-catalog/access";

const cache = path.join(process.cwd(), ".cache/trailheads");
const target = path.join(cache, "trailheads-na.json.gz");
const refresh = process.argv.includes("--refresh");
const QUERY = `[out:json][timeout:600];nwr["highway"="trailhead"](14,-170,72,-50);out center tags;`;
const ENDPOINTS = [
  process.env.OVERPASS_API_URL,
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
].filter((url): url is string => Boolean(url));

type Element = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

async function fetchAll(): Promise<{ elements: Element[]; osm3s?: { timestamp_osm_base?: string } }> {
  // A previously downloaded raw response can be reused (e.g. fetched by hand from a mirror).
  if (!refresh) { try { return JSON.parse(await readFile(path.join(cache, "th.json"), "utf8")); } catch { /* fetch */ } }
  for (const endpoint of ENDPOINTS) {
    try {
      console.log(`Querying ${endpoint}…`);
      const response = await fetch(endpoint, { method: "POST", body: new URLSearchParams({ data: QUERY }), headers: { "User-Agent": "Hyked/1.0 (https://github.com/tackleguy/health)" }, signal: AbortSignal.timeout(660_000) });
      if (!response.ok) { console.warn(`${endpoint}: HTTP ${response.status}`); continue; }
      const data = await response.json();
      if (Array.isArray(data.elements)) return data;
    } catch (error) {
      console.warn(`${endpoint}: ${String(error)}`);
    }
  }
  throw new Error("No Overpass instance returned trailheads. Rerun later; the catalog builds without them.");
}

async function main() {
  await mkdir(cache, { recursive: true });
  if (!refresh && !process.argv.includes("--rebuild")) { try { await stat(target); console.log("Trailhead cache present; use --refresh (or --rebuild to keep the OSM download) to update."); return; } catch { /* build */ } }
  const data = await fetchAll();
  // Official U.S. Forest Service trailheads (public domain), with water and closest-town notes.
  const official: TrailheadCache["trailheads"] = [];
  const USFS = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_InfraRecreationSites_01/MapServer/0/query";
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({ where: "site_subtype='TRAILHEAD' AND development_status='EXISTING'", outFields: "site_cn,public_site_name,site_name,water_availability,closest_towns,latitude,longitude,usda_portal_url", returnGeometry: "false", orderByFields: "objectid ASC", resultOffset: String(offset), resultRecordCount: "1000", f: "json" });
    const response = await fetch(`${USFS}?${query}`, { headers: { "User-Agent": "Hyked/1.0 (https://github.com/tackleguy/health)" }, signal: AbortSignal.timeout(120_000) });
    const page = await response.json() as { features?: { attributes: Record<string, string | number | null> }[]; exceededTransferLimit?: boolean };
    for (const { attributes: a } of page.features ?? []) {
      const lat = Number(a.latitude), lon = Number(a.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) continue;
      const clean = (v: unknown) => (typeof v === "string" && v.trim() && !/^(null|n\/a)$/i.test(v.trim()) ? v.trim().slice(0, 200) : null);
      official.push({ osm: `usfs/${a.site_cn}`, name: clean(a.public_site_name) ?? clean(a.site_name), latitude: Math.round(lat * 1e5) / 1e5, longitude: Math.round(lon * 1e5) / 1e5, source: "usfs", url: clean(a.usda_portal_url) ?? undefined, water: clean(a.water_availability), closestTowns: clean(a.closest_towns) });
    }
    if (!page.exceededTransferLimit || !(page.features ?? []).length) break;
  }
  console.log(`${official.length.toLocaleString()} official USFS trailheads`);
  const out: TrailheadCache = {
    retrievedAt: new Date().toISOString(),
    dataTimestamp: data.osm3s?.timestamp_osm_base ?? null,
    trailheads: data.elements.flatMap((e): CachedTrailhead[] => {
      const lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
      if (lat == null || lon == null) return [];
      return [{ osm: `${e.type}/${e.id}`, name: e.tags?.name?.trim() || null, latitude: Math.round(lat * 1e5) / 1e5, longitude: Math.round(lon * 1e5) / 1e5, source: "osm" as const }];
    }).concat(official),
  };
  await writeFile(target, gzipSync(JSON.stringify(out)));
  console.log(`${out.trailheads.length.toLocaleString()} trailheads cached (OSM data as of ${out.dataTimestamp ?? "unknown"}).`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
