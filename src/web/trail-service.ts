import { parseCatalogFilters, filterCatalog, normalize, distanceKm } from "@/lib/trail-catalog/search";
import type { CatalogTrail, CatalogManifest } from "@/lib/trail-catalog/types";
import { buildCatalogMap } from "@/lib/trail-catalog/map";
import { resolveDifficulty } from "@/lib/trail-difficulty";
import { catalogGpx } from "@/lib/trail-catalog/gpx";
import { readableTrailName, MAP_TRAIL_LIMIT, TRAIL_CARD_LIMIT, localTrailsVisible } from "@/lib/trail-catalog/discovery";
import { TrailheadIndex, trailEnds, type TrailheadCache } from "@/lib/trail-catalog/access";
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
        const text = bytes[0] === 0x1f && bytes[1] === 0x8b
          ? await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text()
          : await blob.text();
        return JSON.parse(text);
      }
      return res.json();
    })().catch(error => { cache.delete(file); throw error; });
    cache.set(file, hit);
    if (cache.size > 80) cache.delete(cache.keys().next().value ?? "");
  }
  return hit as Promise<T>;
}
function meta(fetcher: typeof fetch) {
  metadata ??= asset<{ directory: string }>("current.json", fetcher).then(p => asset<Metadata>(`${p.directory}/manifest.json`, fetcher)).catch(error => { metadata = undefined; throw error; });
  return metadata;
}
async function cells(keys: string[], m: Metadata, fetcher: typeof fetch) {
  const rows = (await Promise.all(keys.filter(k => m.cells.includes(k)).map(k => asset<CatalogTrail[]>(`${m.directory}/cell-${k}.json.gz`, fetcher)))).flat();
  return rows.filter(t => t.confidence !== "REJECTED").map(t => ({ ...t, name: readableTrailName(t.name, t.id) }));
}
async function select(params: URLSearchParams, fetcher: typeof fetch) {
  const m = await meta(fetcher);
  const f = parseCatalogFilters(params);
  if (f.q) {
    const terms = normalize(f.q).split(/\s+/);
    const index = await asset<[string, string, string][]>(`${m.directory}/search.json.gz`, fetcher);
    const keys = [...new Set(index.filter(([, text]) => terms.every(t => normalize(text).includes(t))).map(([, , key]) => key))];
    return { rows: await cells(keys.slice(0, 30), m, fetcher), manifest: m };
  }
  if (f.bbox || (f.lat !== undefined && f.lng !== undefined)) {
    const lat = f.lat ?? 0, lng = f.lng ?? 0, pad = Math.min(50, f.radiusKm ?? 25) / 110;
    const box = f.bbox ?? [lng - pad / Math.max(0.2, Math.cos(lat * Math.PI / 180)), lat - pad, lng + pad / Math.max(0.2, Math.cos(lat * Math.PI / 180)), lat + pad];
    const keys = m.cells.filter(key => {
      const [x, y] = key.split("_").map(Number); const w = x * 2 - 180, s = y * 2 - 90;
      return w <= box[2] && w + 2 >= box[0] && s <= box[3] && s + 2 >= box[1];
    });
    if (keys.length > 16) return { rows: [] as CatalogTrail[], manifest: m };
    return { rows: await cells(keys, m, fetcher), manifest: m };
  }
  return { rows: await asset<CatalogTrail[]>(`${m.directory}/overview.json.gz`, fetcher), manifest: m };
}
async function detail(id: string, fetcher: typeof fetch): Promise<{ trail: CatalogTrail; lines: Lines; manifest: Metadata } | null> {
  const m = await meta(fetcher);
  const index = await asset<[string, string, string][]>(`${m.directory}/search.json.gz`, fetcher);
  const entry = index.find(r => r[0] === id);
  if (!entry) return null;
  const trail = (await cells([entry[2]], m, fetcher)).find(t => t.id === id);
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
    trailheads ??= asset<TrailheadCache>(`${m.directory}/trailheads.json.gz`, fetcher).then(data => new TrailheadIndex(data.trailheads)).catch(error => { trailheads = undefined; throw error; });
    const head = (await trailheads).nearest(ends);
    trail.trailhead = head ?? { kind: "trail-end", name: null, longitude: ends[0][0], latitude: ends[0][1], toTrailMeters: 0 };
  }
  return { trail, lines, manifest: m };
}
export function isTrailServicePath(path: string) { return path === "/api/trail-catalog" || path.startsWith("/api/trail-catalog/"); }
export async function trailService(request: Request, fetcher: typeof fetch): Promise<Response> {
  const url = new URL(request.url), params = url.searchParams;
  if (request.method !== "GET") return Response.json({ error: "This trail action is not supported." }, { status: 405 });
  try {
    const suffix = url.pathname.slice("/api/trail-catalog".length).split("/").filter(Boolean);
    if (!suffix.length || ["points", "lines", "map"].includes(suffix[0])) {
      const zoom = Number(params.get("zoom") ?? 11);
      if (["points", "lines"].includes(suffix[0]) && !localTrailsVisible(zoom)) return Response.json(suffix[0] === "points" ? { trails: [], clusters: [], total: 0 } : { type: "FeatureCollection", features: [] });
      const { rows, manifest } = await select(params, fetcher);
      const f = parseCatalogFilters(params);
      const bbox = f.bbox;
      const local = bbox ? { ...f, lat: (bbox[1] + bbox[3]) / 2, lng: (bbox[0] + bbox[2]) / 2, radiusKm: 1000 } : f;
      const result = filterCatalog(rows, { ...local, limit: suffix.length ? MAP_TRAIL_LIMIT : f.limit ?? TRAIL_CARD_LIMIT, uniqueNames: true });
      if (suffix[0] === "points") return Response.json({ total: result.total, clusters: [], trails: result.trails.map(t => [t.id, t.name, t.longitude, t.latitude, t.miles, ({ easy: "e", moderate: "m", hard: "h", expert: "x" })[resolveDifficulty({ reported: t.difficulty, miles: t.miles, name: t.name }).difficulty], t.park ?? t.forest ?? t.region, t.routeType ?? null]) });
      if (suffix[0] === "lines") {
        const features = await Promise.all(result.trails.map(async t => {
          const d = await detail(t.id, fetcher);
          return { type: "Feature", id: t.id, properties: { id: t.id, name: t.name, d: ({ easy: "e", moderate: "m", hard: "h", expert: "x" })[resolveDifficulty({ reported: t.difficulty, miles: t.miles, name: t.name }).difficulty] }, geometry: { type: "MultiLineString", coordinates: d?.lines ?? [] } };
        }));
        return Response.json({ type: "FeatureCollection", features });
      }
      if (suffix[0] === "map") return Response.json(buildCatalogMap(result.trails));
      return Response.json({ ...result, manifest });
    }
    const d = await detail(decodeURIComponent(suffix[0]), fetcher);
    if (!d) return Response.json({ error: "This trail is not in the current source catalog." }, { status: 404 });
    if (!suffix[1]) return Response.json(d);
    if (suffix[1] === "nearby") {
      const t = d.trail;
      const { rows } = await select(new URLSearchParams({ lat: String(t.latitude), lng: String(t.longitude), radiusKm: "25" }), fetcher);
      const result = filterCatalog(rows.filter(r => r.id !== t.id), { lat: t.latitude, lng: t.longitude, radiusKm: 25, limit: TRAIL_CARD_LIMIT, uniqueNames: true });
      return Response.json({ trails: await Promise.all(result.trails.map(async r => { const full = await detail(r.id, fetcher); return { ...r, trailhead: full?.trail.trailhead, distanceKm: distanceKm(t.latitude, t.longitude, r.latitude, r.longitude) }; })) });
    }
    if (suffix[1] === "gpx") return new Response(catalogGpx(d.trail, d.lines), { headers: { "Content-Type": "application/gpx+xml", "Content-Disposition": 'attachment; filename="trail.gpx"' } });
    return Response.json({ error: "This additional trip service needs the separately hosted service. Trail maps, nearby trails and directions are available." }, { status: 503 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Trail data could not load." }, { status: 503 });
  }
}