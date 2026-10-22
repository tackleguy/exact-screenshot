import { NextRequest, NextResponse } from "next/server";
import { routeSteps, type RouteStep } from "@/lib/trail-catalog/access";

export const runtime = "nodejs";

/** OSRM-compatible routing server. The public demo is for light use; set ROUTING_API_URL for production traffic. */
const ROUTER = process.env.ROUTING_API_URL || "https://router.project-osrm.org";
/**
 * Walking routes (?profile=foot, the route builder's road connectors): an OSRM server with a foot profile. The
 * default is the FOSSGIS OSRM foot instance (light use, attribution required); set ROUTING_FOOT_API_URL to a
 * self-hosted one for production traffic.
 */
const FOOT_ROUTER = process.env.ROUTING_FOOT_API_URL || "https://routing.openstreetmap.de/routed-foot";
let lastRequest = 0;

function point(raw: string | null) {
  const parts = raw?.split(",").map(Number);
  if (!parts || parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  const [lat, lng] = parts;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export async function GET(request: NextRequest) {
  const from = point(request.nextUrl.searchParams.get("from"));
  const to = point(request.nextUrl.searchParams.get("to"));
  const foot = request.nextUrl.searchParams.get("profile") === "foot";
  if (!from || !to) return NextResponse.json({ error: "Directions need a start and a destination (lat,lng)." }, { status: 400 });
  if (Date.now() - lastRequest < 1000) {
    return NextResponse.json({ error: "Please wait a moment and try again." }, { status: 429, headers: { "Retry-After": "1" } });
  }
  lastRequest = Date.now();
  try {
    // FOSSGIS-style servers name every profile "driving" in the path; the server itself decides the mode.
    const url = `${foot ? FOOT_ROUTER : ROUTER}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?${new URLSearchParams({ overview: "full", geometries: "geojson", steps: "true" })}`;
    const response = await fetch(url, { headers: { "User-Agent": "Hyked/1.0 (https://github.com/tackleguy/health)" }, signal: AbortSignal.timeout(15_000) });
    const data = (await response.json()) as {
      code: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs: { steps: RouteStep[] }[] }[];
    };
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route) {
      if (foot) return NextResponse.json({ error: "No walking route was found between these points." }, { status: 404 });
      return NextResponse.json({ error: "No driving route was found to this trail. Try Google Maps, which may know private or seasonal roads." }, { status: 404 });
    }
    return NextResponse.json({
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      line: route.geometry.coordinates,
      steps: routeSteps(route.legs.flatMap((leg) => leg.steps)),
      attribution: foot ? "Walking route: OSRM (FOSSGIS), map data © OpenStreetMap contributors" : "Routing © OSRM, map data © OpenStreetMap contributors",
    });
  } catch {
    return NextResponse.json({ error: "Directions are unavailable right now. Use Google Maps or Apple Maps instead." }, { status: 503 });
  }
}
