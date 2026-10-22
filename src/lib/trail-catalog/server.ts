import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import type { CatalogFilters, CatalogManifest, CatalogTrail } from "./types";
import { filterCatalog, matchingCatalogRows, searchableText } from "./search";
import { buildThroughHikeOverlay } from "./through-hikes";
import { buildResortOverlay, type ResortTrailSource } from "./resorts";
import { normalizeSeason, titleCaseName, trailStatusFor } from "./agencies";
import { reviewDecisions } from "./reviews";
import { cellsInBounds, isShardKey } from "./cells";
import { simplifyLine } from "@/lib/geo/simplify";
import { resolveDifficulty } from "@/lib/trail-difficulty";
import { withinBounds } from "./map";
import { buildCatalogMap } from "./map";

const unzip = promisify(gunzip);
const root = path.join(process.cwd(), "data/trail-catalog");
const CATALOG_ID = /^(usgs|parks-canada|ontario|nps|usfs|blm|resort|route|osm)-/;
let catalog: Promise<{
  rows: CatalogTrail[];
  texts: string[];
  byId: Map<string, CatalogTrail>;
  manifest: CatalogManifest;
  directory: string;
}> | undefined;

// This module is imported only by server components and API routes. Never send the index to a client component.
function recountCountries(rows: CatalogTrail[]) {
  const countries: Record<string, number> = {};
  for (const row of rows) countries[row.country] = (countries[row.country] ?? 0) + 1;
  return countries;
}

function load() {
  catalog ??= (async () => {
    const pointer = JSON.parse(await readFile(path.join(root, "current.json"), "utf8"));
    if (!/^snapshot-\d+$/.test(pointer.directory)) throw new Error("Invalid catalog snapshot");
    const directory = path.join(root, pointer.directory);
    const [raw, metadata] = await Promise.all([
      readFile(path.join(directory, "index.json.gz")),
      readFile(path.join(directory, "manifest.json"), "utf8"),
    ]);
    const baseManifest = JSON.parse(metadata) as CatalogManifest;
    if (createHash("sha256").update(raw).digest("hex") !== baseManifest.indexSha256) {
      throw new Error("Catalog checksum mismatch");
    }
    const sections = JSON.parse((await unzip(raw)).toString()) as CatalogTrail[];
    // Many source names are all capitals ("HALF DOME CRAG"); show them in title case.
    for (const row of sections) {
      row.name = titleCaseName(row.name);
      // Older snapshots stored raw season codes ("No", "Unknown") and called those trails seasonal.
      row.season = normalizeSeason(row.season);
      if (row.trailStatus === "SEASONAL" || row.trailStatus === "UNKNOWN") row.trailStatus = trailStatusFor(row);
    }
    if (sections.length !== baseManifest.total || new Set(sections.map((r) => r.id)).size !== sections.length) {
      throw new Error("Catalog count mismatch");
    }
    const overlay = buildThroughHikeOverlay(sections);
    // Trails that make up a through-hike are listed once, as the route card.
    const members = new Set(overlay.flatMap((route) => route.memberIds ?? []));
    // Resort-listed summer trails (names and lengths from resort sites, no route line).
    let resortSources: ResortTrailSource[] = [];
    try {
      resortSources = JSON.parse(await readFile(path.join(root, "resort-trails.json"), "utf8")).resorts;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const resorts = buildResortOverlay(resortSources, sections);
    const rows = [...overlay, ...sections.filter((row) => !members.has(row.id)), ...resorts];
    const byId = new Map([...sections, ...overlay, ...resorts].map((r) => [r.id, r]));
    const manifest: CatalogManifest = {
      ...baseManifest,
      total: rows.length,
      publicTotal: rows.filter((row) => row.confidence !== "REJECTED" && row.quality !== "fragment" && !row.mergedInto).length,
      countries: recountCountries(rows),
      notes: [
        ...baseManifest.notes,
        `${overlay.length} through-hike routes (curated international/classic guides plus mapped National Scenic and long trails, shown with official length) are overlaid at read time.`,
        ...(resorts.length ? [`${resorts.length} summer trails listed on ski resorts’ official sites are included by name and stated length; they have no mapped route line.`] : []),
      ],
    };
    return {
      rows,
      texts: rows.map(searchableText),
      byId,
      manifest,
      directory,
    };
  })().catch((error) => {
    catalog = undefined;
    throw error;
  });
  return catalog;
}

export async function searchCatalog(filters: CatalogFilters = {}) {
  const [data, reviews] = await Promise.all([load(), reviewDecisions()]);
  return { ...filterCatalog(data.rows, filters, data.texts, reviews), manifest: data.manifest };
}

export async function searchCatalogMap(filters: CatalogFilters = {}) {
  const [data, reviews] = await Promise.all([load(), reviewDecisions()]);
  return buildCatalogMap(matchingCatalogRows(data.rows, filters, data.texts, reviews));
}

/** Parsed geometry cells, most recently used last; map panning revisits the same few cells. */
const cellCache = new Map<string, Promise<Record<string, [number, number][][]>>>();
async function readShard(directory: string, kind: "geometry" | "aliases", shard: string) {
  if (!isShardKey(shard) || shard === "route") return {};
  if (kind === "geometry") {
    const key = `${directory}:${shard}`;
    let hit = cellCache.get(key);
    if (hit) { cellCache.delete(key); cellCache.set(key, hit); return hit; }
    hit = readShardFile(directory, kind, shard).catch((error) => {
      cellCache.delete(key);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    });
    cellCache.set(key, hit);
    if (cellCache.size > 48) cellCache.delete(cellCache.keys().next().value!);
    return hit;
  }
  return readShardFile(directory, kind, shard);
}
async function readShardFile(directory: string, kind: "geometry" | "aliases", shard: string) {
  try {
    return JSON.parse((await unzip(await readFile(path.join(directory, `${kind}-${shard}.json.gz`)))).toString());
  } catch (error) {
    if (kind === "aliases" && (error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

const shardOf = (id: string) => (parseInt(createHash("sha256").update(id).digest("hex").slice(0, 2), 16) % 64).toString().padStart(2, "0");

/**
 * Returns a catalog trail and its lines. Ids of source sections that were merged into a trail resolve
 * to that trail, so callers should compare `detail.trail.id` with the requested id to canonicalize URLs.
 */
export async function getCatalogTrail(id: string) {
  if (id.length > 200 || !CATALOG_ID.test(id)) return null;
  const data = await load();
  let trail = data.byId.get(id);
  if (!trail) {
    const alias = ((await readShard(data.directory, "aliases", shardOf(id))) as Record<string, string>)[id];
    trail = alias ? data.byId.get(alias) : undefined;
    if (!trail) return null;
  }
  // An official record merged into a whole trail opens as that trail.
  for (let hops = 0; trail.mergedInto && hops < 3; hops++) trail = data.byId.get(trail.mergedInto) ?? trail;
  if (trail.kind === "route" || trail.geometryShard === "route") {
    const lines: [number, number][][] = [];
    for (const memberId of trail.memberIds ?? []) {
      const member = data.byId.get(memberId);
      if (!member) continue;
      const geometry = (await readShard(data.directory, "geometry", member.geometryShard)) as Record<string, [number, number][][]>;
      lines.push(...(geometry[memberId] ?? []));
    }
    return { trail, lines, manifest: data.manifest };
  }
  if (trail.source === "resort") return { trail, lines: [] as [number, number][][], manifest: data.manifest, parent: null };
  const geometry = (await readShard(data.directory, "geometry", trail.geometryShard)) as Record<string, [number, number][][]>;
  if (!geometry[trail.id]) throw new Error("Missing catalog geometry");
  const parentRow = trail.parentId ? data.byId.get(trail.parentId) : undefined;
  const parent = parentRow ? { id: parentRow.id, name: parentRow.name, miles: parentRow.miles } : null;
  return { trail, lines: geometry[trail.id], manifest: data.manifest, parent };
}

/** The snapshot's quality audit report, if this snapshot was built with one. */
export async function catalogAudit() {
  const data = await load();
  try {
    return JSON.parse((await unzip(await readFile(path.join(data.directory, "audit.json.gz")))).toString()) as import("./audit").AuditReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Ids of trails shown publicly (not rejected fragments, sidewalks, motorized routes or ski runs). */
export async function publicCatalogIds() {
  const data = await load();
  const reviews = await reviewDecisions();
  return data.rows
    .filter((row) => reviews.get(row.id) !== "reject" && (reviews.get(row.id) === "approve" || (row.confidence !== "REJECTED" && row.quality !== "fragment")))
    .map((row) => row.id);
}

export async function catalogDownload() {
  const data = await load();
  return readFile(path.join(data.directory, "index.json.gz"));
}

/** Difficulty letter for map styling: e(asy), m(oderate), h(ard), x (expert). */
const DIFFICULTY_CODE: Record<string, string> = { easy: "e", moderate: "m", hard: "h", expert: "x" };
const difficultyCode = (t: CatalogTrail) =>
  DIFFICULTY_CODE[resolveDifficulty({ reported: t.difficulty, miles: t.miles, sacScale: t.osm?.sacScale }).difficulty] ?? "m";

/** Trails matching filters (ignoring the map area), cached per filter set for line lookups. */
const idSets = new Map<string, Promise<Set<string>>>();
async function matchingIds(filters: CatalogFilters) {
  const key = JSON.stringify({ ...filters, bbox: undefined, page: undefined, limit: undefined });
  let hit = idSets.get(key);
  if (!hit) {
    hit = Promise.all([load(), reviewDecisions()]).then(([data, reviews]) =>
      new Set(matchingCatalogRows(data.rows, { ...filters, bbox: undefined }, data.texts, reviews).map((r) => r.id)));
    hit.catch(() => idSets.delete(key));
    idSets.set(key, hit);
    if (idSets.size > 24) idSets.delete(idSets.keys().next().value!);
  }
  return hit;
}

export type ExplorePointTrail = [id: string, name: string, longitude: number, latitude: number, miles: number | null, difficulty: string, place: string | null, routeType: string | null, qualityScore: number];
export type ExploreCluster = [longitude: number, latitude: number, count: number, west: number, south: number, east: number, north: number];
export interface ExplorePoints { total: number; trails: ExplorePointTrail[]; clusters: ExploreCluster[] }

/** Every matching trail pin in view, or a grid of counts when there are too many to send. */
export async function exploreCatalogPoints(filters: CatalogFilters, maxTrails = 2500): Promise<ExplorePoints> {
  const [data, reviews] = await Promise.all([load(), reviewDecisions()]);
  const rows = matchingCatalogRows(data.rows, filters, data.texts, reviews);
  if (rows.length <= maxTrails) {
    return {
      total: rows.length,
      clusters: [],
      trails: rows.map((t) => [t.id, t.name, t.longitude, t.latitude, t.miles, difficultyCode(t), t.park ?? t.forest ?? t.region, t.routeType ?? null, t.qualityScore ?? 0]),
    };
  }
  const [west, south, east, north] = filters.bbox ?? [-180, -60, 180, 85];
  const width = (east >= west ? east - west : east + 360 - west) || 1, height = (north - south) || 1;
  const columns = 30, rowsN = Math.max(8, Math.round(columns * (height / width) * 1.3));
  const groups = new Map<number, ExploreCluster>();
  for (const t of rows) {
    const lng = t.longitude < west ? t.longitude + 360 : t.longitude;
    const x = Math.min(columns - 1, Math.max(0, Math.floor(((lng - west) / width) * columns)));
    const y = Math.min(rowsN - 1, Math.max(0, Math.floor(((t.latitude - south) / height) * rowsN)));
    const key = y * columns + x;
    const g = groups.get(key);
    if (!g) { groups.set(key, [t.longitude, t.latitude, 1, t.longitude, t.latitude, t.longitude, t.latitude]); continue; }
    // Running mean keeps the bubble over where the trails actually are.
    g[2]++;
    g[0] += (t.longitude - g[0]) / g[2];
    g[1] += (t.latitude - g[1]) / g[2];
    g[3] = Math.min(g[3], t.longitude); g[4] = Math.min(g[4], t.latitude); g[5] = Math.max(g[5], t.longitude); g[6] = Math.max(g[6], t.latitude);
  }
  return { total: rows.length, trails: [], clusters: [...groups.values()].map((g) => g.map((v, i) => (i === 2 ? v : Math.round(v * 1e5) / 1e5)) as ExploreCluster) };
}

/**
 * Trail lines crossing a map view, simplified for the zoom level, as GeoJSON.
 * Views wider than a couple of degrees return nothing (pins and clusters cover those).
 */
export async function exploreCatalogLines(filters: CatalogFilters, bbox: [number, number, number, number], zoom: number, maxFeatures = 3000) {
  const [west, south, east, north] = bbox;
  if (east - west > 4 || north - south > 3) return { type: "FeatureCollection" as const, features: [], truncated: true };
  const [data, ids] = await Promise.all([load(), matchingIds(filters)]);
  const tolerance = (360 / (512 * 2 ** zoom)) * 1.2;
  const features: { type: "Feature"; id: number; properties: { id: string; name: string; d: string; miles: number | null }; geometry: { type: "MultiLineString"; coordinates: [number, number][][] } }[] = [];
  const cells = cellsInBounds(bbox, 1, 30);
  const shards = await Promise.all(cells.map((cell) => readShard(data.directory, "geometry", cell) as Promise<Record<string, [number, number][][]>>));
  const candidates: { trail: CatalogTrail; lines: [number, number][][] }[] = [];
  for (const shard of shards) {
    for (const [id, lines] of Object.entries(shard)) {
      if (!ids.has(id)) continue;
      const trail = data.byId.get(id);
      if (!trail) continue;
      let hit = false;
      for (const line of lines) {
        for (const [x, y] of line) if (withinBounds(x, y, bbox)) { hit = true; break; }
        if (hit) break;
      }
      if (hit) candidates.push({ trail, lines });
    }
  }
  candidates.sort((a, b) => (b.trail.miles ?? 0) - (a.trail.miles ?? 0));
  for (const { trail, lines } of candidates.slice(0, maxFeatures)) {
    const coordinates = lines.map((line) => simplifyLine(line, tolerance)).filter((line) => line.length > 1);
    if (!coordinates.length) continue;
    features.push({ type: "Feature", id: features.length, properties: { id: trail.id, name: trail.name, d: difficultyCode(trail), miles: trail.miles }, geometry: { type: "MultiLineString", coordinates } });
  }
  return { type: "FeatureCollection" as const, features, truncated: candidates.length > maxFeatures };
}
