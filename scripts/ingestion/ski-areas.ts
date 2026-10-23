/**
 * Every named ski area in the world, from the OpenSkiMap ski-area download (ODbL, © OpenStreetMap contributors and
 * Skimap.org), as one small file the static site loads for the ski map and ski search:
 *
 *   data/sources/ski-areas.json.gz   { attribution, retrievedAt, areas: [id, name, lng, lat, country, region,
 *                                      locality, activities, runs, lifts, topM, baseM, website][] }
 *
 * Only the published geojson download is used (OpenSkiMap's map tiles are not for other sites).
 *
 * Usage: npx tsx scripts/ingestion/ski-areas.ts [path/to/ski_areas.geojson]
 */
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const URL_ = "https://tiles.openskimap.org/geojson/ski_areas.geojson";
const ACTIVITY_CODES: Record<string, string> = { downhill: "d", nordic: "n", backcountry: "b", skitour: "t", sled: "s", snow_park: "p", ice_skate: "i", fatbike: "f", hike: "h" };

interface Area {
  properties: {
    id: string; name: string | null; status: string | null; activities?: string[]; websites?: string[];
    places?: { iso3166_1Alpha2?: string; localized?: { en?: { region?: string | null; locality?: string | null } } }[];
    statistics?: { runs?: { byActivity?: Record<string, { byDifficulty?: Record<string, { count: number }> }> }; lifts?: { byType?: Record<string, { count: number }> }; maxElevation?: number; minElevation?: number };
    viewportHint?: { center?: [number, number] };
  };
  geometry: { type: string; coordinates: unknown } | null;
}

/** A representative point: OpenSkiMap's own viewport centre, else the outline's first vertex. */
function pointOf(a: Area): [number, number] | null {
  const c = a.properties.viewportHint?.center;
  if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) return c;
  let found: [number, number] | null = null;
  const walk = (v: unknown) => { if (found) return; if (Array.isArray(v) && typeof v[0] === "number") found = [v[0] as number, v[1] as number]; else if (Array.isArray(v)) v.forEach(walk); };
  walk(a.geometry?.coordinates);
  return found;
}

async function main() {
  const local = process.argv[2];
  const text = local ? await readFile(local, "utf8") : await (await fetch(URL_, { headers: { "User-Agent": "Hyked/1.0 (trail app)" } })).text();
  const features = (JSON.parse(text) as { features: Area[] }).features;
  const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
  const areas = features.flatMap((a) => {
    const p = a.properties;
    const point = pointOf(a);
    if (!p.name?.trim() || !point || (p.status && p.status !== "operating")) return [];
    const place = p.places?.[0];
    const runs = Object.values(p.statistics?.runs?.byActivity ?? {}).reduce((t, act) => t + Object.values(act.byDifficulty ?? {}).reduce((s, d) => s + (d.count ?? 0), 0), 0);
    const lifts = Object.values(p.statistics?.lifts?.byType ?? {}).reduce((t, l) => t + (l.count ?? 0), 0);
    return [[
      p.id, p.name.trim(), r5(point[0]), r5(point[1]), place?.iso3166_1Alpha2 ?? "", place?.localized?.en?.region ?? "", place?.localized?.en?.locality ?? "",
      (p.activities ?? []).map((x) => ACTIVITY_CODES[x] ?? "").join(""), runs, lifts,
      p.statistics?.maxElevation != null ? Math.round(p.statistics.maxElevation) : null,
      p.statistics?.minElevation != null ? Math.round(p.statistics.minElevation) : null,
      p.websites?.[0] ?? "",
    ]];
  });
  const out = path.resolve("data/sources/ski-areas.json.gz");
  await writeFile(out, gzipSync(JSON.stringify({ attribution: "Ski areas © OpenSkiMap.org, OpenStreetMap contributors (ODbL), Skimap.org", retrievedAt: new Date().toISOString(), areas })));
  console.log(`${areas.length.toLocaleString("en-US")} operating ski areas → ${path.relative(process.cwd(), out)}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
