import { routeSteps, type RouteStep } from "@/lib/trail-catalog/access";
import { getSkiArea, searchSkiAreas, searchSkiAreasNearby, type SkiArea } from "@/lib/ski";
import { normalizeText } from "@/lib/trail-catalog/fuzzy";
import { countryName, type CatalogTrail } from "@/lib/trail-catalog/types";
import { skiAreaRows, trailService, type SkiAreaRow } from "./trail-service";

/**
 * Browser versions of the server routes the static site still calls (src/app/api/…), for hosting without the
 * Next.js server. Each talks to the same public service the server route uses; all of them allow browser requests.
 */
const ROUTER = "https://router.project-osrm.org";
const FOOT_ROUTER = "https://routing.openstreetmap.de/routed-foot";

function point(raw: string | null) {
  const parts = raw?.split(",").map(Number);
  if (!parts || parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  const [lat, lng] = parts;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** GET /api/directions?from=lat,lng&to=lat,lng[&profile=foot] — driving (OSRM) or walking (FOSSGIS OSRM foot). */
async function directions(url: URL, fetcher: typeof fetch) {
  const from = point(url.searchParams.get("from"));
  const to = point(url.searchParams.get("to"));
  const foot = url.searchParams.get("profile") === "foot";
  if (!from || !to) return Response.json({ error: "Directions need a start and a destination (lat,lng)." }, { status: 400 });
  try {
    const query = new URLSearchParams({ overview: "full", geometries: "geojson", steps: "true" });
    const response = await fetcher(`${foot ? FOOT_ROUTER : ROUTER}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?${query}`, { signal: AbortSignal.timeout(15_000) });
    const data = (await response.json()) as { code: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { steps: RouteStep[] }[] }[] };
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route) {
      return Response.json({ error: foot ? "No walking route was found between these points." : "No driving route was found to this trail. Try Google Maps, which may know private or seasonal roads." }, { status: 404 });
    }
    return Response.json({
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      line: route.geometry.coordinates,
      steps: routeSteps(route.legs.flatMap((leg) => leg.steps)),
      attribution: foot ? "Walking route: OSRM (FOSSGIS), map data © OpenStreetMap contributors" : "Routing © OSRM, map data © OpenStreetMap contributors",
    });
  } catch {
    return Response.json({ error: "Directions are unavailable right now. Use Google Maps or Apple Maps instead." }, { status: 503 });
  }
}

const ACTIVITIES: Record<string, string> = { d: "downhill", n: "nordic", b: "backcountry", t: "skitour", s: "sled", p: "snow_park", i: "ice_skate", f: "fatbike", h: "hike" };
const toArea = (r: SkiAreaRow): SkiArea => ({ id: r[0], name: r[1], lng: r[2], lat: r[3], country: r[4] ? countryName(r[4]) : undefined, region: r[5] || undefined, runs_count: r[8], lifts_count: r[9], activities: [...r[7]].map((c) => ACTIVITIES[c]).filter(Boolean) });
const km = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const rad = Math.PI / 180, h = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
};
/** Ski areas whose name, town or region contains every word of the query; bigger areas (more runs) first. */
function matchAreas(rows: SkiAreaRow[], q: string) {
  const terms = normalizeText(q).split(" ").filter(Boolean);
  return rows
    .map((r) => ({ r, text: ` ${normalizeText(`${r[1]} ${r[6]} ${r[5]} ${countryName(r[4])}`)} `, name: ` ${normalizeText(r[1])} ` }))
    .filter((x) => terms.every((t) => x.text.includes(` ${t}`)))
    .sort((a, b) => Number(b.name.includes(` ${terms[0]}`)) - Number(a.name.includes(` ${terms[0]}`)) || b.r[8] + b.r[9] - (a.r[8] + a.r[9]))
    .map((x) => x.r);
}

/** GET /api/ski/nearby?id= | ?q= | ?lat=&lng= — ski areas from the build's OpenSkiMap list (live API when absent). */
async function skiNearby(url: URL, fetcher: typeof fetch) {
  const p = url.searchParams;
  const lat = Number(p.get("lat")), lng = Number(p.get("lng"));
  const q = p.get("q")?.trim() ?? "", id = p.get("id")?.trim() ?? "";
  const limit = Math.min(50, Number(p.get("limit")) || 30);
  const near = p.has("lat") && p.has("lng") && Number.isFinite(lat) && Number.isFinite(lng);
  try {
    const rows = await skiAreaRows(fetcher);
    if (rows.length) {
      if (id) return Response.json({ areas: rows.filter((r) => r[0] === id).map(toArea) });
      if (q) return Response.json({ areas: matchAreas(rows, q).slice(0, limit).map(toArea) });
      if (!near) return Response.json({ areas: [...rows].sort((a, b) => b[8] - a[8]).slice(0, 20).map(toArea), userLocation: null });
      const radius = Number(p.get("radius")) || 150;
      const areas = rows.map((r) => ({ ...toArea(r), distance_km: km(lat, lng, r[3], r[2]) })).filter((a) => a.distance_km <= radius).sort((a, b) => a.distance_km - b.distance_km).slice(0, limit);
      return Response.json({ areas, userLocation: { lat, lng } });
    }
    if (id) { const area = await getSkiArea(id); return Response.json({ areas: area ? [area] : [] }); }
    if (q) return Response.json({ areas: await searchSkiAreas(q, limit) });
    if (!near) return Response.json({ areas: await searchSkiAreas("ski resort", 20), userLocation: null });
    return Response.json({ areas: await searchSkiAreasNearby(lat, lng, Number(p.get("radius")) || 150, limit), userLocation: { lat, lng } });
  } catch {
    return Response.json({ areas: [], userLocation: null });
  }
}

/**
 * GET /api/ski/areas?bbox=w,s,e,n&zoom=z — ski areas in view for the ski map: every area when there are few,
 * otherwise count bubbles on a grid that gets finer as you zoom in.
 */
async function skiAreasInView(url: URL, fetcher: typeof fetch) {
  const box = (url.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (box.length !== 4 || !box.every(Number.isFinite)) return Response.json({ error: "bbox=west,south,east,north is required." }, { status: 400 });
  const [w, s, e, n] = box;
  const zoom = Number(url.searchParams.get("zoom")) || 4;
  const rows = (await skiAreaRows(fetcher)).filter((r) => r[3] >= s && r[3] <= n && (w <= e ? r[2] >= w && r[2] <= e : r[2] >= w || r[2] <= e));
  if (rows.length <= 250 || zoom >= 9) return Response.json({ total: rows.length, areas: rows.slice(0, 600).map(toArea), clusters: [] });
  const size = 360 / 2 ** (zoom + 1.5);
  const cells = new Map<string, { lat: number; lng: number; count: number; top: SkiAreaRow }>();
  for (const r of rows) {
    const k = `${Math.floor(r[2] / size)}:${Math.floor(r[3] / size)}`;
    const c = cells.get(k);
    if (c) { c.lat += r[3]; c.lng += r[2]; c.count++; if (r[8] > c.top[8]) c.top = r; } else cells.set(k, { lat: r[3], lng: r[2], count: 1, top: r });
  }
  return Response.json({
    total: rows.length,
    areas: [...cells.values()].filter((c) => c.count === 1).map((c) => toArea(c.top)),
    clusters: [...cells.values()].filter((c) => c.count > 1).map((c) => ({ lat: c.lat / c.count, lng: c.lng / c.count, count: c.count, name: c.top[1] })),
  });
}

/** GET /api/search?q= — the header's quick search: catalog trails and ski areas. */
async function quickSearch(url: URL, fetcher: typeof fetch) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 180);
  if (q.length < 2) return Response.json({ results: [] });
  const [catalog, ski] = await Promise.all([
    trailService(new Request(new URL(`/api/trail-catalog?${new URLSearchParams({ q, limit: "6", activity: "all" })}`, url)), fetcher).then((r) => r.json() as Promise<{ trails?: CatalogTrail[] }>).catch(() => ({ trails: [] })),
    skiAreaRows(fetcher).then((rows) => (rows.length ? matchAreas(rows, q).slice(0, 4).map(toArea) : searchSkiAreas(q, 4))).catch(() => [] as SkiArea[]),
  ]);
  return Response.json({
    results: [
      ...(catalog.trails ?? []).map((t) => ({ id: t.id, type: "trail", name: t.name, subtitle: `${t.region ?? countryName(t.country)} · ${t.kind === "route" ? "Through-hike" : "Trail"}`, href: `/explore/trails/${encodeURIComponent(t.id)}`, lat: t.latitude, lng: t.longitude })),
      ...ski.map((a) => ({ id: a.id, type: "resort", name: a.name, subtitle: [a.region, a.country].filter(Boolean).join(", ") || "Ski area", href: `/explore/ski?area=${a.id}`, lat: a.lat, lng: a.lng })),
    ],
  });
}

/** A browser answer for `url`, or null when the static site has none. */
export function staticApi(url: URL, fetcher: typeof fetch): Promise<Response> | null {
  if (url.pathname === "/api/directions") return directions(url, fetcher);
  if (url.pathname === "/api/ski/nearby") return skiNearby(url, fetcher);
  if (url.pathname === "/api/ski/areas") return skiAreasInView(url, fetcher);
  if (url.pathname === "/api/search") return quickSearch(url, fetcher);
  return null;
}
