import { parseCatalogFilters, filterCatalog, normalize, distanceKm } from "@/lib/trail-catalog/search";
import type { CatalogTrail, CatalogManifest } from "@/lib/trail-catalog/types";
import { buildCatalogMap } from "@/lib/trail-catalog/map";
import { resolveDifficulty } from "@/lib/trail-difficulty";
import { chainLines } from "@/lib/geo/line";
import { measureLines } from "@/lib/trail-catalog/quality";
import { nearbyCatalogPhotos, wikiPhotos } from "@/lib/trail-catalog/photos";
import { matchScore, placeMatch, searchEntry, searchRank, type SearchEntry } from "@/lib/trail-catalog/fuzzy";
import type { LngLat } from "@/lib/geo/tiles";
import { elevationProfile } from "@/lib/trip/elevation";
import { waterAlong } from "@/lib/trip/water";
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
import { fetchLiveOsmTrails } from "@/lib/geo/overpass";
import { snapPointToNearestLine, simplifyForZoom } from "@/lib/geo/snap";
import { trailSacScale } from "@/lib/trail-catalog/types";

type Metadata = CatalogManifest & { directory: string; cells: string[] };
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

async function cells(keys: string[], m: Metadata, fetcher: typeof fetch) {
  const rows = (
    await Promise.all(
      keys.filter((k) => m.cells.includes(k)).map((k) => asset<CatalogTrail[]>(`${m.directory}/cell-${k}.json.gz`, fetcher)),
    )
  ).flat();
  return rows.filter((t) => t.confidence !== "REJECTED").map((t) => ({ ...t, name: readableTrailName(t.name, t.id) }));
}

let curatedPromise: Promise<{ lines: Record<string, Lines>; links: Record<string, string> }> | undefined;
/** Real lines and catalog links for the curated guides (built by scripts/ingestion/rebuild-catalog.ts). */
function curated(m: Metadata, fetcher: typeof fetch) {
  curatedPromise ??= asset<{ lines: Record<string, Lines>; links: Record<string, string> }>(`${m.directory}/curated.json.gz`, fetcher).catch(() => ({ lines: {}, links: {} }));
  return curatedPromise;
}

type IndexRow = [id: string, name: string, alt: string, place: string, cell: string, score: number];
interface IndexEntry { id: string; cell: string; score: number; entry: SearchEntry }
let indexPromise: Promise<IndexEntry[]> | undefined;
/** The search index, kept in the browser's Cache Storage per snapshot so later visits skip the download. */
function searchIndex(m: Metadata, fetcher: typeof fetch) {
  indexPromise ??= (async () => {
    const file = `${m.directory}/search.json.gz`;
    let rows: IndexRow[] | null = null;
    const store = typeof caches !== "undefined" ? await caches.open("hyked-search").catch(() => null) : null;
    const key = `/trail-data/${file}.json`;
    const hit = await store?.match(key).catch(() => undefined);
    if (hit) rows = await hit.json().catch(() => null);
    if (!rows) {
      rows = await asset<IndexRow[]>(file, fetcher);
      await store?.put(key, new Response(JSON.stringify(rows), { headers: { "Content-Type": "application/json" } })).catch(() => undefined);
    }
    return rows.map(([id, name, alt, place, cell, score]) => ({
      id, cell, score: Number(score) || 0,
      entry: searchEntry({ name, altNames: alt ? alt.split(" | ") : [], manager: place }),
    }));
  })().catch((error) => { indexPromise = undefined; throw error; });
  return indexPromise;
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
    // Fuzzy match over names, other names and places; keep the best-ranked hits and load only their cells.
    const all = (await searchIndex(m, fetcher))
      .map((e) => ({ e, rank: searchRank(matchScore(f.q!, e.entry), e.score, placeMatch(f.q!, e.entry)) }))
      .filter((x) => x.rank >= 100)
      .sort((a, b) => b.rank - a.rank);
    // Only the best 300 are loaded; `queryMatches` keeps the true count of matching trails.
    const ranked = all.slice(0, 300);
    const keys = [...new Set(ranked.map((x) => x.e.cell))];
    const wanted = new Set(ranked.map((x) => x.e.id));
    const cellRows = (await cells(keys.slice(0, 40), m, fetcher)).filter((r) => wanted.has(r.id));
    const matchedCurated = curated.filter((t) => {
      const text = normalize(`${t.name} ${t.region ?? ""} ${t.country} ${t.note ?? ""} ${(t.tags ?? []).join(" ")}`);
      return terms.every((term) => text.includes(term));
    });
    // Curated guides first; catalog rows that duplicate a guide's id are dropped (not the other way round).
    const seen = new Set(matchedCurated.map((r) => r.id));
    return { rows: [...matchedCurated, ...cellRows.filter((r) => !seen.has(r.id))], manifest: m, queryMatches: all.length + matchedCurated.length };
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
    const keys = m.cells.filter((key) => {
      const [x, y] = key.split("_").map(Number);
      const w = x * 2 - 180,
        s = y * 2 - 90;
      return w <= box[2] && w + 2 >= box[0] && s <= box[3] && s + 2 >= box[1];
    });
    const cellRows = keys.length <= 16 ? await cells(keys, m, fetcher) : [];
    const seen = new Set(curated.map((r) => r.id));
    return { rows: [...curated, ...cellRows.filter((r) => !seen.has(r.id))], manifest: m };
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

  // 4. Check Sharded Source Trails (merged records redirect to the whole trail)
  const index = await searchIndex(m, fetcher);
  const entry = index.find((r) => r.id === id);
  if (!entry) {
    const redirect = (await asset<Record<string, string>>(`${m.directory}/redirects.json.gz`, fetcher).catch(() => ({}) as Record<string, string>))[id];
    return redirect && redirect !== id ? detail(redirect, fetcher) : null;
  }
  const trail = (await cells([entry.cell], m, fetcher)).find((t) => t.id === id);
  if (!trail) return null;
  let lines: Lines = [];
  if (trail.geometryShard !== "route" && trail.source !== "resort") {
    lines = (await asset<Record<string, Lines>>(`${m.directory}/geometry-${trail.geometryShard}.json.gz`, fetcher))[id] ?? [];
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
    chained.length ? memo(`water:${d.trail.id}`, () => waterAlong(chained)).catch(() => null) : Promise.resolve(null),
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

    // Dedicated endpoint for Mountain POIs (Trailheads, Water, Campsites, Summits, Parking)
    if (suffix[0] === "pois") {
      const f = parseCatalogFilters(params);
      const bbox = f.bbox;
      if (!bbox) {
        return Response.json({ type: "FeatureCollection", features: [] });
      }
      try {
        const live = await fetchLiveOsmTrails([bbox[1], bbox[0], bbox[3], bbox[2]]);
        const poiFeatures = live.features.filter((feat) => feat.geometry.type === "Point");
        return Response.json({ type: "FeatureCollection", features: poiFeatures });
      } catch {
        return Response.json({ type: "FeatureCollection", features: [] });
      }
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
      const result = filterCatalog(rows, { ...local, limit: suffix.length ? MAP_TRAIL_LIMIT : f.limit ?? TRAIL_CARD_LIMIT, uniqueNames: true });

      if (suffix[0] === "points") {
        const trails: (string | number | null)[][] = result.trails.map((t) => [
          t.id,
          t.name,
          t.longitude,
          t.latitude,
          t.miles,
          { easy: "e", moderate: "m", hard: "h", expert: "x" }[
            resolveDifficulty({ reported: t.difficulty, miles: t.miles, sacScale: trailSacScale(t) }).difficulty
          ],
          t.park ?? t.forest ?? t.region,
          t.routeType ?? null,
          t.qualityScore ?? 0,
        ]);

        // `total` is every matching trail in view; `trails` is the best-ranked first page of it.
        return Response.json({ total: result.total, clusters: [], trails });
      }

      if (suffix[0] === "lines") {
        const features = await Promise.all(
          result.trails.map(async (t) => {
            const d = await detail(t.id, fetcher);
            const simplified = (d?.lines ?? []).map((line) => simplifyForZoom(line as [number, number][], zoom));
            return {
              type: "Feature",
              id: t.id,
              properties: {
                id: t.id,
                name: t.name,
                d: { easy: "e", moderate: "m", hard: "h", expert: "x" }[
                  resolveDifficulty({ reported: t.difficulty, miles: t.miles, sacScale: trailSacScale(t) }).difficulty
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
      const t = d.trail;
      const { rows } = await select(new URLSearchParams({ lat: String(t.latitude), lng: String(t.longitude), radiusKm: "35" }), fetcher);
      const result = filterCatalog(rows.filter((r) => r.id !== t.id), { lat: t.latitude, lng: t.longitude, radiusKm: 35, limit: TRAIL_CARD_LIMIT, uniqueNames: true });
      return Response.json({
        trails: await Promise.all(
          result.trails.map(async (r) => {
            const full = await detail(r.id, fetcher);
            return { ...r, trailhead: full?.trail.trailhead, distanceKm: distanceKm(t.latitude, t.longitude, r.latitude, r.longitude) };
          }),
        ),
      });
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
      return Response.json(await memo(`water:${d.trail.id}`, () => waterAlong(chained)));
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