import { parseCatalogFilters, filterCatalog, normalize, distanceKm } from "@/lib/trail-catalog/search";
import type { CatalogTrail, CatalogManifest } from "@/lib/trail-catalog/types";
import { buildCatalogMap } from "@/lib/trail-catalog/map";
import { trailDifficulty } from "@/lib/trail-difficulty";
import { listScore } from "@/lib/trail-catalog/cleanup";
import { chainLines } from "@/lib/geo/line";
import { measureLines } from "@/lib/trail-catalog/quality";
import { nearbyCatalogPhotos, wikiPhotos } from "@/lib/trail-catalog/photos";
import { matchScore, normalizeText, placeMatch, searchEntry, searchRank, type SearchEntry } from "@/lib/trail-catalog/fuzzy";
import type { LngLat } from "@/lib/geo/tiles";
import { elevationProfile } from "@/lib/trip/elevation";
import { waterAlong, waterFromFeatures } from "@/lib/trip/water";
import { featureFromRow, featuresAlong, FEATURE_LABELS, type FeatureRow, type TrailFeature } from "@/lib/trail-catalog/features";
import { cellsInBounds, geometryCell } from "@/lib/trail-catalog/cells";
import { parseTowns, townServices, townsNear, type Town } from "@/lib/trip/towns-core";
import { planTownDays } from "@/lib/trip/town-days";
import { tripGpx, tripPacketHtml, waterCsv, type PackItem, type TripBundle } from "@/lib/trip/packet";
import { MIN_MAPPED_SHARE, mappedShare, planningMiles, townDayOptions, unplannable } from "@/lib/trip/planning";
import { catalogGpx } from "@/lib/trail-catalog/gpx";
import { readableTrailName, MAP_TRAIL_LIMIT, TRAIL_CARD_LIMIT, localTrailsVisible } from "@/lib/trail-catalog/discovery";
import { sectionOf } from "@/lib/trail-catalog/activity";
import { TrailheadIndex, trailEnds, type TrailheadCache } from "@/lib/trail-catalog/access";
import { getAllPeakTrails } from "@/lib/trail-catalog/peaks";
import {
  DETAILED_THRU_HIKES,
  getDetailedThruHikeTrails,
} from "@/lib/trail-catalog/through-hikes-data";
import { snapPointToNearestLine, simplifyForZoom } from "@/lib/geo/snap";
import { countryName, trailSacScale } from "@/lib/trail-catalog/types";
import { cellBounds, cellFile, cellKeyOf, cellRef, regionSlug, rowShard, searchKey, SEARCH_STOPWORDS } from "@/lib/trail-catalog/static-data";

type Metadata = CatalogManifest & {
  directory: string;
  /** 2° cells with U.S./Canada trails. */
  cells: string[];
  /** 2° cell → countries with worldwide trails in it (one file each). */
  worldCells?: Record<string, string[]>;
  /** Regions (slugs) with a best-trails search file, q/r-<slug>.json.gz. */
  searchRegions?: string[];
  /** Countries with a best-trails search file, q/c-<CC>.json.gz. */
  searchCountries?: string[];
  featureCells?: string[];
};
type Lines = [number, number][][];
const cache = new Map<string, Promise<unknown>>();
let metadata: Promise<Metadata> | undefined;
let trailheads: Promise<TrailheadIndex> | undefined;
let towns: Promise<Town[]> | undefined;
const TOWNS_ATTRIBUTION = "Towns from GeoNames (CC BY 4.0). Services © OpenStreetMap contributors, via OpenStreetMap US tiles. Check hours and availability before relying on any business.";
const computed = new Map<string, Promise<unknown>>();
/** Per-trail results are kept for the session; failures are retried next time. */
function memo<T>(key: string, make: () => Promise<T>): Promise<T> {
  let hit = computed.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = make();
    hit.catch(() => computed.delete(key));
    computed.set(key, hit);
    if (computed.size > 200) computed.delete(computed.keys().next().value ?? "");
  }
  return hit;
}
async function allTowns(fetcher: typeof fetch) {
  const m = await meta(fetcher);
  towns ??= asset<{ towns: [number, string, string, string, number, number, number][] }>(`${m.directory}/towns.json.gz`, fetcher).then(parseTowns).catch((error) => { towns = undefined; throw error; });
  return towns;
}

async function asset<T>(file: string, fetcher: typeof fetch): Promise<T> {
  let hit = cache.get(file);
  if (!hit) {
    hit = (async () => {
      const res = await fetcher(`/trail-data/${file}`);
      if (!res.ok) throw new Error("Trail data could not load. Please try again.");
      if (file.endsWith(".gz")) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        // Hosts may already decompress .gz responses through Content-Encoding.
        const blob = new Blob([bytes]);
        const text =
          bytes[0] === 0x1f && bytes[1] === 0x8b
            ? await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text()
            : await blob.text();
        return JSON.parse(text);
      }
      return res.json();
    })().catch((error) => {
      cache.delete(file);
      throw error;
    });
    cache.set(file, hit);
    if (cache.size > 80) cache.delete(cache.keys().next().value ?? "");
  }
  return hit as Promise<T>;
}

function meta(fetcher: typeof fetch) {
  metadata ??= asset<{ directory: string }>("current.json", fetcher)
    .then((p) => asset<Metadata>(`${p.directory}/manifest.json`, fetcher))
    .catch((error) => {
      metadata = undefined;
      throw error;
    });
  return metadata;
}

/** Every cell file of the given 2° cells: the U.S./Canada file and one file per country with worldwide trails. */
function cellRefs(keys: string[], m: Metadata) {
  return keys.flatMap((k) => [...(m.cells.includes(k) ? [k] : []), ...(m.worldCells?.[k] ?? []).map((c) => cellRef(k, c))]);
}
/** 2° cells (U.S./Canada or worldwide) that overlap a box. */
function cellKeysIn(m: Metadata, box: [number, number, number, number]) {
  return [...new Set([...m.cells, ...Object.keys(m.worldCells ?? {})])].filter((key) => {
    const [w, s, e, n] = cellBounds(key);
    return w <= box[2] && e >= box[0] && s <= box[3] && n >= box[1];
  });
}

/** Rows of the given cell files (refs from cellRefs or the search index). */
async function cells(refs: string[], m: Metadata, fetcher: typeof fetch) {
  const known = (ref: string) => (ref.includes("~") ? (m.worldCells?.[cellKeyOf(ref)] ?? []).includes(ref.split("~")[1]) : m.cells.includes(ref));
  const rows = (
    await Promise.all(
      [...new Set(refs)].filter(known).map((ref) => asset<CatalogTrail[]>(`${m.directory}/${cellFile(ref)}`, fetcher)),
    )
  ).flat();
  // A long trail is listed in every cell its line crosses; keep one copy.
  const seen = new Set<string>();
  return rows.filter((t) => t.confidence !== "REJECTED" && !seen.has(t.id) && Boolean(seen.add(t.id))).map((t) => ({ ...t, name: readableTrailName(t.name, t.id) }));
}

let curatedPromise: Promise<{ lines: Record<string, Lines>; links: Record<string, string> }> | undefined;
/** Real lines and catalog links for the curated guides (built by scripts/ingestion/rebuild-catalog.ts). */
function curated(m: Metadata, fetcher: typeof fetch) {
  curatedPromise ??= asset<{ lines: Record<string, Lines>; links: Record<string, string> }>(`${m.directory}/curated.json.gz`, fetcher).catch(() => ({ lines: {}, links: {} }));
  return curatedPromise;
}

type IndexRow = [id: string, name: string, alt: string, place: string, score: number];
interface IndexEntry { id: string; score: number; entry: SearchEntry }
const toEntries = (rows: IndexRow[]): IndexEntry[] => rows.map(([id, name, alt, place, score]) => ({
  id, score: Number(score) || 0,
  entry: searchEntry({ name, altNames: alt ? alt.split(" | ") : [], manager: place }),
}));
const searchFiles = new Map<string, Promise<IndexEntry[]>>();
/** One search file (q/<key>, q/r-<region>, q/c-<country>); a missing file has no trails. */
function searchFile(m: Metadata, key: string, fetcher: typeof fetch) {
  let hit = searchFiles.get(key);
  if (!hit) {
    hit = asset<IndexRow[]>(`${m.directory}/q/${key}.json.gz`, fetcher).then(toEntries).catch(() => { searchFiles.delete(key); return []; });
    searchFiles.set(key, hit);
  }
  return hit;
}
/**
 * Search files a query needs: one per distinct word (3+ letters) — common words like "trail" only when the query
 * has nothing else — plus the best-trails file of any region or country the query names.
 */
function queryFiles(m: Metadata, q: string, country?: string) {
  const words = normalizeText(q).split(" ").filter((w) => w.length >= 3);
  const specific = words.filter((w) => !SEARCH_STOPWORDS.has(w));
  const keys = new Set((specific.length ? specific : words).map(searchKey));
  const text = ` ${normalizeText(q)} `;
  const regions = new Set(m.searchRegions ?? []);
  const countries = new Set(m.searchCountries ?? []);
  for (const code of countries) if (text.includes(` ${normalizeText(countryName(code))} `)) keys.add(`c-${code}`);
  if (country && countries.has(country)) keys.add(`c-${country}`);
  // Region names up to four words long ("new south wales", "baden wurttemberg").
  const tokens = text.trim().split(" ");
  for (let i = 0; i < tokens.length; i++) for (let n = 1; n <= 4 && i + n <= tokens.length; n++) {
    const slug = regionSlug(tokens.slice(i, i + n).join(" "));
    if (slug.length > 3 && regions.has(slug)) keys.add(`r-${slug}`);
  }
  return [...keys].slice(0, 8);
}

const rowFiles = (m: Metadata, ids: string[], fetcher: typeof fetch) =>
  Promise.all([...new Set(ids.map(rowShard))].map((k) => asset<Record<string, CatalogTrail | string>>(`${m.directory}/rows/r-${k}.json.gz`, fetcher).catch(() => ({}) as Record<string, CatalogTrail | string>)));
/**
 * Records of ranked trail ids, loaded a batch at a time until the requested page is full after the page's filters
 * (or 400 are loaded, or the list runs out).
 */
async function pageOfRows(m: Metadata, ids: string[], f: ReturnType<typeof parseCatalogFilters>, fetcher: typeof fetch) {
  const need = (f.page ?? 1) * (f.limit ?? TRAIL_CARD_LIMIT);
  const out: CatalogTrail[] = [];
  let shown = 0;
  for (let i = 0; i < ids.length && i < 400 && shown < need; ) {
    const batch = ids.slice(i, i + Math.max(36, need - shown + 12));
    i += batch.length;
    out.push(...(await rowsById(m, batch, fetcher)));
    // Lists show one card per name, so count the way the list will.
    shown = filterCatalog(out, { ...f, page: undefined, limit: undefined, uniqueNames: true }).total;
  }
  return out;
}

/** Full records of trails by id (merged ids are skipped). */
async function rowsById(m: Metadata, ids: string[], fetcher: typeof fetch) {
  const files = await rowFiles(m, ids, fetcher);
  const all = Object.assign({}, ...files) as Record<string, CatalogTrail | string>;
  return ids.flatMap((id) => { const r = all[id]; return r && typeof r === "object" ? [{ ...r, name: readableTrailName(r.name, r.id) }] : []; });
}

function getCuratedExtraTrails(): CatalogTrail[] {
  const peaks = getAllPeakTrails();
  const { thruHikes, sections: detailedSections } = getDetailedThruHikeTrails();
  return [...peaks, ...thruHikes, ...detailedSections];
}

async function select(params: URLSearchParams, fetcher: typeof fetch): Promise<{ rows: CatalogTrail[]; manifest: Metadata; queryMatches?: number }> {
  const m = await meta(fetcher);
  const f = parseCatalogFilters(params);
  const curated = getCuratedExtraTrails();

  if (f.q) {
    const terms = normalize(f.q).split(/\s+/).filter(Boolean);
    // Fuzzy match over names, other names and places in the few small search files the query's words point to;
    // only the best-ranked trails' records are loaded. A query naming a region or country adds its best trails.
    const files = await Promise.all(queryFiles(m, f.q, f.country).map((k) => searchFile(m, k, fetcher)));
    const seenIds = new Set<string>();
    const all = files.flat()
      .filter((e) => !seenIds.has(e.id) && Boolean(seenIds.add(e.id)))
      .map((e) => ({ e, rank: searchRank(matchScore(f.q!, e.entry), e.score, placeMatch(f.q!, e.entry)) }))
      .filter((x) => x.rank >= 100)
      .sort((a, b) => b.rank - a.rank);
    // Enough records for the requested page after filters; `queryMatches` keeps the true count of matching trails.
    const found = await pageOfRows(m, all.map((x) => x.e.id), f, fetcher);
    const matchedCurated = curated.filter((t) => {
      const text = normalize(`${t.name} ${t.region ?? ""} ${t.country} ${t.note ?? ""} ${(t.tags ?? []).join(" ")}`);
      return terms.every((term) => text.includes(term));
    });
    // Curated guides first; catalog rows that duplicate a guide's id are dropped (not the other way round).
    const seen = new Set(matchedCurated.map((r) => r.id));
    return { rows: [...matchedCurated, ...found.filter((r) => !seen.has(r.id))], manifest: m, queryMatches: all.length + matchedCurated.length };
  }

  if (f.collection) {
    // Return curated collection rows directly with high performance
    return { rows: curated, manifest: m };
  }

  if (f.bbox || (f.lat !== undefined && f.lng !== undefined)) {
    const lat = f.lat ?? 0,
      lng = f.lng ?? 0,
      pad = Math.min(50, f.radiusKm ?? 25) / 110;
    const box = f.bbox ?? [
      lng - pad / Math.max(0.2, Math.cos((lat * Math.PI) / 180)),
      lat - pad,
      lng + pad / Math.max(0.2, Math.cos((lat * Math.PI) / 180)),
      lat + pad,
    ];
    const keys = cellKeysIn(m, box as [number, number, number, number]);
    const cellRows = keys.length <= 16 ? await cells(cellRefs(keys, m), m, fetcher) : [];
    const seen = new Set(curated.map((r) => r.id));
    return { rows: [...curated, ...cellRows.filter((r) => !seen.has(r.id))], manifest: m };
  }

  // A country or region picked without a search or a place: its best-documented trails.
  const area = f.region ? `r-${regionSlug(normalizeText(f.region))}` : f.country && f.country !== "intl" ? `c-${f.country}` : null;
  if (area) {
    const found = await pageOfRows(m, (await searchFile(m, area, fetcher)).map((e) => e.id), f, fetcher);
    const seen = new Set(curated.map((r) => r.id));
    return { rows: [...curated, ...found.filter((r) => !seen.has(r.id))], manifest: m };
  }
  const overview = await asset<CatalogTrail[]>(`${m.directory}/overview.json.gz`, fetcher);
  const seen = new Set(curated.map((r) => r.id));
  return { rows: [...curated, ...overview.filter((r) => !seen.has(r.id))], manifest: m };
}

async function detail(
  id: string,
  fetcher: typeof fetch,
): Promise<{ trail: CatalogTrail; lines: Lines; manifest: Metadata } | null> {
  const m = await meta(fetcher);
  // Curated guides draw the real line of the trail they were matched to at build time, or no line at all.
  const guide = async (trail: CatalogTrail) => {
    const c = await curated(m, fetcher);
    const linked = c.links[trail.id];
    return { trail: linked ? { ...trail, linkedTrailId: linked } : trail, lines: (c.lines[trail.id] ?? []) as Lines, manifest: m };
  };

  // 1. Check Peaks (14ers, 8000m, Seven Summits)
  const peak = getAllPeakTrails().find((p) => p.id === id);
  if (peak) return guide(peak);

  // 2. Check Detailed Through-Hike Routes ("ALL TOGETHER")
  const detailedHike = DETAILED_THRU_HIKES.find((h) => h.id === id);
  if (detailedHike) {
    const { thruHikes } = getDetailedThruHikeTrails();
    return guide(thruHikes.find((t) => t.id === id)!);
  }

  // 3. Check Detailed Through-Hike Individual Sections ("IN SECTIONS")
  for (const hike of DETAILED_THRU_HIKES) {
    const sec = hike.sections.find((s) => s.id === id);
    if (sec) {
      const { sections } = getDetailedThruHikeTrails();
      return guide(sections.find((t) => t.id === id)!);
    }
  }

  // 4. Full records by id (merged records redirect to the whole trail)
  const where = (await rowFiles(m, [id], fetcher))[0][id];
  if (!where) return null;
  if (typeof where === "string") return where.startsWith("r:") && where.slice(2) !== id ? detail(where.slice(2), fetcher) : null;
  return withLines({ ...where, name: readableTrailName(where.name, where.id) }, m, fetcher);
}

/** A catalog trail with its mapped line and nearest trailhead. */
async function withLines(trail: CatalogTrail, m: Metadata, fetcher: typeof fetch): Promise<{ trail: CatalogTrail; lines: Lines; manifest: Metadata }> {
  let lines: Lines = [];
  if (trail.geometryShard !== "route" && trail.source !== "resort") {
    lines = (await asset<Record<string, Lines>>(`${m.directory}/geometry-${trail.geometryShard}.json.gz`, fetcher))[trail.id] ?? [];
  } else if (trail.memberIds?.length) {
    for (const memberId of trail.memberIds) {
      const member = await detail(memberId, fetcher);
      if (member) lines.push(...member.lines);
    }
  }
  const ends = trailEnds(lines);
  if (ends && !trail.trailhead) {
    trailheads ??= asset<TrailheadCache>(`${m.directory}/trailheads.json.gz`, fetcher)
      .then((data) => new TrailheadIndex(data.trailheads))
      .catch((error) => {
        trailheads = undefined;
        throw error;
      });
    const head = (await trailheads).nearest(ends);
    trail.trailhead = head ?? { kind: "trail-end", name: null, longitude: ends[0][0], latitude: ends[0][1], toTrailMeters: 0 };
  }
  return { trail, lines, manifest: m };
}

/** Rows of the hike-feature layer for the given 1° cells (cells without features are skipped). */
async function featureRows(cellIds: string[], m: Metadata, fetcher: typeof fetch): Promise<FeatureRow[]> {
  const have = new Set(m.featureCells ?? []);
  const parts = await Promise.all(cellIds.filter((c) => have.has(c)).map((c) => asset<FeatureRow[]>(`${m.directory}/features/f-${c}.json.gz`, fetcher)));
  return parts.flat();
}

/** Features on or near one trail with their mile markers, or null when this build has no feature layer. */
async function trailFeatures(d: { trail: CatalogTrail; lines: Lines }, fetcher: typeof fetch): Promise<TrailFeature[] | null> {
  const m = await meta(fetcher);
  if (!m.featureCells?.length) return null;
  const cellIds = new Set<string>();
  for (const line of d.lines) for (const p of line) cellIds.add(geometryCell(p[0], p[1]));
  return memo(`features:${d.trail.id}`, async () => featuresAlong(await featureRows([...cellIds].slice(0, 80), m, fetcher), d.trail.id));
}

/** Water along a trail: from the feature layer when the build has one, otherwise read from map tiles. */
async function waterFor(d: { trail: CatalogTrail; lines: Lines }, chained: LngLat[][], fetcher: typeof fetch) {
  const features = await trailFeatures(d, fetcher).catch(() => null);
  if (features) return waterFromFeatures(features, measureLines(chained).meters / 1609.344);
  return memo(`water:${d.trail.id}`, () => waterAlong(chained));
}

/** The 2–3 nearest real towns for a day hike (more, spread along the route, for long trails), with services. */
function townsFor(d: { trail: CatalogTrail }, chained: LngLat[][], maxMilesOff: number, limit: number | undefined, fetcher: typeof fetch) {
  const lines = chained.length ? chained : [[[d.trail.longitude, d.trail.latitude], [d.trail.longitude + 0.00001, d.trail.latitude]] as LngLat[]];
  const long = d.trail.kind === "route" || (d.trail.miles ?? 0) > 60;
  const count = limit ?? (long ? Math.min(60, Math.ceil((d.trail.miles ?? 100) / 25)) : 3);
  return memo(`towns:${d.trail.id}:${maxMilesOff}:${count}`, async () => {
    const near = townsNear(await allTowns(fetcher), lines, maxMilesOff, count);
    const out = [];
    for (let i = 0; i < near.length; i += 6) out.push(...await Promise.all(near.slice(i, i + 6).map(async (town) => ({ ...town, services: await townServices(town).catch(() => null) }))));
    return out;
  });
}

/** Everything a packet or download needs, all from real sources (missing parts are left out, never filled in). */
async function tripBundle(d: { trail: CatalogTrail; lines: Lines }, chained: LngLat[][], options: ReturnType<typeof townDayOptions>, pack: PackItem[], fetcher: typeof fetch): Promise<TripBundle> {
  const [water, towns, elevation] = await Promise.all([
    chained.length ? waterFor(d, chained, fetcher).catch(() => null) : Promise.resolve(null),
    townsFor(d, chained, options?.maxMilesOffTrail ?? 15, undefined, fetcher).catch(() => []),
    chained.length ? memo(`elev:${d.trail.id}`, () => elevationProfile(chained)).catch(() => null) : Promise.resolve(null),
  ]);
  const t = { trail: d.trail, lines: chained };
  const consumables = [...(options?.consumables ?? []), ...pack.filter((i) => i.consumable).map((i) => i.name)];
  const plan = options && chained.length && mappedShare(t) >= MIN_MAPPED_SHARE ? planTownDays(towns, { ...options, consumables, trailMiles: planningMiles(t) }) : null;
  return { trail: d.trail, lines: chained as [number, number][][], water, towns, elevation, plan, pack, siteUrl: typeof window !== "undefined" ? window.location.origin : "", generatedAt: new Date().toISOString() };
}

function packetResponse(bundle: TripBundle, format: string) {
  const base = `hyked-${bundle.trail.name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "trail"}`;
  const file = (body: string, type: string, ext: string, inline = false) => new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${base}.${ext}"` } });
  switch (format) {
    case "gpx": return file(tripGpx(bundle), "application/gpx+xml", "gpx");
    case "csv": return file(waterCsv(bundle), "text/csv", "water.csv");
    case "html": return file(tripPacketHtml(bundle), "text/html", "html", true);
    case "json": return Response.json(bundle);
    default: return Response.json({ error: "format must be gpx, csv, html or json" }, { status: 400 });
  }
}

/** POST /api/trips/packet: the printable packet with the planner's pack list. */
export async function tripPacket(body: Record<string, unknown>, fetcher: typeof fetch) {
  const d = await detail(String(body.trailId ?? ""), fetcher);
  if (!d) return Response.json({ error: "This trail was not found." }, { status: 404 });
  const pack: PackItem[] = (Array.isArray(body.pack) ? body.pack : []).slice(0, 300).flatMap((raw) => {
    const i = raw as Record<string, unknown>;
    const name = typeof i.name === "string" ? i.name.trim().slice(0, 120) : "";
    return name ? [{ name, quantity: Number(i.quantity) > 0 ? Number(i.quantity) : 1, weightOz: Number.isFinite(Number(i.weightOz)) ? Number(i.weightOz) : null, category: typeof i.category === "string" ? i.category : null, consumable: i.consumable === true }] : [];
  });
  return packetResponse(await tripBundle(d, chainLines(d.lines as LngLat[][]), townDayOptions(body), pack, fetcher), String(body.format ?? "html"));
}

/**
 * Trail lines for routing inside a bounding box: verified and mapped trails (no winter-only routes), full
 * resolution so junctions line up. Trails are found by their pin within 0.25° of the box, then kept when a
 * line actually enters it.
 */
async function routingNetwork(box: [number, number, number, number], fetcher: typeof fetch): Promise<GeoJSON.FeatureCollection> {
  const m = await meta(fetcher);
  const pad = 0.25;
  const keys = cellKeysIn(m, [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad]);
  const rows = (await cells(cellRefs(keys, m), m, fetcher)).filter((t) =>
    !t.mergedInto && !t.winterUse && t.source !== "resort" && t.geometryShard && t.geometryShard !== "route" &&
    t.longitude >= box[0] - pad && t.longitude <= box[2] + pad && t.latitude >= box[1] - pad && t.latitude <= box[3] + pad,
  ).sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));
  const shards = new Map<string, Promise<Record<string, Lines>>>();
  for (const t of rows) if (!shards.has(t.geometryShard)) shards.set(t.geometryShard, asset<Record<string, Lines>>(`${m.directory}/geometry-${t.geometryShard}.json.gz`, fetcher).catch(() => ({})));
  const inside = ([x, y]: [number, number]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
  const features: GeoJSON.Feature[] = [];
  for (const t of rows) {
    const lines = ((await shards.get(t.geometryShard)!)[t.id] ?? []).filter((line) => line.length > 1 && line.some(inside));
    if (!lines.length) continue;
    features.push({ type: "Feature", id: t.id, properties: { id: t.id, name: t.name, q: t.qualityScore ?? 0, tier: t.tier ?? (t.sourceType ? "verified" : "mapped") }, geometry: { type: "MultiLineString", coordinates: lines } });
    if (features.length >= 4000) break;
  }
  return { type: "FeatureCollection", features };
}

export function isTrailServicePath(path: string) {
  return path === "/api/trail-catalog" || path.startsWith("/api/trail-catalog/");
}

export async function trailService(request: Request, fetcher: typeof fetch): Promise<Response> {
  const url = new URL(request.url),
    params = url.searchParams;
  if (request.method !== "GET") return Response.json({ error: "This trail action is not supported." }, { status: 405 });
  try {
    const suffix = url.pathname.slice("/api/trail-catalog".length).split("/").filter(Boolean);
    // Dedicated endpoint for All Long-Distance Through-Hike Geometries
    if (suffix[0] === "thru-hikes") {
      const features: GeoJSON.Feature[] = [];
      for (const hike of DETAILED_THRU_HIKES) {
        const lines = (await curated(await meta(fetcher), fetcher)).lines[hike.id] as Lines | undefined;
        if (lines && lines.length) {
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
      return Response.json({ type: "FeatureCollection", features });
    }

    // Hike features in view (water, campsites, shelters, trailheads, viewpoints…) from the build-time feature layer.
    // `pois` is the GeoJSON form of the same data.
    if (suffix[0] === "features" || suffix[0] === "pois") {
      const m = await meta(fetcher);
      const bbox = parseCatalogFilters(params).bbox;
      const types = new Set((params.get("types") ?? "").split(",").filter(Boolean));
      const rows = bbox
        ? (await featureRows(cellsInBounds(bbox, 0, 16), m, fetcher)).filter((r) => r[3] >= bbox[0] && r[3] <= bbox[2] && r[4] >= bbox[1] && r[4] <= bbox[3] && (!types.size || types.has(r[1])))
        : [];
      const features = rows.slice(0, 5000).map(featureFromRow);
      if (suffix[0] === "pois") {
        return Response.json({ type: "FeatureCollection", features: features.map((f) => ({ type: "Feature", id: f.id, properties: { id: f.id, type: f.type, kind: f.type, name: f.name, label: FEATURE_LABELS[f.type] }, geometry: { type: "Point", coordinates: [f.lon, f.lat] } })) });
      }
      return Response.json({ features, total: rows.length, source: "© OpenStreetMap contributors (ODbL)" });
    }

    // Dedicated Snap-to-Trail endpoint (Projects user click or GPS waypoint directly to trail vector geometry)
    if (suffix[0] === "snap") {
      const lat = Number(params.get("lat"));
      const lng = Number(params.get("lng"));
      const tolerance = Number(params.get("tolerance") ?? 50);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return Response.json({ error: "lat and lng query parameters required." }, { status: 400 });
      }

      const { rows } = await select(new URLSearchParams({ lat: String(lat), lng: String(lng), radiusKm: "15" }), fetcher);
      const candidateLines: [number, number][][] = [];

      for (const r of rows.slice(0, 20)) {
        const d = await detail(r.id, fetcher);
        if (d?.lines) candidateLines.push(...d.lines);
      }

      // Also include detailed thru-hikes if nearby
      for (const hike of DETAILED_THRU_HIKES) {
        const lines = (await curated(await meta(fetcher), fetcher)).lines[hike.id] as Lines | undefined;
        if (lines) candidateLines.push(...lines);
      }

      const snapped = snapPointToNearestLine([lng, lat], candidateLines, tolerance);
      if (snapped) {
        return Response.json(snapped);
      }

      return Response.json({
        snapped: [lng, lat],
        distanceMeters: Infinity,
        alongMeters: 0,
        segmentIndex: -1,
        original: [lng, lat],
        isSnapped: false,
      });
    }

    // Route builder network: every shown trail whose line enters the box, at full resolution (src/lib/routing).
    if (suffix[0] === "network") {
      const box = parseCatalogFilters(params).bbox;
      if (!box || box[2] - box[0] > 3.2 || box[3] - box[1] > 3.2) return Response.json({ error: "Choose points closer together (within about 150 miles)." }, { status: 400 });
      return Response.json(await routingNetwork(box, fetcher));
    }

    // Towns by name (GeoNames) for the route builder's start and end search; bigger places first.
    if (suffix[0] === "places") {
      const q = normalize(params.get("q") ?? "");
      if (q.length < 2) return Response.json({ places: [] });
      const near = [Number(params.get("lng")), Number(params.get("lat"))];
      const places = (await allTowns(fetcher))
        .filter((t) => normalize(t.name).startsWith(q))
        .map((t) => ({ t, km: Number.isFinite(near[0]) && Number.isFinite(near[1]) ? distanceKm(near[1], near[0], t.latitude, t.longitude) : 0 }))
        .sort((a, b) => a.km - b.km || (b.t.population ?? 0) - (a.t.population ?? 0))
        .slice(0, 6)
        .map(({ t }) => ({ name: t.name, region: t.state, country: t.country, lat: t.latitude, lng: t.longitude }));
      return Response.json({ places, attribution: "GeoNames (CC BY 4.0)" });
    }

    // Zoomed-out count bubbles: build-time totals per grid cell and section (see scripts/prepare-trail-assets.ts).
    if (suffix[0] === "clusters") {
      const m = await meta(fetcher);
      const f = parseCatalogFilters(params);
      const zoom = Number(params.get("zoom") ?? 4);
      const grid = zoom < 3.5 ? "8" : zoom < 4.5 ? "4" : zoom < 5.5 ? "2" : zoom < 6.5 ? "1" : zoom < 8 ? "0.5" : "0.25";
      const data = await asset<{ sections: Record<string, Record<string, number[][]>> }>(`${m.directory}/clusters.json.gz`, fetcher);
      const key = sectionOf(f.activity === "all" ? "hike" : f.activity).key;
      const [w, sth, e, n] = f.bbox ?? [-180, -90, 180, 90];
      const clusters = (data.sections[key]?.[grid] ?? []).filter(([lng, lat]) => lng >= w && lng <= e && lat >= sth && lat <= n);
      return Response.json({ total: clusters.reduce((t, c) => t + c[2], 0), verified: clusters.reduce((t, c) => t + c[3], 0), clusters, grid });
    }

    if (!suffix.length || ["points", "lines", "map"].includes(suffix[0])) {
      const zoom = Number(params.get("zoom") ?? 11);
      if (["points", "lines"].includes(suffix[0]) && !localTrailsVisible(zoom)) {
        return Response.json(suffix[0] === "points" ? { trails: [], clusters: [], total: 0 } : { type: "FeatureCollection", features: [] });
      }
      const { rows, manifest, queryMatches } = await select(params, fetcher);
      const f = parseCatalogFilters(params);
      const bbox = f.bbox;
      const local = bbox ? { ...f, lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2, radiusKm: 1000 } : f;
      // The map draws every trail in view (same-name trails are separate trails); lists show one per name.
      const result = filterCatalog(rows, { ...local, limit: suffix.length ? MAP_TRAIL_LIMIT : f.limit ?? TRAIL_CARD_LIMIT, uniqueNames: !suffix.length });

      if (suffix[0] === "points") {
        const trails: (string | number | null)[][] = result.trails.map((t) => [
          t.id,
          t.name,
          t.longitude,
          t.latitude,
          t.miles,
          { easy: "e", moderate: "m", hard: "h", expert: "x" }[
            trailDifficulty(t)
          ],
          t.park ?? t.forest ?? t.region,
          t.routeType ?? null,
          t.qualityScore ?? 0,
          t.gainFt ?? null,
          t.lossFt ?? null,
          t.steepestGradePct ?? null,
          Math.round(listScore(t)),
        ]);

        // `total` is every matching trail in view; `trails` is the best-ranked first page of it.
        return Response.json({ total: result.total, clusters: [], trails });
      }

      if (suffix[0] === "lines") {
        // Lines straight from the geometry cells (one file per 1° cell), not one trail page at a time.
        const shards = new Map<string, Promise<Record<string, Lines>>>();
        for (const t of result.trails) {
          if (t.geometryShard && t.geometryShard !== "route" && t.source !== "resort" && !shards.has(t.geometryShard)) {
            shards.set(t.geometryShard, asset<Record<string, Lines>>(`${manifest.directory}/geometry-${t.geometryShard}.json.gz`, fetcher).catch(() => ({})));
          }
        }
        const features = await Promise.all(
          result.trails.map(async (t) => {
            const lines = shards.has(t.geometryShard) ? (await shards.get(t.geometryShard)!)[t.id] ?? [] : (await detail(t.id, fetcher))?.lines ?? [];
            const simplified = lines.map((line) => simplifyForZoom(line as [number, number][], zoom));
            return {
              type: "Feature",
              id: t.id,
              properties: {
                id: t.id,
                name: t.name,
                d: { easy: "e", moderate: "m", hard: "h", expert: "x" }[
                  trailDifficulty(t)
                ],
              },
              geometry: { type: "MultiLineString", coordinates: simplified },
            };
          }),
        );

        return Response.json({ type: "FeatureCollection", features: features.slice(0, MAP_TRAIL_LIMIT) });
      }

      if (suffix[0] === "map") return Response.json(buildCatalogMap(result.trails));
      return Response.json({ ...result, manifest, ...(queryMatches && queryMatches > result.total ? { queryMatches } : {}) });
    }

    const d = await detail(decodeURIComponent(suffix[0]), fetcher);
    if (!d) return Response.json({ error: "This trail is not in the current source catalog." }, { status: 404 });
    if (!suffix[1]) return Response.json(d);

    if (suffix[1] === "nearby") {
      // Up to 5 other trails within 35 km, nearest first, straight from the catalog cells (no per-trail page loads,
      // which made long routes nearby take minutes). Directions use a trail's stored trailhead, else its start.
      const t = d.trail;
      const { rows } = await select(new URLSearchParams({ lat: String(t.latitude), lng: String(t.longitude), radiusKm: "35" }), fetcher);
      const near = filterCatalog(rows.filter((r) => r.id !== t.id && r.kind === "segment"), { lat: t.latitude, lng: t.longitude, radiusKm: 35, limit: 48, uniqueNames: true }).trails
        .map((r) => ({ ...r, distanceKm: distanceKm(t.latitude, t.longitude, r.latitude, r.longitude) }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 5);
      return Response.json({ trails: near });
    }

    // Photos: only the licensed Commons image of the trail's matched Wikidata item. No nearby-image guessing.
    // ?nearby=1: geotagged Commons photos near the pin, shown lower on the page and labelled as nearby.
    if (suffix[1] === "photos") {
      if (params.get("nearby") === "1") return Response.json({ photos: await memo(`nearby:${d.trail.id}`, () => nearbyCatalogPhotos(d.trail.latitude, d.trail.longitude)).catch(() => []), nearby: true });
      return Response.json({ photos: wikiPhotos(d.trail) });
    }

    // GPX of the trail's own mapped line.
    if (suffix[1] === "gpx") {
      return new Response(catalogGpx(d.trail, d.lines), {
        headers: {
          "Content-Type": "application/gpx+xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${d.trail.name.replace(/[^a-zA-Z0-9_-]+/g, "-")}.gpx"`,
        },
      });
    }

    // Facts below are computed from the trail's real line; with no line there is nothing to compute.
    const chained = chainLines(d.lines as LngLat[][]);
    const noLine = (what: string) => Response.json({ error: `This trail has no mapped line, so ${what} can't be measured.` }, { status: 422 });

    // Elevation: sampled from AWS Terrain Tiles (Mapzen Terrarium; USGS 3DEP, SRTM) along the line.
    if (suffix[1] === "elevation") {
      if (!chained.length) return noLine("its elevation");
      const profile = await memo(`elev:${d.trail.id}`, () => elevationProfile(chained));
      if (!profile) return Response.json({ error: "Elevation data couldn't be read for this trail. Try again." }, { status: 503 });
      return Response.json({ ...profile, source: "AWS Terrain Tiles (Terrarium DEM)" });
    }

    // Water: OpenStreetMap springs, drinking water, lakes and stream crossings, each at its real trail mile.
    if (suffix[1] === "water") {
      if (!chained.length) return noLine("water along it");
      return Response.json(await waterFor(d, chained, fetcher));
    }

    // Every hike feature on or near the trail (water, campsites, shelters, viewpoints…), by mile.
    if (suffix[1] === "features") {
      if (!chained.length) return noLine("features along it");
      const features = await trailFeatures(d, fetcher);
      return Response.json({ features: features ?? [], available: features !== null, source: "© OpenStreetMap contributors (ODbL)" });
    }

    // Downloads: GPX with water and towns, water CSV, printable packet — built from the same real data.
    if (suffix[1] === "download") {
      const format = params.get("format") ?? "gpx";
      return packetResponse(await tripBundle(d, chained, townDayOptions(Object.fromEntries(params)), [], fetcher), format);
    }

    // Towns: real GeoNames places near the line, with services counted from OpenStreetMap.
    if (suffix[1] === "towns" || suffix[1] === "town-days") {
      const maxMilesOff = Math.min(40, Math.max(1, Number(params.get("maxMilesOff")) || 15));
      const limit = params.get("limit") ? Math.min(60, Math.max(1, Number(params.get("limit")) || 6)) : undefined;
      const towns = await townsFor(d, chained, maxMilesOff, limit, fetcher);
      if (suffix[1] === "towns") return Response.json({ towns, maxMilesOff, attribution: TOWNS_ATTRIBUTION });
      const options = townDayOptions(Object.fromEntries(params));
      if (!options) return Response.json({ error: "Give the number of hiking days, e.g. ?days=5." }, { status: 400 });
      const t = { trail: d.trail, lines: chained };
      if (!chained.length) return noLine("town stops along it");
      if (mappedShare(t) < MIN_MAPPED_SHARE) return Response.json({ error: unplannable(t) }, { status: 422 });
      return Response.json({ trailId: d.trail.id, trailMiles: planningMiles(t), ...planTownDays(towns, { ...options, trailMiles: planningMiles(t) }), attribution: TOWNS_ATTRIBUTION });
    }

    return Response.json({ error: "Action not supported." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Trail data could not load." }, { status: 503 });
  }
}
/** [id, name, lng, lat, country, region, locality, activity codes, runs, lifts, top m, base m, website] */
export type SkiAreaRow = [string, string, number, number, string, string, string, string, number, number, number | null, number | null, string];
/** Every operating ski area (OpenSkiMap), from the build's ski-areas.json.gz; empty when the build has none. */
export async function skiAreaRows(fetcher: typeof fetch): Promise<SkiAreaRow[]> {
  const m = await meta(fetcher);
  return (await asset<{ areas: SkiAreaRow[] }>(`${m.directory}/ski-areas.json.gz`, fetcher).catch(() => ({ areas: [] }))).areas;
}
