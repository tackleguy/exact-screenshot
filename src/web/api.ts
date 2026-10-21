import { createClient } from "@/lib/supabase/client";
import { apiTarget } from "./api-target";
import { isTrailServicePath, trailService } from "./trail-service";
export const apiOrigin = (import.meta.env.VITE_HYKED_API_URL ?? "").replace(/\/+$/, "");
async function accountActivities(request: Request): Promise<Response> {
  const client = createClient();
  if (!client) return Response.json({ error: "Account saving is not connected." }, { status: 503 });
  const { data: identity } = await client.auth.getUser();
  if (!identity.user) return Response.json({ error: "Sign in to save activities." }, { status: 401 });
  if (request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !["hike", "run", "bike", "ski"].includes(body.activity_type) || !Number.isFinite(body.distance_m) || body.distance_m < 0 || !Number.isFinite(body.duration_sec) || body.duration_sec < 0) return Response.json({ error: "Check the activity type, distance and duration." }, { status: 400 });
    const { data, error } = await client.from("activities").insert({ user_id: identity.user.id, status: "completed", activity_type: body.activity_type, title: body.title, distance_m: body.distance_m, duration_sec: body.duration_sec, elevation_gain_ft: body.elevation_gain_ft, route_geojson: body.route_geojson, started_at: body.started_at, ended_at: body.ended_at, trail_id: body.trail_id ?? null, ski_area_id: body.ski_area_id ?? null, ski_area_name: body.ski_area_name ?? null, notes: body.notes ?? null }).select("*").single();
    return Response.json(error ? { error: error.message } : { activity: data }, { status: error ? 400 : 201 });
  }
  if (request.method === "GET") {
    const { data, error } = await client.from("activities").select("*, trail:trails(*, park:parks(*))").eq("user_id", identity.user.id).eq("status", "completed").order("started_at", { ascending: false }).limit(50);
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
    if (new URL(request.url).pathname === "/api/activities") return accountActivities(request);
    if (!target && isTrailServicePath(new URL(request.url).pathname)) return trailService(request, original);
    if (!target) return Response.json({ error: "Live trail services are not connected yet." }, { status: 503 });
    const headers = new Headers(request.headers);
    return original(new Request(target, request), { headers });
  };
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;
    const target = apiTarget(anchor.href, window.location.origin, apiOrigin);
    if (target) anchor.href = target;
    else if (target === "" && isTrailServicePath(new URL(anchor.href).pathname)) {
      event.preventDefault();
      void trailService(new Request(anchor.href), original).then(async response => {
        if (!response.ok) { const data = await response.json(); window.alert(data.error); return; }
        const url = URL.createObjectURL(await response.blob());
        const download = document.createElement("a"); download.href = url; download.download = "trail.gpx"; download.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      });
    }
    else if (target === "") { event.preventDefault(); window.alert("Live trail services are not connected yet."); }
  }, true);
}