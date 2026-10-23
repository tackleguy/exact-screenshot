import { createClient } from "@/lib/supabase/client";
import { apiTarget } from "./api-target";
import { isTrailServicePath, trailService, tripPacket } from "./trail-service";
import { fetchTrailWeather } from "@/lib/weather/forecast";
import { staticApi } from "./static-api";

export const apiOrigin = (import.meta.env.VITE_HYKED_API_URL ?? "").replace(/\/+$/, "");

async function accountActivities(request: Request): Promise<Response> {
  const client = createClient();
  if (!client) return Response.json({ error: "Sign-in is unavailable right now." }, { status: 503 });
  const { data: identity } = await client.auth.getUser();
  if (!identity.user) return Response.json({ error: "Sign in to save activities." }, { status: 401 });
  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (
      !body ||
      !["hike", "run", "bike", "ski"].includes(body.activity_type) ||
      !Number.isFinite(body.distance_m) ||
      body.distance_m < 0 ||
      !Number.isFinite(body.duration_sec) ||
      body.duration_sec < 0
    ) {
      return Response.json({ error: "Check the activity type, distance and duration." }, { status: 400 });
    }
    const { data, error } = await client
      .from("activities")
      .insert({
        user_id: identity.user.id,
        status: "completed",
        activity_type: body.activity_type,
        title: body.title,
        distance_m: body.distance_m,
        duration_sec: body.duration_sec,
        elevation_gain_ft: body.elevation_gain_ft,
        route_geojson: body.route_geojson,
        started_at: body.started_at,
        ended_at: body.ended_at,
        trail_id: body.trail_id ?? null,
        ski_area_id: body.ski_area_id ?? null,
        ski_area_name: body.ski_area_name ?? null,
        notes: body.notes ?? null,
      })
      .select("*")
      .single();
    return Response.json(error ? { error: error.message } : { activity: data }, { status: error ? 400 : 201 });
  }
  if (request.method === "GET") {
    const { data, error } = await client
      .from("activities")
      .select("*, trail:trails(*, park:parks(*))")
      .eq("user_id", identity.user.id)
      .eq("status", "completed")
      .order("started_at", { ascending: false })
      .limit(50);
    return Response.json(error ? { error: error.message } : { activities: data ?? [] }, { status: error ? 400 : 200 });
  }
  return Response.json({ error: "This action is not supported." }, { status: 405 });
}

export function installApiBridge() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const target = apiTarget(url, window.location.origin, apiOrigin);
    if (target === null) return original(input, init);

    const request = new Request(input instanceof Request ? input : new URL(url, window.location.origin), init);
    const reqUrl = new URL(request.url);

    // 1. Account Activities
    if (reqUrl.pathname === "/api/activities") return accountActivities(request);

    // 2. Weather Forecast (Always available worldwide via NWS / Open-Meteo!)
    if (reqUrl.pathname === "/api/weather/forecast") {
      const lat = Number(reqUrl.searchParams.get("lat"));
      const lng = Number(reqUrl.searchParams.get("lng"));
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        try {
          const forecast = await fetchTrailWeather(lat, lng);
          return Response.json({ forecast });
        } catch {
          return Response.json({ error: "Forecast could not be loaded." }, { status: 502 });
        }
      }
      return Response.json({ error: "Invalid coordinates." }, { status: 400 });
    }

    // 3. Trip packet with the planner's pack list, built from the trail's real data.
    if (reqUrl.pathname === "/api/trips/packet" && request.method === "POST") {
      const body = (await request.clone().json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return Response.json({ error: "Send a JSON body with trailId." }, { status: 400 });
      return tripPacket(body, original);
    }

    // 4. Trail Service (Catalog, Peaks, Thru-Hikes, Sections, Elevation, Water, Towns, GPX)
    // 5. Directions, ski areas and quick search, straight from their public services.
    const local = () => (isTrailServicePath(reqUrl.pathname) ? trailService(request, original) : staticApi(reqUrl, original));
    if (!target) return local() ?? Response.json({ error: "This feature is unavailable right now. Please try again later." }, { status: 503 });

    // A configured API server answers first; when it is down, the browser versions above still work.
    const headers = new Headers(request.headers);
    const fallback = request.method === "GET" ? request.clone() : null;
    const answer = await original(new Request(target, request), { headers }).catch(() => null);
    if (answer && answer.status < 500 && answer.status !== 404) return answer;
    return (fallback && (isTrailServicePath(reqUrl.pathname) ? trailService(fallback, original) : staticApi(reqUrl, original))) ?? answer ?? Response.json({ error: "This feature is unavailable right now. Please try again later." }, { status: 503 });
  };

  // Intercept anchor clicks for GPX downloads
  document.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      const target = apiTarget(anchor.href, window.location.origin, apiOrigin);
      if (target) {
        anchor.href = target;
      } else if (target === "" && isTrailServicePath(new URL(anchor.href).pathname)) {
        event.preventDefault();
        void trailService(new Request(anchor.href), original).then(async (response) => {
          if (!response.ok) {
            const data = await response.json();
            window.alert(data.error);
            return;
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const download = document.createElement("a");
          download.href = url;
          const disposition = response.headers.get("Content-Disposition") || "";
          const match = /filename="([^"]+)"/.exec(disposition);
          download.download = match ? match[1] : "trail.gpx";
          document.body.appendChild(download);
          download.click();
          download.remove();
          setTimeout(() => URL.revokeObjectURL(url), 30_000);
        });
      } else if (target === "") {
        event.preventDefault();
        window.alert("This feature is unavailable right now. Please try again later.");
      }
    },
    true,
  );
}