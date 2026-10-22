/**
 * Ski-area pack for the Lovable frontend: every operating, named ski area in the world with its
 * ski runs (OpenSkiMap) and the hiking and mountain-bike trails on the mountain or close by (Hyked
 * catalog, resort-published summer trails). Nothing is invented: an area with no mapped summer trails
 * gets empty lists and says so.
 * Needs .cache/ski/runs-world.json.gz (npm run source:ski -- --world).
 * npx tsx scripts/export/ski-areas.ts   → exports/hyked-ski-areas/ and exports/hyked-ski-areas.zip
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { CatalogTrail } from "../../src/lib/trail-catalog/types";
import type { SkiRunCache } from "../../src/lib/trail-catalog/ski-runs";
import { matchingCatalogRows } from "../../src/lib/trail-catalog/search";
import { trailActivities } from "../../src/lib/trail-catalog/activity";
import { resolveDifficulty } from "../../src/lib/trail-difficulty";
import { simplifyLine } from "../../src/lib/geo/simplify";
import { tileFeaturesOrNull, tileOf, type TileFeature } from "../../src/lib/geo/tiles";
import { gzipSync } from "node:zlib";

const root = process.cwd();
const out = path.join(root, "exports/hyked-ski-areas");
/** Trails this far outside the lift-served footprint are listed as nearby. */
const NEARBY_KM = 10;
const NEARBY_LIMIT = 25;
const PAD_KM = 0.4;
const NO_RUNS_RADIUS_KM = 1.5;
const TOLERANCE = 0.00004;

type Pt = [number, number];
type Lines = Pt[][];
interface AreaFeature { properties: { id: string; name: string | null; status: string | null; activities: string[]; websites?: string[]; places?: { iso3166_1Alpha2: string; iso3166_2?: string; localized?: { en?: { region?: string | null; locality?: string | null } } }[]; statistics?: { runs?: { byActivity?: Record<string, { byDifficulty?: Record<string, { count: number; lengthInKm: number }> }>; maxElevation?: number; minElevation?: number }; lifts?: { byType?: Record<string, { count: number }> } } }; geometry: { type: string; coordinates: unknown } }

/** Every vertex of a Point, Polygon or MultiPolygon (OpenSkiMap outlines big resorts). */
function vertices(geometry: AreaFeature["geometry"]): Pt[] {
  const out: Pt[] = [];
  const walk = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === "number") out.push([c[0] as number, c[1] as number]);
    else if (Array.isArray(c)) for (const x of c) walk(x);
  };
  walk(geometry.coordinates);
  return out;
}

const kmX = (lat: number) => 111.32 * Math.cos((lat * Math.PI) / 180);
const round = (n: number, d = 5) => Math.round(n * 10 ** d) / 10 ** d;
const slug = (s: string) => s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toLowerCase().replace(/[\s_-]+/g, "-").slice(0, 60);
const norm = (s: string) => s.toLowerCase().replace(/\b(ski|resort|area|mountain|mtn|the|and|&)\b/g, "").replace(/[^a-z0-9]/g, "");
const lengthKm = (lines: Lines) => {
  let m = 0;
  for (const l of lines) for (let i = 1; i < l.length; i++) {
    const dx = (l[i][0] - l[i - 1][0]) * kmX(l[i][1]), dy = (l[i][1] - l[i - 1][1]) * 110.54;
    m += Math.hypot(dx, dy);
  }
  return m;
};
const ft = (m: number | undefined) => (m === undefined ? null : Math.round(m * 3.28084));

const MAX_TILES = 120;
const TILE_DIR = path.join(root, ".cache/osm-trail-tiles");
type OsmTile = { p: Record<string, string | number | boolean>; l: Lines }[];

/** OpenStreetMap trail features of one z14 tile (OSM US trails tiles), cached on disk for reruns. */
async function osmTile(x: number, y: number): Promise<OsmTile | null> {
  const file = path.join(TILE_DIR, `14_${x}_${y}.json.gz`);
  try { return JSON.parse(gunzipSync(await readFile(file)).toString()); } catch { /* not cached */ }
  let features: TileFeature[] | null = null;
  for (let attempt = 0; attempt < 3 && !features; attempt++) {
    features = await tileFeaturesOrNull("trails", 14, x, y, ["trail"]);
    if (!features) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (!features) return null;
  const data: OsmTile = features.flatMap((f) => {
    const l = f.geometry.type === "LineString" ? [f.geometry.coordinates as Pt[]] : f.geometry.type === "MultiLineString" ? (f.geometry.coordinates as Pt[][]) : [];
    return l.length ? [{ p: f.properties, l: l.map((line) => line.map(([a, b]) => [round(a, 6), round(b, 6)] as Pt)) }] : [];
  });
  await writeFile(file, gzipSync(JSON.stringify(data)));
  return data;
}

const TRAIL_HIGHWAYS = new Set(["path", "footway", "bridleway", "track", "cycleway"]);
const CLOSED = new Set(["no", "private", "discouraged"]);
const PAVED = /^(paved|asphalt|concrete|paving_stones|sett|concrete:plates)$/;
/** IMBA 0–4 / mtb:scale 0–6 → easy · intermediate · difficult · extreme. */
function mtbDifficulty(p: Record<string, unknown>) {
  const imba = Number(p["mtb:scale:imba"]), scale = Number(String(p["mtb:scale"] ?? "").replace(/[+-]/, ""));
  if (Number.isFinite(imba) && p["mtb:scale:imba"] !== undefined) return ["easy", "easy", "intermediate", "difficult", "extreme"][Math.min(4, imba)];
  if (Number.isFinite(scale) && p["mtb:scale"] !== undefined) return scale <= 1 ? "easy" : scale === 2 ? "intermediate" : scale === 3 ? "difficult" : "extreme";
  return null;
}
function osmUses(p: Record<string, unknown>) {
  const highway = String(p.highway ?? "");
  if (!TRAIL_HIGHWAYS.has(highway) || p.informal === "yes" || p.footway === "sidewalk" || p.footway === "crossing") return null;
  const foot = String(p.foot ?? ""), bicycle = String(p.bicycle ?? "");
  const hasMtb = p["mtb:scale"] !== undefined || p["mtb:scale:imba"] !== undefined || p["mtb:type"] !== undefined;
  const bikeOk = hasMtb || ["designated", "yes", "permissive", "customers"].includes(bicycle);
  const natural = !PAVED.test(String(p.surface ?? "")) && highway !== "cycleway" && highway !== "footway";
  return {
    hiking: !CLOSED.has(foot) && highway !== "cycleway" && !(highway === "track" && !p.name),
    mtb: bikeOk && natural && !CLOSED.has(bicycle),
  };
}

/** Distance in km from a point to a bounding box (0 inside). */
function boxDistanceKm([x, y]: Pt, [w, s, e, n]: [number, number, number, number]) {
  const dx = x < w ? (w - x) * kmX(y) : x > e ? (x - e) * kmX(y) : 0;
  const dy = y < s ? (s - y) * 110.54 : y > n ? (y - n) * 110.54 : 0;
  return Math.hypot(dx, dy);
}

async function main() {
  const areasRaw = JSON.parse(await readFile(path.join(root, ".cache/ski/ski_areas.geojson"), "utf8")) as { features: AreaFeature[] };
  const ski = JSON.parse(gunzipSync(await readFile(path.join(root, ".cache/ski/runs-world.json.gz"))).toString()) as SkiRunCache;
  const catalogRoot = path.join(root, "data/trail-catalog");
  const dir = path.join(catalogRoot, JSON.parse(await readFile(path.join(catalogRoot, "current.json"), "utf8")).directory);
  const rows = JSON.parse(gunzipSync(await readFile(path.join(dir, "index.json.gz"))).toString()) as CatalogTrail[];
  const resortTrails = JSON.parse(await readFile(path.join(catalogRoot, "resort-trails.json"), "utf8")).resorts as { resort: string; state: string; baseLatitude: number; baseLongitude: number; sourceUrl: string; trails: { name: string; miles: number | null; difficulty: string | null; use: string }[] }[];

  const areas = areasRaw.features.filter((f) => {
    const p = f.properties;
    return p.name && (p.status === "operating" || p.status === null) && p.activities.length;
  });
  const runsByArea = new Map<string, SkiRunCache["runs"]>();
  for (const run of ski.runs) if (run.areaId) (runsByArea.get(run.areaId) ?? runsByArea.set(run.areaId, []).get(run.areaId)!).push(run);

  // Public hiking and mountain-bike trails, bucketed by 0.1° for the neighbourhood search.
  const hike = new Set(matchingCatalogRows(rows, { activity: "hike" }).filter((r) => r.kind === "segment").map((r) => r.id));
  const mtb = new Set(matchingCatalogRows(rows, { activity: "mtb" }).filter((r) => r.kind === "segment").map((r) => r.id));
  const grid = new Map<string, CatalogTrail[]>();
  for (const r of rows) {
    if (!hike.has(r.id) && !mtb.has(r.id)) continue;
    const key = `${Math.floor(r.longitude * 10)}:${Math.floor(r.latitude * 10)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(r);
  }
  const cells = new Map<string, Record<string, Lines>>();
  const geometry = async (r: CatalogTrail) => {
    if (!cells.has(r.geometryShard)) {
      try { cells.set(r.geometryShard, JSON.parse(gunzipSync(await readFile(path.join(dir, `geometry-${r.geometryShard}.json.gz`))).toString())); }
      catch { cells.set(r.geometryShard, {}); }
    }
    return cells.get(r.geometryShard)![r.id];
  };

  await rm(out, { recursive: true, force: true });
  await mkdir(path.join(out, "areas"), { recursive: true });
  const index: unknown[] = [];
  const used = new Set<string>();
  const totals = { areas: 0, withRuns: 0, withHiking: 0, withMtb: 0, withHikingOnMountain: 0, withMtbOnMountain: 0 };

  const processArea = async (area: AreaFeature) => {
    const p = area.properties;
    const outline = vertices(area.geometry);
    if (!outline.length) return;
    const lng = outline.reduce((t, v) => t + v[0], 0) / outline.length, lat = outline.reduce((t, v) => t + v[1], 0) / outline.length;
    const runs = runsByArea.get(p.id) ?? [];
    let box: [number, number, number, number];
    if (runs.length || outline.length > 1) {
      let w = 180, s = 90, e = -180, n = -90;
      const extend = ([x, y]: Pt) => { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); };
      for (const r of runs) for (const l of r.lines) for (const v of l) extend(v);
      if (outline.length > 1) for (const v of outline) extend(v);
      const padX = PAD_KM / kmX(lat), padY = PAD_KM / 110.54;
      box = [w - padX, s - padY, e + padX, n + padY];
    } else {
      const rx = NO_RUNS_RADIUS_KM / kmX(lat), ry = NO_RUNS_RADIUS_KM / 110.54;
      box = [lng - rx, lat - ry, lng + rx, lat + ry];
    }

    // Catalog trails touching the footprint (on the mountain) or within NEARBY_KM of it.
    const reachX = Math.ceil(((NEARBY_KM + 25) / kmX(lat)) * 10), reachY = Math.ceil(((NEARBY_KM + 25) / 110.54) * 10);
    const cx = Math.floor(((box[0] + box[2]) / 2) * 10), cy = Math.floor(((box[1] + box[3]) / 2) * 10);
    type Found = { row: CatalogTrail; lines: Lines; km: number };
    const found: Found[] = [];
    for (let gx = cx - reachX; gx <= cx + reachX; gx++) for (let gy = cy - reachY; gy <= cy + reachY; gy++) {
      for (const row of grid.get(`${gx}:${gy}`) ?? []) {
        const lines = await geometry(row);
        if (!lines?.length) continue;
        let km = Infinity;
        for (const l of lines) for (const pt of l) { km = Math.min(km, boxDistanceKm(pt, box)); if (km === 0) break; }
        if (km <= NEARBY_KM) found.push({ row, lines, km });
      }
    }
    found.sort((a, b) => a.km - b.km || (b.row.miles ?? 0) - (a.row.miles ?? 0));

    const summary = (f: Found) => ({
      id: f.row.id,
      name: f.row.name,
      miles: f.row.miles,
      difficulty: resolveDifficulty({ reported: f.row.difficulty, miles: f.row.miles, name: f.row.name }).difficulty,
      routeType: f.row.routeType ?? null,
      onMountain: f.km === 0,
      kmFromSkiArea: round(f.km, 1),
      sections: trailActivities(f.row).filter((a) => ["hike", "walk", "backpack", "run", "mtb", "horse"].includes(a)),
      allowedUses: f.row.uses ?? null,
      manager: f.row.manager,
      dataSource: "official",
      sourceUrl: f.row.sourceUrl,
    });
    const pick = (set: Set<string>) => {
      const list = found.filter((f) => set.has(f.row.id));
      return [...list.filter((f) => f.km === 0), ...list.filter((f) => f.km > 0).slice(0, NEARBY_LIMIT)];
    };
    const hiking = pick(hike), biking = pick(mtb);

    // Named OpenStreetMap trails on the mountain that the official datasets don't already cover.
    const [tx0, ty1] = tileOf([box[0], box[1]], 14), [tx1, ty0] = tileOf([box[2], box[3]], 14);
    const tiles: [number, number][] = [];
    for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) tiles.push([x, y]);
    const known = new Set(found.map((f) => norm(f.row.name)));
    const osm = new Map<string, { name: string; lines: Lines; edges: Set<string>; hiking: number; mtb: number; difficulty: string | null; operator: string | null; surface: string | null }>();
    let unreadTiles = 0;
    for (let i = 0; i < Math.min(tiles.length, MAX_TILES); i += 8) {
      const batch = await Promise.all(tiles.slice(i, i + 8).map(([x, y]) => osmTile(x, y)));
      for (const tile of batch) {
        if (!tile) { unreadTiles++; continue; }
        for (const f of tile) {
          const name = typeof f.p.name === "string" ? f.p.name.trim() : "";
          const uses = osmUses(f.p);
          if (!name || !uses || (!uses.hiking && !uses.mtb) || known.has(norm(name))) continue;
          if (!f.l.some((l) => l.some((pt) => boxDistanceKm(pt, box) === 0))) continue;
          const key = name.toLowerCase();
          const t = osm.get(key) ?? { name, lines: [], edges: new Set<string>(), hiking: 0, mtb: 0, difficulty: null, operator: null, surface: null };
          for (const l of f.l) {
            const fresh: Pt[] = [];
            for (let k = 1; k < l.length; k++) {
              const e = `${l[k - 1][0].toFixed(5)},${l[k - 1][1].toFixed(5)}>${l[k][0].toFixed(5)},${l[k][1].toFixed(5)}`;
              if (t.edges.has(e)) continue;
              t.edges.add(e);
              if (!fresh.length) fresh.push(l[k - 1]);
              fresh.push(l[k]);
            }
            if (fresh.length > 1) {
              const km = lengthKm([fresh]);
              t.lines.push(fresh);
              if (uses.hiking) t.hiking += km;
              if (uses.mtb) t.mtb += km;
            }
          }
          const d = mtbDifficulty(f.p);
          const rank = ["easy", "intermediate", "difficult", "extreme"];
          if (d && (!t.difficulty || rank.indexOf(d) > rank.indexOf(t.difficulty))) t.difficulty = d;
          t.operator ??= typeof f.p.operator === "string" ? f.p.operator : null;
          t.surface ??= typeof f.p.surface === "string" ? f.p.surface : null;
          osm.set(key, t);
        }
      }
    }
    // A named trail counts when it runs at least 150 m; a use counts when it covers most of that length.
    const osmTrails = [...osm.values()].map((t) => ({ ...t, km: lengthKm(t.lines) })).filter((t) => t.km >= 0.15).sort((a, b) => b.km - a.km);
    const osmSummary = (t: (typeof osmTrails)[number]) => ({
      id: `osm-${slug(p.name!)}-${slug(t.name)}`,
      name: t.name,
      miles: round(t.km / 1.609344, 2),
      difficulty: t.difficulty,
      onMountain: true,
      kmFromSkiArea: 0,
      surface: t.surface,
      operator: t.operator,
      dataSource: "openstreetmap",
      sourceUrl: "https://www.openstreetmap.org",
    });
    const osmHiking = osmTrails.filter((t) => t.hiking >= t.km * 0.5);
    const osmBiking = osmTrails.filter((t) => t.mtb >= t.km * 0.5);

    // Summer trails a resort publishes (names and stated lengths, no line).
    const resort = resortTrails.find((r) => norm(r.resort) && (norm(p.name!).includes(norm(r.resort)) || norm(r.resort).includes(norm(p.name!))) && Math.abs(r.baseLatitude - lat) < 0.3 && Math.abs(r.baseLongitude - lng) < 0.3);
    const resortListed = resort?.trails.map((t) => ({ name: t.name, miles: t.miles, difficulty: t.difficulty, use: t.use, source: resort.sourceUrl })) ?? [];
    const resortBike = resortListed.filter((t) => /bike/i.test(t.use));

    const skiRuns = runs.map((r) => ({ name: r.name, difficulty: r.difficulty, uses: r.uses, lengthKm: round(lengthKm(r.lines), 2) }));
    const byDifficulty: Record<string, number> = {};
    for (const r of runs) if (r.uses.includes("downhill")) byDifficulty[r.difficulty ?? "unknown"] = (byDifficulty[r.difficulty ?? "unknown"] ?? 0) + 1;
    const place = p.places?.[0];
    let file = `${slug(p.name!)}-${p.id.slice(0, 6)}`;
    while (used.has(file)) file += "x";
    used.add(file);

    const entry = {
      id: p.id,
      slug: file,
      name: p.name,
      country: place?.iso3166_1Alpha2 ?? null,
      countryName: (place?.localized?.en as { country?: string } | undefined)?.country ?? null,
      region: place?.localized?.en?.region ?? null,
      locality: place?.localized?.en?.locality ?? null,
      latitude: round(lat),
      longitude: round(lng),
      bounds: box.map((v) => round(v)),
      website: p.websites?.[0] ?? null,
      skiTypes: p.activities,
      elevationFt: { min: ft(p.statistics?.runs?.minElevation), max: ft(p.statistics?.runs?.maxElevation) },
      lifts: Object.values(p.statistics?.lifts?.byType ?? {}).reduce((n, t) => n + t.count, 0),
      counts: {
        skiRuns: runs.length,
        downhillByDifficulty: byDifficulty,
        nordicRuns: runs.filter((r) => r.uses.includes("nordic")).length,
        hikingOnMountain: hiking.filter((f) => f.km === 0).length + osmHiking.length,
        hikingNearby: hiking.filter((f) => f.km > 0).length,
        mountainBikingOnMountain: biking.filter((f) => f.km === 0).length + osmBiking.length,
        mountainBikingNearby: biking.filter((f) => f.km > 0).length,
        resortListedSummerTrails: resortListed.length,
      },
      notes: [
        ...(runs.length || outline.length > 1 ? [] : ["No ski runs are mapped for this area in OpenStreetMap; its footprint is a 1.5 km box around the base."]),
        ...(hiking.length || osmHiking.length || resortListed.length ? [] : [`No mapped hiking trails within ${NEARBY_KM} km.`]),
        ...(biking.length || osmBiking.length || resortBike.length ? [] : [`No mapped mountain-bike trails within ${NEARBY_KM} km.`]),
        ...(unreadTiles ? [`${unreadTiles} OpenStreetMap map tiles couldn’t be read; some on-mountain trails may be missing.`] : []),
        ...(tiles.length > MAX_TILES ? ["Large area: only part of it was scanned for OpenStreetMap trails."] : []),
      ],
      file: `areas/${file}.json`,
    };
    index.push(entry);

    const feature = (kind: string, props: Record<string, unknown>, lines: Lines) => ({
      type: "Feature",
      properties: { kind, ...props },
      geometry: { type: "MultiLineString", coordinates: lines.map((l) => simplifyLine(l, TOLERANCE).map(([x, y]) => [round(x), round(y)])).filter((l) => l.length > 1) },
    });
    const detail = {
      ...entry,
      skiRuns,
      hiking: [...hiking.filter((f) => f.km === 0).map(summary), ...osmHiking.map(osmSummary), ...hiking.filter((f) => f.km > 0).map(summary)],
      mountainBiking: [...biking.filter((f) => f.km === 0).map(summary), ...osmBiking.map(osmSummary), ...biking.filter((f) => f.km > 0).map(summary)],
      resortListedSummerTrails: resortListed,
      geojson: {
        type: "FeatureCollection",
        features: [
          ...runs.map((r) => feature("ski-run", { name: r.name, difficulty: r.difficulty, uses: r.uses }, r.lines)),
          ...hiking.map((f) => feature("hiking", { id: f.row.id, name: f.row.name, miles: f.row.miles, onMountain: f.km === 0 }, f.lines)),
          ...biking.map((f) => feature("mountain-biking", { id: f.row.id, name: f.row.name, miles: f.row.miles, onMountain: f.km === 0 }, f.lines)),
          ...osmHiking.map((t) => feature("hiking", { id: osmSummary(t).id, name: t.name, miles: osmSummary(t).miles, onMountain: true, source: "openstreetmap" }, t.lines)),
          ...osmBiking.map((t) => feature("mountain-biking", { id: osmSummary(t).id, name: t.name, miles: osmSummary(t).miles, difficulty: t.difficulty, onMountain: true, source: "openstreetmap" }, t.lines)),
        ],
      },
    };
    await writeFile(path.join(out, entry.file), JSON.stringify(detail));

    totals.areas++;
    if (runs.length) totals.withRuns++;
    if (hiking.length || osmHiking.length || resortListed.length) totals.withHiking++;
    if (biking.length || osmBiking.length || resortBike.length) totals.withMtb++;
    if (hiking.some((f) => f.km === 0) || osmHiking.length || resortListed.length) totals.withHikingOnMountain++;
    if (biking.some((f) => f.km === 0) || osmBiking.length || resortBike.length) totals.withMtbOnMountain++;
    if (totals.areas % 100 === 0) console.log(`  ${totals.areas} areas`);
  };
  // A few areas at a time: tile downloads dominate and the tile server is shared.
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < areas.length) await processArea(areas[next++]); }));

  (index as { name: string }[]).sort((a, b) => a.name.localeCompare(b.name));
  const generatedAt = new Date().toISOString();
  await writeFile(path.join(out, "ski-areas.json"), JSON.stringify({ generatedAt, totals, sources: SOURCES, areas: index }, null, 1));
  await writeFile(path.join(out, "README.md"), readme(totals, generatedAt));
  await writeFile(path.join(out, "LOVABLE_PROMPT.md"), PROMPT);
  const zip = path.join(root, "exports/hyked-ski-areas.zip");
  await rm(zip, { force: true });
  execFileSync("zip", ["-qr9", zip, "."], { cwd: out });
  console.log(totals);
  console.log(`Wrote ${zip}`);
}

const SOURCES = [
  { data: "Ski areas and ski runs", name: "OpenSkiMap (OpenStreetMap)", url: "https://openskimap.org", license: "ODbL 1.0 — © OpenStreetMap contributors" },
  { data: "On-mountain hiking and bike-park trails", name: "OpenStreetMap via OpenStreetMap US trail tiles", url: "https://www.openstreetmap.org", license: "ODbL 1.0 — © OpenStreetMap contributors" },
  { data: "Hiking and mountain-bike trails", name: "Hyked trail catalog: USGS National Digital Trails, NPS, USFS, BLM, Parks Canada, Ontario", url: "https://github.com/tackleguy/health", license: "U.S. federal data public domain; Parks Canada and Ontario under the Open Government Licence" },
  { data: "Resort-listed summer trails", name: "Ski resorts' own summer trail pages and maps (names and stated lengths)", url: "see each trail's source", license: "facts only (names, lengths)" },
];

function readme(t: Record<string, number>, generatedAt: string) {
  return `# Hyked ski-area pack

Generated ${generatedAt}. ${t.areas} operating ski areas worldwide (downhill and Nordic), each with its ski runs and the hiking and mountain-bike trails on the mountain, plus, in the United States and Canada, official trails within ${NEARBY_KM} km.

Outside the U.S. and Canada, summer trails come from OpenStreetMap only (named trails inside the ski area), so coverage follows how well each resort is mapped.

| | areas |
|---|---|
| with mapped ski runs | ${t.withRuns} |
| with hiking (on the mountain or nearby, incl. resort-listed) | ${t.withHiking} |
| with hiking on the mountain itself | ${t.withHikingOnMountain} |
| with mountain biking (on the mountain or nearby) | ${t.withMtb} |
| with mountain biking on the mountain itself | ${t.withMtbOnMountain} |

Nothing is made up. Where no trail is mapped, the lists are empty and \`notes\` says so; show that honestly instead of hiding the area.

## Files
- \`ski-areas.json\` — \`{ generatedAt, totals, sources, areas[] }\`. Each area: \`id, slug, name, country, region, locality, latitude, longitude, bounds [w,s,e,n], website, skiTypes, elevationFt {min,max}, lifts, counts, notes, file\`.
- \`areas/<slug>.json\` — one area in full: everything above plus
  - \`skiRuns[]\`: \`name, difficulty (novice|easy|intermediate|advanced|expert|freeride|extreme|null), uses (downhill|nordic|…), lengthKm\`
  - \`hiking[]\` and \`mountainBiking[]\`: on-mountain trails first, then the ${NEARBY_LIMIT} nearest. Each has \`id, name, miles, difficulty, onMountain, kmFromSkiArea, dataSource, sourceUrl\`.
    - \`dataSource: "official"\` (Hyked catalog: USGS, USFS, NPS, BLM…): also \`routeType, sections, allowedUses, manager\`; difficulty is easy|moderate|hard|expert; the \`id\` works with the Hyked API.
    - \`dataSource: "openstreetmap"\`: named OSM trails inside the ski area (bike-park and summer trails); difficulty for bike trails is easy|intermediate|difficult|extreme from the OSM \`mtb:scale\`, else null; \`surface\`, \`operator\` when tagged. Not in the Hyked API — the line is in this file's geojson.
  - \`resortListedSummerTrails[]\`: \`name, miles, difficulty, use, source\` (no line)
  - \`geojson\`: a FeatureCollection of MultiLineStrings with \`properties.kind\` = \`ski-run\` | \`hiking\` | \`mountain-biking\` (a trail open to both appears in both).
- Trail \`id\`s match the Hyked API: \`GET /api/trail-catalog/{encodeURIComponent(id)}\` for full details, elevation, water and downloads.

## Sources and licences
${SOURCES.map((s) => `- ${s.data}: ${s.name} (${s.url}) — ${s.license}`).join("\n")}

Show "© OpenStreetMap contributors" wherever ski runs are displayed.
`;
}

const PROMPT = `Add ski areas to Hyked using the attached pack (unzip into \`public/ski-areas/\`; read its README.md).

- New page \`/ski-areas\`: search and filter the list from \`/ski-areas/ski-areas.json\` (country, region, Downhill/Nordic, "has hiking", "has mountain biking"), plus a map of all areas (MapLibre, one pin each).
- New page \`/ski-areas/:slug\`: load \`/ski-areas/areas/<slug>.json\`. Header with name, region, website, elevation range, lift and run counts. Three tabs — **Skiing**, **Hiking**, **Mountain biking** — each with a list and a map drawn from \`geojson\` filtered by \`properties.kind\` (ski runs coloured by difficulty: green easy, blue intermediate, black advanced/expert; hiking and biking trails in Hyked's trail colours). Mark "On the mountain" vs "Nearby · X km". Show resort-listed summer trails under Hiking (and under Mountain biking when their \`use\` includes "bike") with their source link. Label OpenStreetMap trails "OpenStreetMap" and official ones by their \`manager\`. When a list is empty, show the area's \`notes\` text, never placeholder trails.
- Tapping a hiking or biking trail opens the existing trail page for that \`id\`.
- Show "Ski runs © OpenStreetMap contributors (OpenSkiMap)" under every ski map.
`;

main().catch((e) => { console.error(e); process.exitCode = 1; });
