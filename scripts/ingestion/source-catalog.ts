/** Resumable, sequential snapshot of public USGS and Parks Canada trail features.
 * Raw responses are cached locally; output is a bounded server-side catalog.
 * Run with npm run source:trails. Use --refresh to fetch a new source snapshot.
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import type { CatalogManifest, CatalogTrail } from "../../src/lib/trail-catalog/types";
import { JOIN_METERS, mergeCatalogSections } from "../../src/lib/trail-catalog/merge";
import { auditCatalog } from "../../src/lib/trail-catalog/audit";
import { QUALITY_RULES, isPlaceholderName } from "../../src/lib/trail-catalog/quality";
import { PisteIndex, matchSkiRun, type SkiRunCache } from "../../src/lib/trail-catalog/ski-runs";
import { TrailheadIndex, trailEnds, type TrailheadCache } from "../../src/lib/trail-catalog/access";
import { BLM_LAYERS, DUPLICATE_SHARE, blmUses, LineIndex, NPS_WHERE, USFS_HIKING_WHERE, USFS_NO_HIKING_WHERE, classifyTerrain, pointsAlong } from "../../src/lib/trail-catalog/additions";
import { namesAgree } from "../../src/lib/trail-catalog/verify";
import { confidenceFor, normalizeSeason, sourceTypeFor, titleCaseName, trailStatusFor, trailTypeFor, usfsUses, type SourceRef, type SourceType } from "../../src/lib/trail-catalog/agencies";

const root = process.cwd();
const output = path.join(root, "data/trail-catalog");
const cache = path.join(root, ".cache/trail-catalog");
/** Guards against publishing a snapshot from a truncated source response. */
const minimumSections = 450_000;
/** Standalone trails shorter than this (~80 m) are mapping fragments, not hikes. */
const minimumTrailMiles = QUALITY_RULES.minimumTrailMiles;
const refresh = process.argv.includes("--refresh");
const USGS = "https://carto.nationalmap.gov/arcgis/rest/services/transportation/MapServer/37";
const CANADA = "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/Trails_Sentiers_APCA_Temporary_Temporaire_APCA_OpenOuvert/FeatureServer/0";
const USFS = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublish_01/MapServer/0";
const USFS_FORESTS = "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_ForestSystemBoundaries_01/MapServer/0";
const BLM = "https://gis.blm.gov/arcgis/rest/services/transportation/BLM_Natl_GTLF_Public_Display/MapServer";
const NPS = "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer/0";
const ONTARIO = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open04/MapServer/19";
/** Named USGS trail sections plus unnamed sections tagged for hikers. */
const USGS_WHERE =
  "(name IS NOT NULL AND name <> '') OR hikerpedestrian = 'Y'";
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
type Point = [number, number];
type Feature = { attributes: Record<string, string | number | null>; geometry?: { paths: Point[][] } };
type ResponseData = { features?: Feature[]; exceededTransferLimit?: boolean; error?: { message: string }; retrievedAt: string };
type Region = { properties: { name: string; admin: string }; geometry: { type: string; coordinates: number[][][] | number[][][][] } };
const boundaries: { name: string; country: string; rings: number[][][]; bounds: number[] }[] = [];
const excluded: Record<string, number> = { missingName: 0, invalidGeometry: 0, duplicateId: 0, duplicateGeometry: 0, tooShort: 0, npsAlreadyListed: 0, npsTooShort: 0, npsNotMountain: 0, agencyConfirmedExisting: 0 };
const AGENCIES = ["nps", "usfs", "blm"] as const;
type AgencyKey = typeof AGENCIES[number];
const shardOf = (id: string) => (parseInt(hash(id).slice(0, 2), 16)%64).toString().padStart(2, "0");

function inside(point: Point, ring: number[][]) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [xj, yj] = ring[j];
    if ((y > point[1]) !== (yj > point[1]) && point[0] < (xj-x)*(point[1]-y)/(yj-y)+x) result = !result;
  }
  return result;
}
/** Generalized 1:50m coastlines and borders leave shoreline and border trails just outside every polygon. */
const NEAREST_REGION_DEGREES = 0.25;
function distanceToRing(point: Point, ring: number[][]) {
  const k = Math.cos(point[1] * Math.PI / 180);
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const ax = ring[i-1][0]*k, ay = ring[i-1][1], bx = ring[i][0]*k, by = ring[i][1], px = point[0]*k, py = point[1];
    const dx = bx-ax, dy = by-ay, l = dx*dx+dy*dy;
    const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((px-ax)*dx+(py-ay)*dy)/l));
    best = Math.min(best, Math.hypot(px-(ax+t*dx), py-(ay+t*dy)));
  }
  return best;
}
function regionAt(point: Point, country: string) {
  const containing = boundaries.find(b => b.country === country && point[0] >= b.bounds[0] && point[1] >= b.bounds[1] && point[0] <= b.bounds[2] && point[1] <= b.bounds[3] && inside(point, b.rings[0]) && !b.rings.slice(1).some(r => inside(point, r)));
  if (containing) return containing.name;
  // Otherwise the nearest state/province of the same country within ~25 km.
  let nearest: string | null = null, best = NEAREST_REGION_DEGREES;
  for (const b of boundaries) {
    if (b.country !== country || point[0] < b.bounds[0]-best || point[0] > b.bounds[2]+best || point[1] < b.bounds[1]-best || point[1] > b.bounds[3]+best) continue;
    const d = distanceToRing(point, b.rings[0]);
    if (d < best) { best = d; nearest = b.name; }
  }
  return nearest;
}
const str = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
function safeUrl(v: unknown) { try { const url = new URL(String(v)); return url.protocol === "https:" ? url.href : null; } catch { return null; } }
async function fetchPage(url: string, key: string): Promise<ResponseData> {
  const filename = path.join(cache, `${key}.json.gz`);
  if (!refresh) { try { return JSON.parse(gunzipSync(await readFile(filename)).toString()); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "Hyked/1.0 (https://github.com/tackleguy/health)" }, signal: AbortSignal.timeout(90_000) });
      if (!response.ok) {
        if (response.status === 429) {
          const retry = response.headers.get("retry-after");
          const seconds = Number(retry);
          const wait = retry ? (Number.isFinite(seconds) ? seconds*1000 : Date.parse(retry)-Date.now()) : 60_000;
          if (wait > 300_000) throw new Error(`Rate limited until ${retry}. Rerun later to resume.`);
          await new Promise(resolve => setTimeout(resolve, Math.max(1000, wait || 60_000)));
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json() as ResponseData;
      if (data.error || !Array.isArray(data.features)) throw new Error(data.error?.message ?? "Source returned no feature list");
      data.retrievedAt = new Date().toISOString();
      await writeFile(`${filename}.tmp`, gzipSync(JSON.stringify(data)));
      await rename(`${filename}.tmp`, filename);
      return data;
    } catch (error) {
      if (attempt === 3) throw error;
      console.warn(`Retry ${key}: ${String(error)}`);
      await new Promise(resolve => setTimeout(resolve, 2000*2**attempt));
    }
  }
  throw new Error("Unreachable");
}

type MergedTrailRef = ReturnType<typeof mergeCatalogSections>[number];
const pointKey = (p: Point) => `${p[1].toFixed(4)},${p[0].toFixed(4)}`;
/** Ground elevations (m) from Open-Meteo's Copernicus DEM, 100 points per request, cached on disk.
 * Lookups stop after ELEVATION_BUDGET_MS; cached points carry over, so each rebuild fills in more. */
const ELEVATION_BUDGET_MS = 6 * 60_000;
async function elevationsFor(points: Point[]) {
  const deadline = Date.now() + ELEVATION_BUDGET_MS;
  const file = path.join(root, ".cache/elevation/points.json");
  await mkdir(path.dirname(file), { recursive: true });
  let known: Record<string, number> = {};
  try { known = JSON.parse(await readFile(file, "utf8")); } catch { /* first run */ }
  const missing = [...new Set(points.map(pointKey))].filter(k => !(k in known));
  for (let i = 0; i < missing.length; i += 100) {
    if (Date.now() > deadline) { console.log(`Elevation: time budget reached; ${missing.length - i} points left for the next rebuild`); break; }
    const batch = missing.slice(i, i+100);
    const url = `https://api.open-meteo.com/v1/elevation?${new URLSearchParams({ latitude: batch.map(k => k.split(",")[0]).join(","), longitude: batch.map(k => k.split(",")[1]).join(",") })}`;
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (response?.ok) { const data = await response.json() as { elevation: number[] }; batch.forEach((k, j) => { known[k] = data.elevation[j]; }); break; }
      if (attempt === 3 || Date.now() > deadline) break;
      await new Promise(r => setTimeout(r, 5000 * 2**attempt));
    }
    if ((i/100) % 20 === 19) { await writeFile(file, JSON.stringify(known)); console.log(`Elevation: ${Math.min(i+100, missing.length)}/${missing.length} points`); }
    await new Promise(r => setTimeout(r, 250));
  }
  await writeFile(file, JSON.stringify(known));
  return new Map(Object.entries(known));
}

async function main() {
  await mkdir(cache, { recursive: true }); await mkdir(output, { recursive: true });
  const geo = JSON.parse(await readFile(path.join(output, "regions.geojson"), "utf8")) as { features: Region[] };
  for (const f of geo.features) {
    const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates as number[][][]] : f.geometry.coordinates as number[][][][];
    for (const rings of polygons) {
      const points = rings[0];
      boundaries.push({ name: f.properties.name, country: f.properties.admin === "Canada" ? "CA" : "US", rings, bounds: [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))] });
    }
  }
  const rows: CatalogTrail[] = [], geometries = new Map<string, Point[][]>();
  // USGS is imported before the agency datasets so existing trail ids stay stable; an agency record that
  // exactly repeats a line already imported confirms it instead of replacing it.
  const ids = new Set<string>(), shapes = new Map<string, string>();
  const exactAgencyDuplicates: { row: CatalogTrail; of: string }[] = [];
  const sources: CatalogManifest["sources"] = [];
  const sourcesToImport = [
    { key: "parks-canada" as const, country: "CA" as const, endpoint: CANADA, where: "1=1", fields: "*", idField: "OBJECTID", name: "Parks Canada — Trails APCA", license: "Open Government Licence – Canada", url: "https://open.canada.ca/data/en/dataset/64a90e8d-5bc0-4027-8645-b5881b4068d4" },
    { key: "ontario" as const, country: "CA" as const, endpoint: ONTARIO, where: "TRAIL_NAME IS NOT NULL", fields: "OBJECTID,OGF_ID,TRAIL_NAME,TRAIL_ASSOCIATION,TRAIL_ASSOCIATION_WEBSITE,TRAIL_LENGTH_KM,EFFECTIVE_DATETIME", idField: "OBJECTID", name: "Ontario Trail Network — Trail Segment", license: "Open Government Licence – Ontario", url: "https://data.ontario.ca/en/dataset/ontario-trail-network" },
    { key: "usgs" as const, country: "US" as const, endpoint: USGS, where: USGS_WHERE, fields: "objectid,permanentidentifier,name,lengthmiles,pets,sourceoriginator,sourceeditdate,trailsurface,seasonopen", idField: "objectid", name: "USGS National Transportation Dataset — Trails", license: "Public domain", url: "https://www.usgs.gov/national-digital-trails/how-access-or-view-usgs-trails-dataset" },
    { key: "usfs" as const, country: "US" as const, endpoint: USFS, where: USFS_HIKING_WHERE, fields: "objectid,trail_cn,bmp,trail_no,trail_name,managing_org,trail_class,allowed_terra_use,trail_surface,national_trail_designation,accessibility_status,gis_miles", idField: "objectid", name: "U.S. Forest Service — National Forest System Trails (land trails open to hikers)", license: "Public domain", url: "https://data.fs.usda.gov/geodata/edw/datasets.php" },
    { key: "blm" as const, country: "US" as const, endpoint: BLM, layers: BLM_LAYERS.map(l => ({ endpoint: `${BLM}/${l.layer}`, where: l.where, fields: l.fields, layer: l.layer })), where: "non-motorized and non-mechanized public trails", fields: "OBJECTID,GlobalID,ROUTE_PRMRY_NM,ADMIN_ST,PLAN_MODE_TRNSPRT,PLAN_ACCESS_RSTRCT,PLAN_SEASON_RSTRCT_CODE,OBSRVE_SRFCE_TYPE,ROUTE_SPCL_DSGNTN_TYPE", idField: "OBJECTID", name: "Bureau of Land Management — Ground Transportation Linear Features (trails managed for non-motorized public use)", license: "Public domain", url: "https://gbp-blm-egis.hub.arcgis.com/" },
    { key: "nps" as const, country: "US" as const, endpoint: NPS, where: NPS_WHERE, fields: "OBJECTID,GEOMETRYID,TRLNAME,TRLSURFACE,SEASONAL,SEASDESC,UNITCODE,UNITNAME,EDITDATE", idField: "OBJECTID", name: "National Park Service — Public Trails (existing, official trails; mountain trails ≥0.3 mi not already listed)", license: "Public domain", url: "https://public-nps.opendata.arcgis.com/" },
  ];
  // USFS forest names by org code ("0301" → "Carson National Forest").
  const forestNames = new Map<string, string>();
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({ f: "json", where: "1=1", outFields: "FORESTORGCODE,FORESTNAME", returnGeometry: "false", orderByFields: "FORESTORGCODE ASC", resultOffset: String(offset), resultRecordCount: "1000" });
    const data = await fetchPage(`${USFS_FORESTS}/query?${query}`, `usfs-forests-${offset}`);
    for (const f of data.features!) forestNames.set(String(f.attributes.forestorgcode ?? f.attributes.FORESTORGCODE), String(f.attributes.forestname ?? f.attributes.FORESTNAME));
    if (!data.exceededTransferLimit || !data.features!.length) break;
  }
  const discovered: Record<AgencyKey, { areas: Set<string>; lines: number; retrievedAt: string }> = { nps: { areas: new Set(), lines: 0, retrievedAt: "" }, usfs: { areas: new Set(), lines: 0, retrievedAt: "" }, blm: { areas: new Set(), lines: 0, retrievedAt: "" } };
  for (const source of sourcesToImport) {
    const before = rows.length; let retrievedAt = "";
    for (const layer of ("layers" in source && source.layers) ? source.layers : [{ endpoint: source.endpoint, where: source.where, fields: source.fields, layer: 0 }])
    for (let offset = 0; ; offset += 1000) {
      const query = new URLSearchParams({ f: "json", where: layer.where, outFields: layer.fields, returnGeometry: "true", outSR: "4326", geometryPrecision: "5", maxAllowableOffset: "0.0001", orderByFields: `${source.idField} ASC`, resultOffset: String(offset), resultRecordCount: "1000" });
      const data = await fetchPage(`${layer.endpoint}/query?${query}`, `${source.key}-${offset}-${hash(layer.endpoint === source.endpoint ? query.toString() : layer.endpoint + query.toString()).slice(0, 8)}`);
      retrievedAt = data.retrievedAt;
      for (const f of data.features!) {
        const a = f.attributes;
        const rawName = str(source.key === "ontario" ? a.TRAIL_NAME : source.key === "nps" ? a.TRLNAME : source.key === "usfs" ? a.trail_name : source.key === "blm" ? a.ROUTE_PRMRY_NM : source.country === "CA" ? a.Name_Official_e ?? a.Nom_Officiel_f : a.name);
        const named = rawName && (source.key === "usfs" || source.key === "blm") ? titleCaseName(rawName) : rawName;
        // Placeholder names ("-", "<unnamed>", "Unknown") are not trail names; they are labeled and never merged.
        const placeholder = named !== null && isPlaceholderName(named);
        const name = named && !placeholder ? named : (source.key === "usgs" || placeholder ? "Unnamed trail" : null);
        if (!name) { excluded.missingName++; continue; }
        const lines = f.geometry?.paths;
        if (!lines?.length || lines.some(line => line.length < 2 || line.some(p => p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90))) { excluded.invalidGeometry++; continue; }
        const sourceId = source.key === "ontario" ? String(a.OGF_ID) : source.key === "nps" ? str(a.GEOMETRYID)?.replace(/[{}]/g, "").toLowerCase() ?? null : source.key === "usfs" ? (str(a.trail_cn) ? `${a.trail_cn}-${Number(a.bmp ?? 0).toFixed(3)}` : null) : source.key === "blm" ? (str(a.GlobalID)?.replace(/[{}]/g, "").toLowerCase() ?? `l${layer.layer}-${a.OBJECTID}`) : source.country === "US" ? str(a.permanentidentifier) : String(a.OBJECTID);
        if (!sourceId) throw new Error("Missing source identifier");
        const id = `${source.key}-${sourceId}`;
        if (ids.has(id)) { excluded.duplicateId++; continue; }
        const signature = hash(JSON.stringify([source.country, name.toLowerCase(), lines]));
        const duplicateOf = shapes.get(signature);
        const agencyRecord = source.key === "nps" || source.key === "usfs" || source.key === "blm";
        if (duplicateOf && !agencyRecord) { excluded.duplicateGeometry++; continue; }
        ids.add(id); if (!duplicateOf) shapes.set(signature, id);
        const point = lines[0][Math.floor(lines[0].length/2)];
        const geometryShard = shardOf(id);
        const reportedMiles = source.key === "ontario" && typeof a.TRAIL_LENGTH_KM === "number" ? a.TRAIL_LENGTH_KM/1.609344 : a.lengthmiles;
        const suppliedMiles = typeof reportedMiles === "number" && reportedMiles > 0 ? reportedMiles : null;
        const sourceTimestamp = source.key === "ontario" ? a.EFFECTIVE_DATETIME : source.key === "nps" ? a.EDITDATE : source.key === "usfs" || source.key === "blm" ? null : a.sourceeditdate;
        const metersDate = typeof sourceTimestamp === "number" ? sourceTimestamp : null;
        rows.push({ id, name, country: source.country, region: regionAt(point, source.country), kind: "segment", miles: suppliedMiles, distanceBasis: suppliedMiles !== null ? "source" : "geometry", latitude: point[1], longitude: point[0], difficulty: source.country === "CA" ? ({ 1: "Easy", 2: "Moderate", 3: "Difficult", 4: "Most difficult" }[Number(a["Summer_Classification_Été"]) as 1|2|3|4] ?? null) : null, dogs: a.pets === "Y" ? true : a.pets === "N" ? false : null, source: source.key, sourceId, sourceUrl: `${layer.endpoint}/query?${new URLSearchParams({ where: `${source.idField}=${a[source.idField]}`, outFields: "*", f: "pjson" })}`, officialUrl: safeUrl(a.URL_e ?? a.URL_f), sourceDate: metersDate !== null ? new Date(metersDate).toISOString() : null, manager: source.country === "CA" ? "Parks Canada" : str(a.sourceoriginator), surface: source.country === "US" ? str(a.trailsurface) : ({1:"Natural",2:"Gravel",3:"Boardwalk",4:"Asphalt",5:"Wood chip",6:"Water",7:"Concrete",8:"Stairs"}[Number(a.Surface) as 1] ?? null), season: normalizeSeason(str(a.seasonopen)), geometryShard });
        if (source.key === "ontario") {
          const row = rows[rows.length-1];
          row.region = "Ontario";
          row.manager = str(a.TRAIL_ASSOCIATION) ?? "Ontario Trail Network";
          row.officialUrl = safeUrl(a.TRAIL_ASSOCIATION_WEBSITE);
        }
        if (source.key === "nps") {
          const row = rows[rows.length-1];
          const unit = str(a.UNITCODE)?.toLowerCase();
          row.manager = str(a.UNITNAME) ? `National Park Service — ${a.UNITNAME}` : "National Park Service";
          row.officialUrl = unit && /^[a-z]{4}$/.test(unit) ? `https://www.nps.gov/${unit}/planyourvisit/hiking.htm` : null;
          row.surface = str(a.TRLSURFACE) && a.TRLSURFACE !== "Unknown" ? String(a.TRLSURFACE) : null;
          row.season = a.SEASONAL === "Yes" ? (str(a.SEASDESC) ?? "Seasonal") : null;
          row.sourceUrl = `${NPS}/query?${new URLSearchParams({ where: `GEOMETRYID='${a.GEOMETRYID}'`, outFields: "*", f: "pjson" })}`;
        }
        if (source.key === "nps") {
          const row = rows[rows.length-1];
          if (str(a.UNITNAME)) row.park = String(a.UNITNAME);
          discovered.nps.areas.add(String(a.UNITCODE ?? ""));
          if (a.TRLSTATUS === "Temporarily Closed") row.trailStatus = "CLOSED";
        }
        if (source.key === "usfs") {
          const row = rows[rows.length-1];
          const forest = forestNames.get(String(a.managing_org ?? "").slice(0, 4));
          row.manager = forest ? `U.S. Forest Service — ${forest}` : "U.S. Forest Service";
          if (forest) row.forest = forest;
          if (str(a.trail_no)) row.officialTrailId = String(a.trail_no);
          row.uses = usfsUses(a.allowed_terra_use);
          row.surface = str(a.trail_surface);
          row.season = null;
          discovered.usfs.areas.add(String(a.managing_org ?? "").slice(0, 4));
        }
        if (source.key === "blm") {
          const row = rows[rows.length-1];
          row.manager = "Bureau of Land Management";
          row.blmArea = `BLM ${a.ADMIN_ST ?? ""}`.trim();
          row.surface = str(a.OBSRVE_SRFCE_TYPE);
          row.season = a.PLAN_SEASON_RSTRCT_CODE && a.PLAN_SEASON_RSTRCT_CODE !== "NO" ? "Seasonal restrictions" : null;
          row.uses = blmUses(a);
          if (a.PLAN_ACCESS_RSTRCT && a.PLAN_ACCESS_RSTRCT !== "None") row.trailStatus = "RESTRICTED";
          discovered.blm.areas.add(String(a.ADMIN_ST ?? ""));
        }
        if (source.key === "nps" || source.key === "usfs" || source.key === "blm") { discovered[source.key].lines++; discovered[source.key].retrievedAt = data.retrievedAt; }
        if (placeholder) rows[rows.length-1].originalName = named!;
        geometries.set(id, lines);
        if (duplicateOf) { exactAgencyDuplicates.push({ row: rows.pop()!, of: duplicateOf }); geometries.delete(id); excluded.duplicateGeometry++; }
      }
      console.log(`${source.key}: ${offset+data.features!.length} fetched; ${rows.length.toLocaleString()} accepted total`);
      if (!data.exceededTransferLimit || data.features!.length === 0) break;
    }
    sources.push({ key: source.key, name: source.name, url: source.url, license: source.license, count: rows.length-before, query: source.where, retrievedAt });
  }
  // Agency lines (NPS, USFS, BLM) that repeat a line already in the catalog are not new trails: they
  // confirm that trail and are attached to it as sources. Only lines nobody has mapped are added.
  const confirmations = new Map<string, SourceRef[]>();
  const refFor = (row: CatalogTrail): SourceRef => ({ type: sourceTypeFor(row), id: row.sourceId, url: row.sourceUrl, name: row.name, ...(row.officialTrailId ? { officialTrailId: row.officialTrailId } : {}), ...((row.park ?? row.forest ?? row.blmArea) ? { unit: row.park ?? row.forest ?? row.blmArea } : {}) });
  const added: Record<AgencyKey, number> = { nps: 0, usfs: 0, blm: 0 };
  for (const { row, of } of exactAgencyDuplicates) (confirmations.get(of) ?? confirmations.set(of, []).get(of)!).push(refFor(row));
  {
    const isAgency = (r: CatalogTrail) => (AGENCIES as readonly string[]).includes(r.source);
    const cell = (p: Point) => `${Math.floor(p[0]*4)}:${Math.floor(p[1]*4)}`;
    const touched = new Set(rows.filter(isAgency).flatMap(r => geometries.get(r.id)!.flat().map(cell)));
    const index = new LineIndex();
    for (const r of rows) if (!isAgency(r) && geometries.get(r.id)!.some(line => line.some(p => touched.has(cell(p))))) index.add(geometries.get(r.id)!, r.id);
    const drop = new Set<string>();
    for (const key of AGENCIES) {
      for (const r of rows.filter(r => r.source === key)) {
        const match = index.bestMatch(geometries.get(r.id)!);
        if (match.share >= DUPLICATE_SHARE && match.ownerId) {
          (confirmations.get(match.ownerId) ?? confirmations.set(match.ownerId, []).get(match.ownerId)!).push(refFor(r));
          drop.add(r.id);
        } else {
          index.add(geometries.get(r.id)!, r.id);
          added[key]++;
        }
      }
      console.log(`${key.toUpperCase()}: ${added[key]} new lines; ${rows.filter(r => r.source === key).length - added[key]} confirm lines already in the catalog`);
    }
    excluded.agencyConfirmedExisting = drop.size;
    for (let i = rows.length-1; i >= 0; i--) if (drop.has(rows[i].id)) { geometries.delete(rows[i].id); rows.splice(i, 1); }
  }
  // USFS land trails where hiking is not an allowed use: catalog lines on them are not hiking trails.
  const noHiking = new LineIndex();
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({ f: "json", where: USFS_NO_HIKING_WHERE, outFields: "objectid,trail_cn", returnGeometry: "true", outSR: "4326", geometryPrecision: "5", maxAllowableOffset: "0.0001", orderByFields: "objectid ASC", resultOffset: String(offset), resultRecordCount: "1000" });
    const data = await fetchPage(`${USFS}/query?${query}`, `usfs-nohike-${offset}-${hash(query.toString()).slice(0, 8)}`);
    for (const f of data.features!) if (f.geometry?.paths?.length) noHiking.add(f.geometry.paths, String(f.attributes.trail_cn));
    if (!data.exceededTransferLimit || !data.features!.length) break;
  }
  if (rows.length < minimumSections) throw new Error(`Only ${rows.length} valid distinct sections. Catalog has not been replaced; expected at least ${minimumSections}.`);
  const merged = mergeCatalogSections(rows.map(row => ({ row, lines: geometries.get(row.id)! })), { regionAt });
  const trails: typeof merged = [];
  for (const trail of merged) {
    if ((trail.row.miles ?? 0) < minimumTrailMiles) { excluded.tooShort += trail.sectionIds.length; continue; }
    trail.row.geometryShard = shardOf(trail.row.id);
    trails.push(trail);
  }
  // Attach confirming official sources, and sample the elevation range of trails that only an agency maps.
  {
    const agencyOnly: MergedTrailRef[] = [];
    for (const trail of trails) {
      const refs = trail.sectionIds.flatMap(id => confirmations.get(id) ?? []);
      if (refs.length) {
        const unique = [...new Map(refs.map(r => [`${r.type}:${r.id}`, r])).values()];
        trail.row.sources = unique;
        trail.row.officialTrailId ??= unique.find(r => r.officialTrailId)?.officialTrailId;
        for (const r of unique) {
          if (r.type === "NPS_OFFICIAL" && r.unit) trail.row.park ??= r.unit;
          if (r.type === "USFS_OFFICIAL" && r.unit) trail.row.forest ??= r.unit;
          if (r.type === "BLM_OFFICIAL" && r.unit) trail.row.blmArea ??= r.unit;
        }
      }
      if (trail.sectionIds.every(id => /^(nps|usfs|blm)-/.test(id))) agencyOnly.push(trail);
    }
    const samples = agencyOnly.map(trail => ({ trail, along: pointsAlong(trail.lines, 10) }));
    const elevations = await elevationsFor(samples.flatMap(s => s.along));
    for (const { trail, along } of samples) {
      const terrain = classifyTerrain(along.map(p => elevations.get(pointKey(p)) ?? NaN), []);
      if (Number.isFinite(terrain.minMeters)) trail.row.elevationFt = { min: Math.round(terrain.minMeters*3.28084), max: Math.round(terrain.maxMeters*3.28084) };
    }
    console.log(`Agencies: ${agencyOnly.length} new trails made only of agency lines; ${trails.filter(t => t.row.sources?.length).length} existing trails confirmed by an agency dataset`);
  }
  // Pieces of one official Forest Service trail (same TRAIL_CN) are one trail, even across a mapping gap:
  // the agency's own record says they belong together. Names must still agree.
  let usfsJoined = 0;
  {
    const cnOf = (id: string) => id.replace(/-[0-9.]+$/, "");
    const parent = trails.map((_, i) => i);
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const firstForCn = new Map<string, number>();
    trails.forEach((trail, i) => {
      if (trail.row.kind === "route") return;
      const cns = new Set((trail.row.sources ?? []).filter(r => r.type === "USFS_OFFICIAL").map(r => cnOf(r.id)));
      if (trail.row.source === "usfs") cns.add(cnOf(trail.row.sourceId));
      for (const cn of cns) {
        const j = firstForCn.get(cn);
        if (j === undefined) { firstForCn.set(cn, i); continue; }
        if (namesAgree(trails[j].row.name, trail.row.name)) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
      }
    });
    const groups = new Map<number, number[]>();
    trails.forEach((_, i) => { const r = find(i); (groups.get(r) ?? groups.set(r, []).get(r)!).push(i); });
    const drop = new Set<number>();
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      members.sort((a, b) => (trails[b].row.miles ?? 0) - (trails[a].row.miles ?? 0));
      const host = trails[members[0]];
      for (const i of members.slice(1)) {
        const other = trails[i];
        host.lines.push(...other.lines);
        host.sectionIds.push(...other.sectionIds);
        host.row.miles = Math.round(((host.row.miles ?? 0) + (other.row.miles ?? 0)) * 1000) / 1000;
        host.row.distanceBasis = "geometry";
        host.row.sectionCount = (host.row.sectionCount ?? 1) + (other.row.sectionCount ?? 1);
        host.row.sources = [...new Map([...(host.row.sources ?? []), ...(other.row.sources ?? [])].map(r => [`${r.type}:${r.id}`, r])).values()];
        host.row.officialTrailId ??= other.row.officialTrailId;
        host.row.forest ??= other.row.forest;
        drop.add(i);
        usfsJoined++;
      }
    }
    for (let i = trails.length - 1; i >= 0; i--) if (drop.has(i)) trails.splice(i, 1);
    console.log(`USFS: joined ${usfsJoined} trail pieces into their official trail`);
  }
  trails.sort((a, b) => a.row.name.localeCompare(b.row.name) || a.row.id.localeCompare(b.row.id));
  // Records whose line follows OpenSkiMap pistes are ski runs, not hiking trails (npm run source:ski).
  let skiSource: CatalogManifest["sources"][number] | null = null;
  const winterCounts = { downhill: 0, nordic: 0 };
  try {
    const ski = JSON.parse(gunzipSync(await readFile(path.join(root, ".cache/ski/runs-na.json.gz"))).toString()) as SkiRunCache;
    const pistes = new PisteIndex(ski.runs);
    for (const trail of trails) {
      const match = matchSkiRun(trail.row.name, trail.lines, pistes);
      if (!match) continue;
      trail.row.winterUse = match.use;
      if (match.areaName) trail.row.skiArea = match.areaName;
      winterCounts[match.use]++;
    }
    skiSource = { name: "OpenSkiMap — ski runs (used to identify ski runs; not listed as trails)", url: "https://openskimap.org", license: "ODbL — © OpenStreetMap contributors", count: 0, query: `U.S./Canadian pistes; a record is a run when ≥60% of its line follows a piste`, retrievedAt: ski.retrievedAt };
    console.log(`Ski pistes: ${winterCounts.downhill} downhill runs, ${winterCounts.nordic} Nordic tracks`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    console.warn("No ski run cache; run npm run source:ski to identify ski runs.");
  }
  // Start points: the nearest mapped OSM trailhead to either end (npm run source:trailheads).
  let trailheadSource: CatalogManifest["sources"][number] | null = null;
  try {
    // The local cache (npm run source:trailheads) wins; the committed copy keeps rebuilds working when Overpass is down.
    const raw = await readFile(path.join(root, ".cache/trailheads/trailheads-na.json.gz")).catch(() => readFile(path.join(root, "data/sources/trailheads-na.json.gz")));
    const cached = JSON.parse(gunzipSync(raw).toString()) as TrailheadCache;
    const index = new TrailheadIndex(cached.trailheads);
    let matched = 0;
    for (const trail of trails) {
      const ends = trailEnds(trail.lines);
      const start = ends ? index.nearest(ends) : null;
      if (start) { trail.row.trailhead = start; matched++; }
    }
    trailheadSource = { name: "OpenStreetMap — trailheads (start points)", url: "https://www.openstreetmap.org/copyright", license: "ODbL — © OpenStreetMap contributors", count: 0, query: `highway=trailhead within 800 m of a trail end; ${matched.toLocaleString("en-US")} trails matched; OSM data as of ${cached.dataTimestamp ?? "unknown"}`, retrievedAt: cached.retrievedAt };
    console.log(`Trailheads: ${matched} trails have a mapped trailhead within 800 m`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    console.warn("No trailhead cache; run npm run source:trailheads to add start points.");
  }
  // Every published trail passes through the quality rules; the report ships with the snapshot.
  const audit = auditCatalog(trails.map(t => ({ row: t.row, lines: t.lines, reportedMiles: t.reportedMiles, sectionReportedMiles: t.sectionReportedMiles })));
  // Lines on USFS trails where hiking isn't allowed, then source type, confidence, trail type and status.
  let noHikingCount = 0;
  for (const trail of trails) {
    if (/^(nps|usfs|blm)$/.test(trail.row.source)) continue;
    if (noHiking.bestMatch(trail.lines).share >= DUPLICATE_SHARE) { trail.row.flags = [...(trail.row.flags ?? []), "no-hiking"]; noHikingCount++; }
  }
  if (noHikingCount) audit.byFlag["no-hiking"] = noHikingCount;
  const confidenceCounts: Record<string, number> = {};
  for (const { row } of trails) {
    row.sourceType = sourceTypeFor(row);
    row.confidence = confidenceFor(row);
    row.trailType = trailTypeFor(row);
    row.trailStatus = row.trailStatus ?? trailStatusFor(row);
    confidenceCounts[row.confidence] = (confidenceCounts[row.confidence] ?? 0) + 1;
  }
  console.log(`Confidence: ${JSON.stringify(confidenceCounts)}`);
  const coverage = Object.fromEntries(AGENCIES.map(key => {
    const own = trails.filter(t => t.row.source === key);
    const confirmed = trails.filter(t => t.row.sources?.some(r => r.type === ({ nps: "NPS_OFFICIAL", usfs: "USFS_OFFICIAL", blm: "BLM_OFFICIAL" } as Record<AgencyKey, SourceType>)[key])).length;
    return [key, { areasDiscovered: [...discovered[key].areas].filter(Boolean).length, areasProcessed: [...discovered[key].areas].filter(Boolean).length, linesDiscovered: discovered[key].lines, newLinesImported: added[key], trailsAdded: own.length, existingTrailsConfirmed: confirmed, needsReview: own.filter(t => t.row.confidence === "NEEDS_REVIEW").length, rejected: own.filter(t => t.row.confidence === "REJECTED").length, lastScan: discovered[key].retrievedAt }];
  }));
  console.log(`Coverage: ${JSON.stringify(coverage)}`);
  audit.excludedTooShort = excluded.tooShort;
  audit.duplicatesRemoved = excluded.duplicateId + excluded.duplicateGeometry;
  console.log(`Quality: ${JSON.stringify(audit.byStatus)}`);
  const selected = trails.map(t => t.row);
  const sectionTotal = trails.reduce((sum, t) => sum+t.sectionIds.length, 0);
  console.log(`${rows.length.toLocaleString()} sections merged into ${merged.length.toLocaleString()} trails; ${selected.length.toLocaleString()} kept`);
  const index = gzipSync(JSON.stringify(selected), { level: 9 });
  const countries: Record<string, number> = {}, regionCounts = new Map<string, { name: string; country: string; count: number }>();
  for (const r of selected) {
    countries[r.country] = (countries[r.country] ?? 0)+1;
    if (r.region) { const key = `${r.country}:${r.region}`; const entry = regionCounts.get(key) ?? { name:r.region, country:r.country, count:0 }; entry.count++; regionCounts.set(key, entry); }
  }
  const sourceOf = new Map(rows.map(r => [r.id, r.source]));
  sources.forEach((source,i)=>{ source.count = trails.reduce((sum, t) => sum+t.sectionIds.filter(id => sourceOf.get(id) === sourcesToImport[i].key).length, 0); });
  if (skiSource) sources.push(skiSource);
  if (trailheadSource) sources.push(trailheadSource);
  const manifest: CatalogManifest = { coverage, confidence: confidenceCounts, version:2, generatedAt:new Date().toISOString(), total:selected.length, sectionTotal, countries, sources, regions:[...regionCounts.values()].sort((a,b)=>a.name.localeCompare(b.name)), indexSha256:hash(index), excluded, notes:[`Each record is a whole named trail: ${sectionTotal.toLocaleString("en-US")} source sections were merged where sections with the same name connect (within ${JOIN_METERS} m). Same-named trails that do not connect stay separate, except named through-hikes (Appalachian, Pacific Crest, …), which are one trail even across mapping gaps. Unnamed sections are never merged.`, "Trail length is the sum of its sections with overlapping stretches counted once. U.S. sections use USGS-reported miles when they agree with the mapped line (within 0.67–1.5×); otherwise, and for all Canadian sections, length is measured from the generalized geometry.", "Generalized source geometry is for discovery, not navigation. Map pins are points on the trail's longest mapped line, not verified trailheads.", "State/province is inferred from the map pin and Natural Earth public-domain boundaries; long trails can extend outside it.", "Seasonal access, overnight camping, water, difficulty and elevation are not inferred. Source data may be older than the retrieval date.", "U.S. eligibility is named USGS sections plus unnamed sections tagged hikerpedestrian=Y; unnamed sections are labeled Unnamed trail.", `Standalone trails shorter than ${minimumTrailMiles} mi are mapping fragments and are excluded.`, `Pieces that the Forest Service records as one official trail (same TRAIL_CN) are joined into it even across mapping gaps; old links redirect. Official agency trails come from the NPS Public Trails layer (existing, official, open or temporarily closed; not unofficial, unmaintained, sidewalk, water or snow trails), U.S. Forest Service National Forest System Trails (land trails where hiking is an allowed use or has a managed season) and BLM transportation data (routes managed for non-motorized or non-mechanized public use). A line already in the catalog within 25 m for ≥60% of its length confirms that trail and is recorded as a source; only new lines become trails. Catalog lines on Forest Service trails that do not allow hiking are rejected. Trails only an agency maps show a sampled elevation range (Copernicus DEM via Open-Meteo).`, `Every trail is checked by config/trail-quality.json rules: ${audit.byStatus.ok.toLocaleString("en-US")} passed, ${audit.byStatus.short.toLocaleString("en-US")} are short trails, ${audit.byStatus.review.toLocaleString("en-US")} need review and ${audit.byStatus.fragment.toLocaleString("en-US")} are partial, unnamed or connector segments kept out of default results. No elevation is available from these sources.`, ...(skiSource ? [`${winterCounts.downhill.toLocaleString("en-US")} records follow downhill ski pistes mapped in OpenSkiMap and are listed as ski runs, not hiking trails; ${winterCounts.nordic.toLocaleString("en-US")} follow Nordic ski tracks and stay hikeable.`] : [])] };
  const stage = path.join(output, `snapshot-${Date.now()}`); await mkdir(stage);
  const shards: Record<string, Record<string, Point[][]>> = {}, aliases: Record<string, Record<string, string>> = {};
  for (const trail of trails) {
    (shards[trail.row.geometryShard] ??= {})[trail.row.id] = trail.lines;
    for (const id of trail.sectionIds) if (id !== trail.row.id) (aliases[shardOf(id)] ??= {})[id] = trail.row.id;
    // Agency records that confirmed this trail (and older agency ids) redirect to it.
    for (const ref of trail.row.sources ?? []) {
      const prefix = ({ NPS_OFFICIAL: "nps", USFS_OFFICIAL: "usfs", BLM_OFFICIAL: "blm" } as Record<string, string>)[ref.type];
      const id = prefix && `${prefix}-${ref.id}`;
      if (id && id !== trail.row.id && !aliases[shardOf(id)]?.[id]) (aliases[shardOf(id)] ??= {})[id] = trail.row.id;
    }
  }
  for (let i = 0; i < 64; i++) {
    const shard = String(i).padStart(2, "0");
    await writeFile(path.join(stage, `geometry-${shard}.json.gz`), gzipSync(JSON.stringify(shards[shard] ?? {}), { level:9 }));
    await writeFile(path.join(stage, `aliases-${shard}.json.gz`), gzipSync(JSON.stringify(aliases[shard] ?? {}), { level:9 }));
  }
  await writeFile(path.join(stage, "index.json.gz"), index);
  await writeFile(path.join(stage, "audit.json.gz"), gzipSync(JSON.stringify(audit), { level:9 }));
  await writeFile(path.join(stage, "manifest.json"), JSON.stringify(manifest,null,2)+"\n");
  // Pointer swap keeps readers on a complete snapshot. Old snapshots may be removed after deployment.
  await writeFile(path.join(output, "current.json.tmp"), JSON.stringify({ directory:path.basename(stage) })+"\n");
  await rename(path.join(output, "current.json.tmp"), path.join(output,"current.json"));
  console.log(JSON.stringify({ total:manifest.total, sectionTotal, countries, excluded, snapshot:path.basename(stage) },null,2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
