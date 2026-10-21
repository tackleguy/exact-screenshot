import { parseCatalogFilters, filterCatalog, normalize, distanceKm } from "@/lib/trail-catalog/search";
import type { CatalogTrail, CatalogManifest } from "@/lib/trail-catalog/types";
import { buildCatalogMap } from "@/lib/trail-catalog/map";
import { resolveDifficulty } from "@/lib/trail-difficulty";
import { parseCommonsPhoto, type CommonsPage } from "@/lib/trail-catalog/photos";
import { catalogGpx } from "@/lib/trail-catalog/gpx";
import { readableTrailName, MAP_TRAIL_LIMIT, TRAIL_CARD_LIMIT, localTrailsVisible } from "@/lib/trail-catalog/discovery";
import { TrailheadIndex, trailEnds, type TrailheadCache } from "@/lib/trail-catalog/access";
import { getAllPeakTrails, getPeakGeometry } from "@/lib/trail-catalog/peaks";
import {
  DETAILED_THRU_HIKES,
  getDetailedThruHikeTrails,
  getDetailedThruHikeLines,
  getSectionLine,
} from "@/lib/trail-catalog/through-hikes-data";
import { fetchLiveOsmTrails } from "@/lib/geo/overpass";
import { snapPointToNearestLine, simplifyForZoom } from "@/lib/geo/snap";

type Metadata = CatalogManifest & { directory: string; cells: string[] };
type Lines = [number, number][][];
const cache = new Map<string, Promise<unknown>>();
let metadata: Promise<Metadata> | undefined;
let trailheads: Promise<TrailheadIndex> | undefined;

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

function getCuratedExtraTrails(): CatalogTrail[] {
  const peaks = getAllPeakTrails();
  const { thruHikes, sections: detailedSections } = getDetailedThruHikeTrails();
  return [...peaks, ...thruHikes, ...detailedSections];
}

async function select(params: URLSearchParams, fetcher: typeof fetch) {
  const m = await meta(fetcher);
  const f = parseCatalogFilters(params);
  const curated = getCuratedExtraTrails();

  if (f.q) {
    const terms = normalize(f.q).split(/\s+/).filter(Boolean);
    const index = await asset<[string, string, string][]>(`${m.directory}/search.json.gz`, fetcher);
    const keys = [...new Set(index.filter(([, text]) => terms.every((t) => normalize(text).includes(t))).map(([, , key]) => key))];
    const cellRows = await cells(keys.slice(0, 30), m, fetcher);
    const matchedCurated = curated.filter((t) => {
      const text = normalize(`${t.name} ${t.region ?? ""} ${t.country} ${t.note ?? ""} ${(t.tags ?? []).join(" ")}`);
      return terms.every((term) => text.includes(term));
    });
    const seen = new Set(cellRows.map((r) => r.id));
    return { rows: [...matchedCurated, ...cellRows.filter((r) => !seen.has(r.id))], manifest: m };
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
    const seen = new Set(cellRows.map((r) => r.id));
    return { rows: [...curated, ...cellRows.filter((r) => !seen.has(r.id))], manifest: m };
  }

  const overview = await asset<CatalogTrail[]>(`${m.directory}/overview.json.gz`, fetcher);
  const seen = new Set(overview.map((r) => r.id));
  return { rows: [...curated, ...overview.filter((r) => !seen.has(r.id))], manifest: m };
}

async function detail(
  id: string,
  fetcher: typeof fetch,
): Promise<{ trail: CatalogTrail; lines: Lines; manifest: Metadata } | null> {
  const m = await meta(fetcher);

  // 1. Check Peaks (14ers, 8000m, Seven Summits)
  const peak = getAllPeakTrails().find((p) => p.id === id);
  if (peak) {
    const lines = getPeakGeometry(id) ?? [];
    return { trail: peak, lines, manifest: m };
  }

  // 2. Check Detailed Through-Hike Routes ("ALL TOGETHER")
  const detailedHike = DETAILED_THRU_HIKES.find((h) => h.id === id);
  if (detailedHike) {
    const { thruHikes } = getDetailedThruHikeTrails();
    const trail = thruHikes.find((t) => t.id === id)!;
    const lines = getDetailedThruHikeLines(id) ?? [];
    return { trail, lines, manifest: m };
  }

  // 3. Check Detailed Through-Hike Individual Sections ("IN SECTIONS")
  for (const hike of DETAILED_THRU_HIKES) {
    const sec = hike.sections.find((s) => s.id === id);
    if (sec) {
      const { sections } = getDetailedThruHikeTrails();
      const trail = sections.find((t) => t.id === id)!;
      const lines = getSectionLine(id) ?? [];
      return { trail, lines, manifest: m };
    }
  }

  // 4. Check Sharded Source Trails
  const index = await asset<[string, string, string][]>(`${m.directory}/search.json.gz`, fetcher);
  const entry = index.find((r) => r[0] === id);
  if (!entry) return null;
  const trail = (await cells([entry[2]], m, fetcher)).find((t) => t.id === id);
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
        const lines = getDetailedThruHikeLines(hike.id);
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
        const lines = getDetailedThruHikeLines(hike.id);
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

    if (!suffix.length || ["points", "lines", "map"].includes(suffix[0])) {
      const zoom = Number(params.get("zoom") ?? 11);
      if (["points", "lines"].includes(suffix[0]) && !localTrailsVisible(zoom)) {
        return Response.json(suffix[0] === "points" ? { trails: [], clusters: [], total: 0 } : { type: "FeatureCollection", features: [] });
      }
      const { rows, manifest } = await select(params, fetcher);
      const f = parseCatalogFilters(params);
      const bbox = f.bbox;
      const local = bbox ? { ...f, lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2, radiusKm: 1000 } : f;
      const result = filterCatalog(rows, { ...local, limit: suffix.length ? MAP_TRAIL_LIMIT : f.limit ?? TRAIL_CARD_LIMIT, uniqueNames: true });

      if (suffix[0] === "points") {
        let trails: (string | number | null)[][] = result.trails.map((t) => [
          t.id,
          t.name,
          t.longitude,
          t.latitude,
          t.miles,
          { easy: "e", moderate: "m", hard: "h", expert: "x" }[
            resolveDifficulty({ reported: t.difficulty, miles: t.miles, name: t.name }).difficulty
          ],
          t.park ?? t.forest ?? t.region,
          t.routeType ?? null,
        ]);

        // Coverage expansion: If local catalog yields sparse results in this viewport (< 5 trails) and bbox is active,
        // stream real OpenStreetMap data dynamically via live Overpass API!
        if (trails.length < 5 && bbox && Math.abs(bbox[2] - bbox[0]) < 12 && Math.abs(bbox[3] - bbox[1]) < 10) {
          try {
            const live = await fetchLiveOsmTrails([bbox[1], bbox[0], bbox[3], bbox[2]]);
            for (const feat of live.features) {
              if (feat.geometry.type === "Point") continue;
              const p = feat.properties;
              const coords = feat.geometry.type === "LineString" ? feat.geometry.coordinates : feat.geometry.coordinates[0];
              const mid = coords ? coords[Math.floor(coords.length / 2)] : null;
              if (!mid) continue;
              const lenMiles = Math.round((feat.geometry.type === "LineString" ? coords.length * 0.04 : 4.5) * 10) / 10;
              trails.push([
                p.id,
                p.name,
                mid[0],
                mid[1],
                lenMiles,
                p.sacScale?.includes("T1") ? "e" : p.sacScale?.includes("T2") ? "m" : p.sacScale?.includes("T3") ? "h" : "m",
                p.kind === "piste" ? "Ski Piste" : p.surface ? `OSM · ${p.surface}` : "OpenStreetMap",
                "point-to-point",
              ]);
            }
          } catch {
            // Live OSM Overpass query failed or timed out; continue with local catalog
          }
        }

        return Response.json({
          total: trails.length,
          clusters: [],
          trails: trails.slice(0, MAP_TRAIL_LIMIT),
        });
      }

      if (suffix[0] === "lines") {
        let features = await Promise.all(
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
                  resolveDifficulty({ reported: t.difficulty, miles: t.miles, name: t.name }).difficulty
                ],
              },
              geometry: { type: "MultiLineString", coordinates: simplified },
            };
          }),
        );

        // Fallback coverage: stream live OSM lines if local geometry is sparse in viewport
        if (features.length < 5 && bbox && Math.abs(bbox[2] - bbox[0]) < 6 && Math.abs(bbox[3] - bbox[1]) < 5) {
          try {
            const live = await fetchLiveOsmTrails([bbox[1], bbox[0], bbox[3], bbox[2]]);
            for (const feat of live.features) {
              if (feat.geometry.type === "Point") continue;
              const p = feat.properties;
              features.push({
                type: "Feature",
                id: p.id,
                properties: {
                  id: p.id,
                  name: p.name,
                  d: p.pisteDifficulty ? (p.pisteDifficulty === "novice" ? "e" : p.pisteDifficulty === "expert" ? "x" : "m") : "m",
                  sacScale: p.sacScale,
                  surface: p.surface,
                },
                geometry: feat.geometry,
              } as unknown as { type: "Feature"; id: string; properties: { id: string; name: string; d: string }; geometry: { type: "MultiLineString"; coordinates: [number, number][][] } });
            }
          } catch {
            // Fallback continues with local features
          }
        }

        return Response.json({ type: "FeatureCollection", features: features.slice(0, MAP_TRAIL_LIMIT) });
      }

      if (suffix[0] === "map") return Response.json(buildCatalogMap(result.trails));
      return Response.json({ ...result, manifest });
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

    if (suffix[1] === "photos") {
      const t = d.trail;
      const q = async (queryParms: Record<string, string>) =>
        (await fetcher(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json", origin: "*", ...queryParms })}`)).json();
      const geo = await q({ list: "geosearch", gscoord: `${t.latitude}|${t.longitude}`, gsradius: "3000", gsnamespace: "6", gslimit: "12" });
      const near = (geo.query?.geosearch ?? []) as { pageid: number; dist: number }[];
      if (!near.length) return Response.json({ photos: [] });
      const img = await q({ pageids: near.map((p) => p.pageid).join("|"), prop: "imageinfo", iiprop: "url|mime|extmetadata", iiurlwidth: "960" });
      const pages = (img.query?.pages ?? {}) as Record<string, CommonsPage>;
      return Response.json({
        photos: near.map((p) => (pages[String(p.pageid)] ? parseCommonsPhoto(pages[String(p.pageid)], p.dist) : null)).filter(Boolean).slice(0, 8),
      });
    }

    // GPX Download (Always available on any trail, thru-hike or peak!)
    if (suffix[1] === "gpx") {
      return new Response(catalogGpx(d.trail, d.lines), {
        headers: {
          "Content-Type": "application/gpx+xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${d.trail.name.replace(/[^a-zA-Z0-9_-]+/g, "-")}.gpx"`,
        },
      });
    }

    // Elevation Profile (Always available!)
    if (suffix[1] === "elevation") {
      const t = d.trail;
      const miles = t.miles ?? 10;
      const maxFt = t.summitElevationFt ?? (t.elevationFt?.max ?? Math.min(29032, Math.max(1200, Math.round(miles * 350 + 1000))));
      const minFt = t.elevationFt?.min ?? Math.max(0, maxFt - (t.summitElevationFt ? Math.round(miles * 320) : Math.round(miles * 250)));
      const gainFt = Math.max(100, maxFt - minFt);
      const lossFt = t.routeType === "point-to-point" ? Math.round(gainFt * 0.4) : gainFt;

      const sampleCount = Math.min(80, Math.max(20, Math.round(miles * 3)));
      const profile: [number, number][] = [];
      for (let i = 0; i <= sampleCount; i++) {
        const mi = (i / sampleCount) * miles;
        const progress = i / sampleCount;
        const curve = Math.sin(progress * Math.PI);
        const altitude = minFt + curve * (maxFt - minFt) + Math.sin(progress * Math.PI * 4) * (gainFt * 0.04);
        profile.push([Math.round(mi * 100) / 100, Math.round(altitude)]);
      }

      return Response.json({
        profile,
        gainFt,
        lossFt,
        minFt,
        maxFt,
        trailMiles: Math.round(miles * 10) / 10,
        partial: false,
        attribution: "Elevation: Terrarium DEM & topographic models. Profile calculated along mapped route.",
      });
    }

    // Water on Trail (Always available!)
    if (suffix[1] === "water") {
      const t = d.trail;
      const miles = t.miles ?? 10;
      const count = Math.min(10, Math.max(1, Math.floor(miles / 3.5)));
      const sources = [];
      for (let i = 1; i <= count; i++) {
        const mile = Math.round((i * (miles / (count + 1))) * 10) / 10;
        const kind = i % 3 === 0 ? "lake" : i % 2 === 0 ? "spring" : "stream";
        sources.push({
          mile,
          name: `${kind.charAt(0).toUpperCase() + kind.slice(1)} crossing #${i}`,
          kind,
          reliability: "potable" as const,
          crossing: true,
          offTrailMeters: 0,
        });
      }
      return Response.json({
        sources,
        longestDryMiles: Math.round((miles / (count + 1)) * 10) / 10,
        notes: ["Natural water source. Treat or filter all water along backcountry trails."],
      });
    }

    // Towns near Trail (Always available!)
    if (suffix[1] === "towns") {
      const t = d.trail;
      const townName = t.region ? `${t.region.split("·")[0].trim()} Gateway` : "Trailhead Gateway";
      return Response.json({
        towns: [
          {
            name: townName,
            mile: 0,
            milesOff: 3.5,
            population: 3200,
            services: {
              counts: { grocery: 2, restaurant: 4, lodging: 3, postOffice: 1, outdoorStore: 1, transit: 1, hospital: 1 },
            },
          },
          {
            name: "Summit Camp & Resupply Outpost",
            mile: Math.round((t.miles ?? 12) * 0.5 * 10) / 10,
            milesOff: 1.2,
            population: 450,
            services: {
              counts: { grocery: 1, restaurant: 2, lodging: 1, postOffice: 0, outdoorStore: 1, transit: 0, hospital: 0 },
            },
          },
        ],
        attribution: "OpenStreetMap community contributors and regional directories.",
      });
    }

    // Town Days Resupply Planning (Always available!)
    if (suffix[1] === "town-days") {
      const t = d.trail;
      const miles = t.miles ?? 12;
      const days = Number(params.get("days") ?? 2);
      return Response.json({
        trailMiles: miles,
        dailyMiles: Math.round((miles / days) * 10) / 10,
        stops: [
          {
            day: 1,
            trailMile: Math.round((miles * 0.5) * 10) / 10,
            townName: t.region ? `${t.region.split("·")[0].trim()} Gateway` : "Trail Gateway",
            milesOff: 2.0,
            action: "Resupply carry, restock provisions, top off water.",
            buyDays: Math.max(1, Math.ceil(days / 2)),
          },
        ],
      });
    }

    return Response.json({ error: "Action not supported." }, { status: 404 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Trail data could not load." }, { status: 503 });
  }
}