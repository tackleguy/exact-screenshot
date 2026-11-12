import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import type { CatalogFilters, CatalogManifest, CatalogTrail } from "./types";
import { distanceKm, filterCatalog, matchingCatalogRows, searchableText } from "./search";
import { buildThroughHikeOverlay } from "./through-hikes";
import { buildResortOverlay, type ResortTrailSource } from "./resorts";
import { normalizeSeason, titleCaseName, trailStatusFor } from "./agencies";
import { reviewDecisions } from "./reviews";
import { cellsInBounds, geometryCell, isShardKey } from "./cells";
import { simplifyLine } from "@/lib/geo/simplify";
import { trailDifficulty } from "@/lib/trail-difficulty";
import { listScore } from "./cleanup";
import { withinBounds, buildCatalogMap } from "./map";
import { withDisplayName } from "./naming";
import { getAllPeakTrails } from "./peaks";
import { DETAILED_THRU_HIKES, getDetailedThruHikeTrails } from "./through-hikes-data";
import { sectionOf, trailActivities } from "./activity";
import { snapPointToNearestLine } from "@/lib/geo/snap";
import { featureFromRow, featuresAlong, FEATURE_LABELS, type FeatureRow } from "./features";

const unzip = promisify(gunzip);
const root = path.join(process.cwd(), "data/trail-catalog");
const CATALOG_ID = /^(usgs|parks-canada|ontario|nps|usfs|blm|resort|route|osm)-/;

let curatedByIdCache: Map<string, CatalogTrail> | undefined;
function getCuratedById(): Map<string, CatalogTrail> {
  if (!curatedByIdCache) {
    const { thruHikes, sections } = getDetailedThruHikeTrails();
    curatedByIdCache = new Map([...getAllPeakTrails(), ...thruHikes, ...sections].map((t) => [t.id, t]));
  }
  return curatedByIdCache;
}

export function isCatalogTrailId(id: string): boolean {
  return id.length <= 200 && (CATALOG_ID.test(id) || getCuratedById().has(id));
}

let curatedLinesCache: Promise<{ lines: Record<string, [number, number][][]>; links: Record<string, string> }> | undefined;
function loadCuratedLines(directory: string) {
  curatedLinesCache ??= readFile(path.join(directory, "curated.json.gz"))
    .then(async (raw) => JSON.parse((await unzip(raw)).toString()) as { lines: Record<string, [number, number][][]>; links: Record<string, string> })
    .catch(() => ({ lines: {}, links: {} }));
  return curatedLinesCache;
}

const worldCountryCache = new Map<string, Promise<CatalogTrail[]>>();
async function loadWorldCountry(directory: string, code: string): Promise<CatalogTrail[]> {
  if (!/^[A-Z]{2}(?:-[A-Z]{2})?$/.test(code)) return [];
  const key = `${directory}:${code}`;
  let hit = worldCountryCache.get(key);
  if (!hit) {
    hit = readFile(path.join(directory, "world", `index-${code}.json.gz`))
      .then(async (raw) => {
        const parsed = JSON.parse((await unzip(raw)).toString()) as { rows?: CatalogTrail[] };
        return (parsed.rows ?? []).map((r) => withDisplayName({ ...r, name: titleCaseName(r.name) }));
      })
      .catch(() => []);
    worldCountryCache.set(key, hit);
    if (worldCountryCache.size > 16) worldCountryCache.delete(worldCountryCache.keys().next().value!);
  }
  return hit;
}

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
      // Incomplete names ("Burton") read as trails: "Burton Trail — Angeles National Forest".
      Object.assign(row, withDisplayName(row));
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

async function rowsForFilters(
  data: Awaited<ReturnType<typeof load>>,
  filters: CatalogFilters,
): Promise<{ rows: CatalogTrail[]; texts: string[] | undefined }> {
  if (
    (filters.collection && filters.collection !== "thru-hikes") ||
    filters.peakCategory ||
    filters.thruHikeSections
  ) {
    return { rows: [...getCuratedById().values()], texts: undefined };
  }
  const extra: CatalogTrail[] = [];
  if (filters.collection === "thru-hikes" || filters.q?.trim()) {
    for (const item of getCuratedById().values()) {
      if (!data.byId.has(item.id)) extra.push(item);
    }
  }
  if (filters.country && filters.country !== "US" && filters.country !== "CA" && filters.country !== "intl") {
    const worldRows = await loadWorldCountry(data.directory, filters.country);
    for (const row of worldRows) {
      if (!data.byId.has(row.id)) extra.push(row);
    }
  }
  const normRegion = filters.region?.trim().toLowerCase();
  if (normRegion === "alaska" || normRegion === "hawaii") {
    const code = normRegion === "alaska" ? "US-AK" : "US-HI";
    const subRows = await loadWorldCountry(data.directory, code);
    for (const row of subRows) {
      if (!data.byId.has(row.id)) extra.push(row);
    }
  }
  if (!extra.length) return { rows: data.rows, texts: data.texts };
  return { rows: [...extra, ...data.rows], texts: undefined };
}

export async function searchCatalog(filters: CatalogFilters = {}) {
  const [data, reviews] = await Promise.all([load(), reviewDecisions()]);
  const { rows, texts } = await rowsForFilters(data, filters);
  // Lists hide unmapped and very short pieces unless "Show all mapped segments" (allSegments) is on.
  const listFilters = { hideStubs: !filters.resort && !filters.collection, ...filters };
  return { ...filterCatalog(rows, listFilters, texts, reviews), manifest: data.manifest };
}

export async function searchCatalogMap(filters: CatalogFilters = {}) {
  const [data, reviews] = await Promise.all([load(), reviewDecisions()]);
  const { rows, texts } = await rowsForFilters(data, filters);
  return buildCatalogMap(matchingCatalogRows(rows, filters, texts, reviews));
}

/** Parsed geometry cells, most recently used last; map panning revisits the same few cells. */
const cellCache = new Map<string, Promise<Record<string, [number, number][][]>>>();
async function readShard(directory: string, kind: "geometry" | "aliases", shard: string) {
  if (!isShardKey(shard) || shard === "route") return {};
  if (kind === "geometry") {
    const key = `${directory}:${shard}`;
    const hit = cellCache.get(key);
    if (hit) { cellCache.delete(key); cellCache.set(key, hit); return hit; }
    const next = readGeometryShardFile(directory, shard).catch((error) => {
      cellCache.delete(key);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {} as Record<string, [number, number][][]>;
      throw error;
    });
    cellCache.set(key, next);
    if (cellCache.size > 48) cellCache.delete(cellCache.keys().next().value!);
    return next;
  }
  return (await readOptionalGzipJson<Record<string, string>>(path.join(directory, `aliases-${shard}.json.gz`))) ?? {};
}

async function readOptionalGzipJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse((await unzip(await readFile(filePath))).toString()) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readGeometryShardFile(directory: string, shard: string): Promise<Record<string, [number, number][][]>> {
  const [na, world] = await Promise.all([
    readOptionalGzipJson<Record<string, [number, number][][]>>(path.join(directory, `geometry-${shard}.json.gz`)),
    readOptionalGzipJson<Record<string, [number, number][][]>>(path.join(directory, "world", `geometry-${shard}.json.gz`)),
  ]);
  if (!na && !world) return {};
  if (!world) return na!;
  if (!na) return world;
  return { ...na, ...world };
}

const shardOf = (id: string) => (parseInt(createHash("sha256").update(id).digest("hex").slice(0, 2), 16) % 64).toString().padStart(2, "0");

async function resolveCatalogRecord(rawId: string, data: Awaited<ReturnType<typeof load>>): Promise<{ trail: CatalogTrail; fromCurated: boolean } | null> {
  let id = rawId;
  if (rawId.includes("%")) {
    try {
      id = decodeURIComponent(rawId);
    } catch {
      id = rawId;
    }
  }
  if (!isCatalogTrailId(id)) return null;
  let trail = data.byId.get(id);
  if (!trail) {
    const curated = getCuratedById().get(id);
    if (curated) return { trail: curated, fromCurated: true };
    const alias = ((await readShard(data.directory, "aliases", shardOf(id))) as Record<string, string>)[id];
    trail = alias ? data.byId.get(alias) : undefined;
    if (!trail) return null;
  }
  for (let hops = 0; trail.mergedInto && hops < 3; hops++) trail = data.byId.get(trail.mergedInto) ?? trail;
  return { trail, fromCurated: false };
}

/** Fast record-only lookup for trail summary first-paint without loading geometry shards. */
export async function getCatalogTrailSummary(id: string) {
  const data = await load();
  const resolved = await resolveCatalogRecord(id, data);
  if (!resolved) return null;
  if (resolved.fromCurated) {
    const c = await loadCuratedLines(data.directory);
    const linked = c.links[resolved.trail.id];
    return { trail: linked ? { ...resolved.trail, linkedTrailId: linked } : resolved.trail };
  }
  return { trail: resolved.trail };
}

/**
 * Returns a catalog trail and its lines. Ids of source sections that were merged into a trail resolve
 * to that trail, so callers should compare `detail.trail.id` with the requested id to canonicalize URLs.
 */
export async function getCatalogTrail(id: string) {
  const data = await load();
  const resolved = await resolveCatalogRecord(id, data);
  if (!resolved) return null;
  const { trail, fromCurated } = resolved;
  if (fromCurated) {
    const c = await loadCuratedLines(data.directory);
    const linked = c.links[trail.id];
    return {
      trail: linked ? { ...trail, linkedTrailId: linked } : trail,
      lines: (c.lines[trail.id] ?? []) as [number, number][][],
      manifest: data.manifest,
      parent: null,
    };
  }
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
  DIFFICULTY_CODE[trailDifficulty(t)] ?? "m";

/** Trails matching filters (ignoring the map area), cached per filter set for line lookups. */
const idSets = new Map<string, Promise<Map<string, CatalogTrail>>>();
async function matchingIds(filters: CatalogFilters) {
  const key = JSON.stringify({ ...filters, bbox: undefined, page: undefined, limit: undefined });
  let hit = idSets.get(key);
  if (!hit) {
    hit = Promise.all([load(), reviewDecisions()]).then(async ([data, reviews]) => {
      const { rows, texts } = await rowsForFilters(data, filters);
      return new Map(matchingCatalogRows(rows, { ...filters, bbox: undefined }, texts, reviews).map((r) => [r.id, r]));
    });
    hit.catch(() => idSets.delete(key));
    idSets.set(key, hit);
    if (idSets.size > 24) idSets.delete(idSets.keys().next().value!);
  }
  return hit;
}

/** A trail pin for the map: with its stored climb and list score, so cards show the same stats as the trail page. */
export type ExplorePointTrail = [id: string, name: string, longitude: number, latitude: number, miles: number | null, difficulty: string, place: string | null, routeType: string | null, qualityScore: number, gainFt?: number | null, lossFt?: number | null, steepestGradePct?: number | null, listScore?: number];
export type ExploreCluster = [longitude: number, latitude: number, count: number, west: number, south: number, east: number, north: number];
export interface ExplorePoints { total: number; trails: ExplorePointTrail[]; clusters: ExploreCluster[] }

/** Every matching trail pin in view, or a grid of counts when there are too many to send. */
export async function exploreCatalogPoints(filters: CatalogFilters, maxTrails = 2500): Promise<ExplorePoints> {
  const [data, reviews] = await Promise.all([load(), reviewDecisions()]);
  const { rows: sourceRows, texts } = await rowsForFilters(data, filters);
  const rows = matchingCatalogRows(sourceRows, filters, texts, reviews);
  if (rows.length <= maxTrails) {
    return {
      total: rows.length,
      clusters: [],
      trails: rows.map((t) => [t.id, t.name, t.longitude, t.latitude, t.miles, difficultyCode(t), t.park ?? t.forest ?? t.region, t.routeType ?? null, t.qualityScore ?? 0, t.gainFt ?? null, t.lossFt ?? null, t.steepestGradePct ?? null, Math.round(listScore(t))]),
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

const CLUSTER_GRIDS = [8, 4, 2, 1, 0.5, 0.25] as const;
type ClusterTuple = [number, number, number, number, number, number, number, number];
let clusterSectionsCache: Promise<Record<string, Record<string, ClusterTuple[]>>> | undefined;

function loadClusterSections() {
  clusterSectionsCache ??= load().then((data) => {
    type Acc = [number, number, number, number, number, number, number, number];
    const acc: Record<string, Record<string, Map<string, Acc>>> = {};
    for (const t of data.rows) {
      if (t.mergedInto || t.confidence === "REJECTED" || t.quality === "fragment") continue;
      if (t.kind !== "segment" || t.source === "resort") continue;
      for (const section of new Set(trailActivities(t).map((a) => sectionOf(a).key))) {
        for (const g of CLUSTER_GRIDS) {
          const bucket = ((acc[section] ??= {})[String(g)] ??= new Map());
          const k = `${Math.floor(t.longitude / g)}:${Math.floor(t.latitude / g)}`;
          const a = bucket.get(k) ?? [0, 0, 0, 0, 180, 90, -180, -90];
          a[0] += t.longitude;
          a[1] += t.latitude;
          a[2]++;
          if (t.tier === "verified") a[3]++;
          a[4] = Math.min(a[4], t.longitude);
          a[5] = Math.min(a[5], t.latitude);
          a[6] = Math.max(a[6], t.longitude);
          a[7] = Math.max(a[7], t.latitude);
          bucket.set(k, a);
        }
      }
    }
    const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
    return Object.fromEntries(
      Object.entries(acc).map(([section, byGrid]) => [
        section,
        Object.fromEntries(
          Object.entries(byGrid).map(([g, bucket]) => [
            g,
            [...bucket.values()].map(
              (a): ClusterTuple => [r4(a[0] / a[2]), r4(a[1] / a[2]), a[2], a[3], r4(a[4]), r4(a[5]), r4(a[6]), r4(a[7])],
            ),
          ]),
        ),
      ]),
    );
  }).catch((error) => {
    clusterSectionsCache = undefined;
    throw error;
  });
  return clusterSectionsCache;
}

/** Zoomed-out count bubbles per section and grid cell, matching the static clusters.json.gz schema. */
export async function exploreCatalogClusters(filters: CatalogFilters, zoom: number) {
  const sections = await loadClusterSections();
  const grid = zoom < 3.5 ? "8" : zoom < 4.5 ? "4" : zoom < 5.5 ? "2" : zoom < 6.5 ? "1" : zoom < 8 ? "0.5" : "0.25";
  const key = sectionOf(filters.activity === "all" ? "hike" : filters.activity ?? "hike").key;
  const [w, s, e, n] = filters.bbox ?? [-180, -90, 180, 90];
  const clusters = (sections[key]?.[grid] ?? []).filter(([lng, lat]) => lng >= w && lng <= e && lat >= s && lat <= n);
  return {
    total: clusters.reduce((sum, c) => sum + c[2], 0),
    verified: clusters.reduce((sum, c) => sum + c[3], 0),
    clusters,
    grid,
  };
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
  const seen = new Set<string>();
  for (const shard of shards) {
    for (const [id, lines] of Object.entries(shard)) {
      if (seen.has(id)) continue;
      const trail = ids.get(id);
      if (!trail) continue;
      let hit = false;
      for (const line of lines) {
        for (const [x, y] of line) if (withinBounds(x, y, bbox)) { hit = true; break; }
        if (hit) break;
      }
      if (hit) {
        seen.add(id);
        candidates.push({ trail, lines });
      }
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

/** Long-distance through-hike geometries from curated.json.gz as GeoJSON. */
export async function catalogThruHikeLines(): Promise<GeoJSON.FeatureCollection> {
  const data = await load();
  const c = await loadCuratedLines(data.directory);
  const features: GeoJSON.Feature[] = [];
  for (const hike of DETAILED_THRU_HIKES) {
    const lines = c.lines[hike.id];
    if (lines?.length) {
      features.push({
        type: "Feature",
        id: hike.id,
        properties: {
          id: hike.id,
          name: hike.name,
          shortName: hike.shortName,
          miles: hike.officialMiles,
          region: hike.region,
          kind: "thru-hike",
        },
        geometry: {
          type: "MultiLineString",
          coordinates: lines,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** Full-resolution trail lines entering `box` for the route builder. */
export async function catalogRoutingNetwork(box: [number, number, number, number]): Promise<GeoJSON.FeatureCollection> {
  const data = await load();
  const pad = 0.25;
  const rows = data.rows
    .filter(
      (t) =>
        !t.mergedInto &&
        t.confidence !== "REJECTED" &&
        t.quality !== "fragment" &&
        !t.winterUse &&
        t.source !== "resort" &&
        t.geometryShard &&
        t.geometryShard !== "route" &&
        t.longitude >= box[0] - pad &&
        t.longitude <= box[2] + pad &&
        t.latitude >= box[1] - pad &&
        t.latitude <= box[3] + pad,
    )
    .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));

  const shardNames = [...new Set(rows.map((t) => t.geometryShard))];
  const shardEntries = await Promise.all(
    shardNames.map(async (s) => [s, (await readShard(data.directory, "geometry", s)) as Record<string, [number, number][][]>] as const),
  );
  const shardMap = new Map(shardEntries);
  const inside = ([x, y]: [number, number]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  const features: GeoJSON.Feature[] = [];
  for (const t of rows) {
    const lines = (shardMap.get(t.geometryShard)?.[t.id] ?? []).filter((line) => line.length > 1 && line.some(inside));
    if (!lines.length) continue;
    features.push({
      type: "Feature",
      id: t.id,
      properties: { id: t.id, name: t.name, q: t.qualityScore ?? 0, tier: t.tier ?? (t.sourceType ? "verified" : "mapped") },
      geometry: { type: "MultiLineString", coordinates: lines },
    });
    if (features.length >= 4000) break;
  }
  return { type: "FeatureCollection", features };
}

/** Projects a user click or GPS coordinate onto nearby trail geometry. */
export async function snapToCatalogTrail(lat: number, lng: number, tolerance = 50) {
  const data = await load();
  const near = filterCatalog(data.rows, { lat, lng, radiusKm: 15, limit: 20 }, data.texts).trails;
  const candidateLines: [number, number][][] = [];
  for (const r of near.slice(0, 20)) {
    const d = await getCatalogTrail(r.id).catch(() => null);
    if (d?.lines) candidateLines.push(...d.lines);
  }
  const c = await loadCuratedLines(data.directory);
  for (const hike of DETAILED_THRU_HIKES) {
    const lines = c.lines[hike.id];
    if (lines) candidateLines.push(...lines);
  }
  const snapped = snapPointToNearestLine([lng, lat], candidateLines, tolerance);
  if (snapped) return snapped;
  return {
    snapped: [lng, lat] as [number, number],
    distanceMeters: null,
    alongMeters: 0,
    segmentIndex: -1,
    original: [lng, lat] as [number, number],
    isSnapped: false,
  };
}

/** Up to 5 nearby segment trails within 35 km of `id`, ordered nearest first. */
export async function nearbyCatalogTrails(id: string) {
  const summary = await getCatalogTrailSummary(id);
  if (!summary) return null;
  const t = summary.trail;
  const [data, reviews] = await Promise.all([load(), reviewDecisions()]);
  const near = filterCatalog(
    data.rows.filter((r) => r.id !== t.id && r.kind === "segment"),
    { lat: t.latitude, lng: t.longitude, radiusKm: 35, limit: 48, uniqueNames: true },
    undefined,
    reviews,
  )
    .trails.map((r) => ({ ...r, distanceKm: distanceKm(t.latitude, t.longitude, r.latitude, r.longitude) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 5);
  return near;
}

let hasFeaturesDirCache: Map<string, Promise<boolean>> | undefined;
function hasFeaturesDir(directory: string): Promise<boolean> {
  hasFeaturesDirCache ??= new Map();
  let hit = hasFeaturesDirCache.get(directory);
  if (!hit) {
    hit = stat(path.join(directory, "features"))
      .then((s) => s.isDirectory())
      .catch(() => false);
    hasFeaturesDirCache.set(directory, hit);
  }
  return hit;
}

async function readFeatureCells(directory: string, cellIds: string[]): Promise<FeatureRow[]> {
  const parts = await Promise.all(
    cellIds.map((c) => readOptionalGzipJson<FeatureRow[]>(path.join(directory, "features", `f-${c}.json.gz`))),
  );
  return parts.flatMap((p) => p ?? []);
}

/** Hike features in a map bbox, or `null` when the build-time feature layer is absent on this host. */
export async function catalogFeaturesInView(bbox: [number, number, number, number] | undefined, types: Set<string>) {
  const data = await load();
  if (!(await hasFeaturesDir(data.directory))) return null;
  const rows = bbox
    ? (await readFeatureCells(data.directory, cellsInBounds(bbox, 0, 16))).filter(
        (r) => r[3] >= bbox[0] && r[3] <= bbox[2] && r[4] >= bbox[1] && r[4] <= bbox[3] && (!types.size || types.has(r[1])),
      )
    : [];
  const features = rows.slice(0, 5000).map(featureFromRow);
  return {
    features,
    total: rows.length,
    source: "© OpenStreetMap contributors (ODbL)",
    toGeoJson: () => ({
      type: "FeatureCollection" as const,
      features: features.map((f) => ({
        type: "Feature" as const,
        id: f.id,
        properties: { id: f.id, type: f.type, kind: f.type, name: f.name, label: FEATURE_LABELS[f.type] },
        geometry: { type: "Point" as const, coordinates: [f.lon, f.lat] },
      })),
    }),
  };
}

/** Hike features along one trail, or `null` when the build-time feature layer is absent on this host. */
export async function catalogTrailFeatures(trailId: string, lines: [number, number][][]) {
  const data = await load();
  if (!(await hasFeaturesDir(data.directory))) return null;
  const cellIds = new Set<string>();
  for (const line of lines) for (const p of line) cellIds.add(geometryCell(p[0], p[1]));
  return featuresAlong(await readFeatureCells(data.directory, [...cellIds].slice(0, 80)), trailId);
}

